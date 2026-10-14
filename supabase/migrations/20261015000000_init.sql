-- =============================================================================
-- MedTrace — initial schema
--
-- Design rules, in order of importance:
--
-- 1. The tri-state survives storage exactly. A symptom on a day is `present`,
--    `absent`, or — by its key being ABSENT from `day_entries.symptoms` —
--    `unknown`. The value 'unknown' is never stored, and a check constraint
--    rejects it, so there is exactly one representation of "not observed".
--
-- 2. History is never overwritten. Every update or deletion of a day entry
--    copies the prior row into `day_entry_revisions` first.
--
-- 3. Every row belongs to one user, and row-level security restricts every
--    table to `user_id = auth.uid()`. Anonymous users have no table access at
--    all; the only anonymous entry point is `view_shared_report`, which
--    returns an approved snapshot and nothing else.
--
-- 4. No identity beyond what auth needs. No date of birth, address or national
--    ID is stored anywhere (DPDP data minimisation).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Last-write-wins by the CLIENT's edit time, not by arrival order. An offline
-- device that syncs late must not overwrite a newer edit made elsewhere, so a
-- write carrying an older client_updated_at than the stored row is skipped.
create or replace function public.reject_stale_write()
returns trigger
language plpgsql
as $$
begin
  if new.client_updated_at < old.client_updated_at then
    return null; -- keep the newer stored row; silently drop the stale write
  end if;
  return new;
end;
$$;

-- Every symptom value must be {"state": "present"|"absent", "severity"?: 0..10}.
create or replace function public.valid_symptoms(s jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(
           jsonb_typeof(v) = 'object'
           and v->>'state' in ('present', 'absent')
           and (
             not (v ? 'severity')
             or (jsonb_typeof(v->'severity') = 'number'
                 and (v->>'severity')::numeric between 0 and 10)
           )
         ), true)
  from jsonb_each(s) as e(k, v)
$$;

-- -----------------------------------------------------------------------------
-- profiles — baseline, collected occasionally
-- -----------------------------------------------------------------------------

create table public.profiles (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  display_name            text check (char_length(display_name) <= 60),
  age_range               text check (char_length(age_range) <= 20),
  diagnosis_status        text not null default 'undiagnosed'
                            check (diagnosis_status in ('suspected', 'confirmed', 'undiagnosed')),
  symptom_onset_year      int  check (symptom_onset_year between 1950 and 2100),
  family_history          boolean,
  previous_pelvic_surgery boolean,
  prior_labels            text[] not null default '{}',
  usual_cycle_min         int  check (usual_cycle_min between 10 and 120),
  usual_cycle_max         int  check (usual_cycle_max between 10 and 120),
  cycle_regularity        text check (cycle_regularity in ('regular', 'variable', 'highly_irregular')),
  age_at_menarche         int  check (age_at_menarche between 6 and 25),
  enabled_domains         text[] not null default '{pain,bowel,urinary,systemic}',
  tracked_symptom_ids     text[] not null default '{}',
  reminder                text not null default 'daily' check (reminder in ('daily', 'period', 'none')),
  reminder_time           time,
  age_confirmed_18        boolean not null default false,
  onboarded_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- A profile row exists for every account from the moment of sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, age_confirmed_18)
  values (new.id, coalesce((new.raw_user_meta_data->>'age_confirmed_18')::boolean, false));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- day_entries — one row per logged day
-- -----------------------------------------------------------------------------

create table public.day_entries (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date              date not null,
  bleeding          text check (bleeding in ('none', 'spotting', 'light', 'moderate', 'heavy', 'very_heavy')),
  impact            smallint check (impact between 0 and 3),
  impact_domains    text[],
  symptoms          jsonb not null default '{}'::jsonb,
  medications       jsonb not null default '[]'::jsonb,
  depth             text check (depth in ('quick', 'standard', 'detailed')),
  note              text check (char_length(note) <= 2000),
  revision          int not null default 1,
  client_updated_at timestamptz not null,
  -- Soft delete. "Clear this day" sets this; the day then reads as unknown, and
  -- other devices learn of the deletion through the normal change feed.
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (user_id, date),
  check (jsonb_typeof(symptoms) = 'object'),
  check (jsonb_typeof(medications) = 'array'),
  check (public.valid_symptoms(symptoms)),
  check (date <= (now() at time zone 'utc')::date + 1) -- no future logging (+1 day for timezones ahead of UTC)
);

create index day_entries_sync_idx on public.day_entries (user_id, updated_at);

create table public.day_entry_revisions (
  id          bigint generated always as identity primary key,
  entry_id    uuid not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  date        date not null,
  revision    int not null,
  snapshot    jsonb not null,
  replaced_at timestamptz not null default now()
);

create index day_entry_revisions_entry_idx on public.day_entry_revisions (entry_id, revision);

-- Copy the prior version before it is replaced. SECURITY DEFINER because users
-- have no INSERT privilege on the revisions table: they can read their history
-- but never write or alter it.
--
-- UPDATE only, deliberately. Users cannot hard-delete entries ("clear this day"
-- is a soft delete, which is an update and is archived). The only hard delete is
-- account erasure, which must take the history with it — and archiving during
-- that cascade would also fail, since the user row is already gone.
create or replace function public.archive_day_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.day_entry_revisions (entry_id, user_id, date, revision, snapshot)
  values (old.id, old.user_id, old.date, old.revision, to_jsonb(old));
  new.revision := old.revision + 1;
  return new;
end;
$$;

-- Order matters: stale writes are rejected BEFORE anything is archived.
create trigger day_entries_a_reject_stale before update on public.day_entries
  for each row execute function public.reject_stale_write();
create trigger day_entries_b_archive before update on public.day_entries
  for each row execute function public.archive_day_entry();
create trigger day_entries_c_touch before update on public.day_entries
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- treatments and clinical_events — event-based data
-- -----------------------------------------------------------------------------

create table public.treatments (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind                     text not null check (kind in (
                             'combined_oral_contraceptive', 'progestin', 'gnrh', 'iud', 'physiotherapy',
                             'pain_management', 'surgery', 'fertility', 'other')),
  label                    text not null check (char_length(label) between 1 and 120),
  start_date               date not null,
  end_date                 date,
  dose                     text check (char_length(dose) <= 120),
  reason                   text check (char_length(reason) <= 500),
  side_effects             text[] not null default '{}',
  patient_perceived_change text check (patient_perceived_change in ('better', 'unchanged', 'worse', 'unsure')),
  indication_symptom_id    text,
  client_updated_at        timestamptz not null,
  deleted_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create index treatments_sync_idx on public.treatments (user_id, updated_at);
create trigger treatments_a_reject_stale before update on public.treatments
  for each row execute function public.reject_stale_write();
create trigger treatments_b_touch before update on public.treatments
  for each row execute function public.touch_updated_at();

create table public.clinical_events (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind              text not null check (kind in (
                      'gp', 'gynaecology', 'emergency', 'referral', 'ultrasound', 'mri', 'ct',
                      'laparoscopy', 'surgery', 'diagnosis', 'fertility', 'admission')),
  date              date not null,
  label             text not null check (char_length(label) between 1 and 120),
  reason            text check (char_length(reason) <= 500),
  outcome           text check (char_length(outcome) <= 500),
  note              text check (char_length(note) <= 2000),
  client_updated_at timestamptz not null,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index clinical_events_sync_idx on public.clinical_events (user_id, updated_at);
create trigger clinical_events_a_reject_stale before update on public.clinical_events
  for each row execute function public.reject_stale_write();
create trigger clinical_events_b_touch before update on public.clinical_events
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- custom_symptoms — the patient's own vocabulary
-- -----------------------------------------------------------------------------

create table public.custom_symptoms (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symptom_key       text not null check (symptom_key ~ '^custom_[a-z0-9_]{1,48}$'),
  label             text not null check (char_length(label) between 1 and 60),
  domain            text not null check (domain in ('pain', 'bowel', 'urinary', 'systemic', 'sexual', 'extrapelvic')),
  graded            boolean not null default true,
  client_updated_at timestamptz not null,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, symptom_key)
);

create index custom_symptoms_sync_idx on public.custom_symptoms (user_id, updated_at);
create trigger custom_symptoms_a_reject_stale before update on public.custom_symptoms
  for each row execute function public.reject_stale_write();
create trigger custom_symptoms_b_touch before update on public.custom_symptoms
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- consents — an append-only event log (DPDP: a record of each grant and
-- withdrawal, per purpose, against a specific notice version)
-- -----------------------------------------------------------------------------

create table public.consents (
  id             bigint generated always as identity primary key,
  -- Generated on the device. Makes replaying the offline outbox idempotent: a
  -- retried write after a dropped connection cannot record a consent twice.
  client_id      uuid not null unique,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  purpose        text not null check (purpose in (
                   'core_tracking', 'sexual_health_module', 'fertility_module', 'research_use')),
  notice_version text not null check (char_length(notice_version) <= 20),
  granted        boolean not null,
  recorded_at    timestamptz not null default now()
);

create index consents_user_idx on public.consents (user_id, purpose, recorded_at desc);

-- The current state of each purpose is its most recent event.
create view public.current_consents
with (security_invoker = true)
as
select distinct on (user_id, purpose)
  user_id, purpose, notice_version, granted, recorded_at
from public.consents
order by user_id, purpose, recorded_at desc, id desc;

-- -----------------------------------------------------------------------------
-- audit_events — append-only
-- -----------------------------------------------------------------------------

create table public.audit_events (
  id          bigint generated always as identity primary key,
  client_id   uuid unique, -- set for patient-written events, for idempotent replay
  user_id     uuid not null references auth.users (id) on delete cascade,
  actor       text not null check (actor in ('patient', 'clinician_link', 'system')),
  action      text not null check (char_length(action) <= 60),
  target      text check (char_length(target) <= 200),
  recorded_at timestamptz not null default now()
);

create index audit_events_user_idx on public.audit_events (user_id, recorded_at desc);

-- -----------------------------------------------------------------------------
-- share_grants — an approved, immutable snapshot of the brief
-- -----------------------------------------------------------------------------

create table public.share_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Only the SHA-256 of the token is stored. The token itself is returned once,
  -- at creation, and cannot be recovered from the database.
  token_hash  text not null unique,
  snapshot    jsonb not null,
  sections    text[] not null default '{}',
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  view_count  int not null default 0,
  last_viewed timestamptz,
  created_at  timestamptz not null default now()
);

create index share_grants_user_idx on public.share_grants (user_id, created_at desc);

-- =============================================================================
-- Row-level security
-- =============================================================================

alter table public.profiles            enable row level security;
alter table public.day_entries         enable row level security;
alter table public.day_entry_revisions enable row level security;
alter table public.treatments          enable row level security;
alter table public.clinical_events     enable row level security;
alter table public.custom_symptoms     enable row level security;
alter table public.consents            enable row level security;
alter table public.audit_events        enable row level security;
alter table public.share_grants        enable row level security;

-- Defence in depth: anonymous clients get no table privileges at all, so a
-- missing policy can never be the only thing standing between anon and data.
revoke all on
  public.profiles, public.day_entries, public.day_entry_revisions, public.treatments,
  public.clinical_events, public.custom_symptoms, public.consents, public.audit_events,
  public.share_grants
from anon;
revoke all on public.current_consents from anon;

-- profiles: read and update your own. Rows are created by the sign-up trigger.
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, delete on public.profiles from authenticated;

-- Fully owned, mutable records. Deletion is soft (deleted_at), so hard DELETE is
-- revoked: it would bypass the revision history and could not sync to other
-- devices. Account erasure still cascades, because FK actions ignore privileges.
create policy day_entries_all on public.day_entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy treatments_all on public.treatments for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy clinical_events_all on public.clinical_events for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy custom_symptoms_all on public.custom_symptoms for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke delete on public.day_entries, public.treatments, public.clinical_events, public.custom_symptoms
  from authenticated;

-- History: readable, never writable by users. The archive trigger is the only writer.
create policy day_entry_revisions_select on public.day_entry_revisions for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.day_entry_revisions from authenticated;

-- Append-only logs: read and insert your own; no update, no delete.
create policy consents_select on public.consents for select to authenticated
  using (user_id = (select auth.uid()));
create policy consents_insert on public.consents for insert to authenticated
  with check (user_id = (select auth.uid()));
revoke update, delete on public.consents from authenticated;

create policy audit_events_select on public.audit_events for select to authenticated
  using (user_id = (select auth.uid()));
create policy audit_events_insert on public.audit_events for insert to authenticated
  with check (user_id = (select auth.uid()) and actor = 'patient');
revoke update, delete on public.audit_events from authenticated;

-- Share grants: owners see and revoke their own. Creation goes through
-- create_share_link() so the token is generated server-side; the only column
-- an owner may change afterwards is revoked_at.
create policy share_grants_select on public.share_grants for select to authenticated
  using (user_id = (select auth.uid()));
create policy share_grants_update on public.share_grants for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, update, delete on public.share_grants from authenticated;
grant update (revoked_at) on public.share_grants to authenticated;

-- =============================================================================
-- Functions — the only privileged entry points
-- =============================================================================

-- Create a share link for an approved snapshot. Returns the raw token once.
create or replace function public.create_share_link(
  p_snapshot jsonb,
  p_sections text[],
  p_days     int
)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_token  text;
  v_id     uuid;
  v_expiry timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_days not in (7, 30) then
    raise exception 'share links last 7 or 30 days' using errcode = '22023';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'snapshot must be an object' using errcode = '22023';
  end if;

  -- 32 random bytes, URL-safe base64: 256 bits, unguessable.
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_expiry := now() + make_interval(days => p_days);

  insert into public.share_grants (user_id, token_hash, snapshot, sections, expires_at)
  values (v_uid, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_snapshot, p_sections, v_expiry)
  returning share_grants.id into v_id;

  insert into public.audit_events (user_id, actor, action, target)
  values (v_uid, 'patient', 'share_link_created', v_id::text);

  return query select v_id, v_token, v_expiry;
end;
$$;

revoke all on function public.create_share_link(jsonb, text[], int) from public, anon;
grant execute on function public.create_share_link(jsonb, text[], int) to authenticated;

-- The single anonymous entry point. Given a token, returns the approved snapshot
-- if the link is live, and nothing otherwise. It cannot reach any other data.
create or replace function public.view_shared_report(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.share_grants%rowtype;
begin
  if p_token is null or char_length(p_token) < 20 then
    return null;
  end if;

  select * into v_grant
  from public.share_grants
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and revoked_at is null
    and expires_at > now();

  if not found then
    return null; -- expired, revoked and never-existed are indistinguishable
  end if;

  update public.share_grants
     set view_count = view_count + 1, last_viewed = now()
   where id = v_grant.id;

  insert into public.audit_events (user_id, actor, action, target)
  values (v_grant.user_id, 'clinician_link', 'share_link_viewed', v_grant.id::text);

  return jsonb_build_object(
    'snapshot',   v_grant.snapshot,
    'sections',   v_grant.sections,
    'created_at', v_grant.created_at,
    'expires_at', v_grant.expires_at
  );
end;
$$;

revoke all on function public.view_shared_report(text) from public;
grant execute on function public.view_shared_report(text) to anon, authenticated;

-- DPDP right to erasure. Deleting the auth user cascades to every table above.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

revoke all on function public.valid_symptoms(jsonb) from anon;
