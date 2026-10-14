-- =============================================================================
-- Row-level security and integrity tests.
--
-- Run with:  supabase test db
--
-- Every claim the schema makes about who can see or change what is asserted
-- here against two real users and an anonymous client, rather than assumed.
-- =============================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

-- -----------------------------------------------------------------------------
-- Fixtures: two users. The sign-up trigger should create a profile for each.
-- -----------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'a@test.local', '{"age_confirmed_18": true}', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.local', '{}', 'authenticated', 'authenticated');

select is(
  (select count(*)::int from public.profiles),
  2,
  'a profile is created automatically for every new account'
);

select is(
  (select age_confirmed_18 from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  true,
  'the 18+ attestation from sign-up metadata is carried onto the profile'
);

create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;

-- -----------------------------------------------------------------------------
-- User A writes data
-- -----------------------------------------------------------------------------

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.day_entries (date, bleeding, impact, symptoms, client_updated_at)
     values ('2026-10-01', 'heavy', 2,
             '{"pelvic_pain": {"state": "present", "severity": 7}, "fatigue": {"state": "absent"}}',
             '2026-10-01 20:00+05:30') $$,
  'a user can log a day'
);

select lives_ok(
  $$ insert into public.treatments (kind, label, start_date, indication_symptom_id, client_updated_at)
     values ('progestin', 'Norethisterone 5 mg', '2026-09-01', 'pelvic_pain', now()) $$,
  'a user can add a treatment'
);

select lives_ok(
  $$ insert into public.clinical_events (kind, date, label, client_updated_at)
     values ('gp', '2026-09-10', 'GP appointment', now()) $$,
  'a user can add a clinical event'
);

select lives_ok(
  $$ insert into public.custom_symptoms (symptom_key, label, domain, client_updated_at)
     values ('custom_left_leg_pain', 'Sharp pain down left thigh', 'pain', now()) $$,
  'a user can define their own symptom'
);

select lives_ok(
  $$ insert into public.consents (client_id, purpose, notice_version, granted)
     values (gen_random_uuid(), 'core_tracking', '2026-10', true) $$,
  'a user can record consent'
);

-- -----------------------------------------------------------------------------
-- The tri-state is enforced in storage
-- -----------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.day_entries (date, symptoms, client_updated_at)
     values ('2026-10-02', '{"pelvic_pain": {"state": "unknown"}}', now()) $$,
  '23514',
  null,
  '"unknown" is never stored: an unobserved symptom is an absent key, not a value'
);

select throws_ok(
  $$ insert into public.day_entries (date, symptoms, client_updated_at)
     values ('2026-10-03', '{"pelvic_pain": {"state": "present", "severity": 11}}', now()) $$,
  '23514',
  null,
  'severity outside 0–10 is rejected'
);

select throws_ok(
  $$ insert into public.day_entries (date, client_updated_at)
     values (current_date + 5, now()) $$,
  '23514',
  null,
  'future days cannot be logged'
);

-- -----------------------------------------------------------------------------
-- History is never overwritten
-- -----------------------------------------------------------------------------

update public.day_entries
   set impact = 3, client_updated_at = '2026-10-02 09:00+05:30'
 where date = '2026-10-01';

select is(
  (select revision from public.day_entries where date = '2026-10-01'),
  2,
  'an edit increments the revision number'
);

select is(
  (select count(*)::int from public.day_entry_revisions),
  1,
  'an edit archives the previous version'
);

select is(
  (select (snapshot->>'impact')::int from public.day_entry_revisions limit 1),
  2,
  'the archived version holds the value as it was before the edit'
);

-- A write carrying an older edit time than the stored row is dropped.
update public.day_entries
   set impact = 0, client_updated_at = '2026-10-01 08:00+05:30'
 where date = '2026-10-01';

select is(
  (select impact::int from public.day_entries where date = '2026-10-01'),
  3,
  'a stale write from a late-syncing device does not overwrite a newer edit'
);

select is(
  (select count(*)::int from public.day_entry_revisions),
  1,
  'a rejected stale write is not archived'
);

-- Clearing a day is a soft delete, and is itself archived.
update public.day_entries
   set deleted_at = now(), client_updated_at = '2026-10-03 09:00+05:30'
 where date = '2026-10-01';

select is(
  (select count(*)::int from public.day_entry_revisions),
  2,
  'clearing a day archives what it held'
);

select throws_ok(
  $$ delete from public.day_entries where date = '2026-10-01' $$,
  '42501',
  null,
  'users cannot hard-delete entries, which would bypass history'
);

select throws_ok(
  $$ insert into public.day_entry_revisions (entry_id, user_id, date, revision, snapshot)
     values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '2026-10-01', 9, '{}') $$,
  '42501',
  null,
  'users cannot write to the revision history'
);

select throws_ok(
  $$ update public.day_entry_revisions set revision = 99 $$,
  '42501',
  null,
  'users cannot alter the revision history'
);

-- -----------------------------------------------------------------------------
-- Append-only logs
-- -----------------------------------------------------------------------------

select throws_ok(
  $$ update public.consents set granted = false $$,
  '42501',
  null,
  'consent records cannot be rewritten — withdrawal is a new event'
);

select throws_ok(
  $$ delete from public.consents $$,
  '42501',
  null,
  'consent records cannot be deleted'
);

select lives_ok(
  $$ insert into public.audit_events (user_id, actor, action)
     values ('11111111-1111-1111-1111-111111111111', 'patient', 'exported_data') $$,
  'a user can append to their own audit log'
);

select throws_ok(
  $$ insert into public.audit_events (user_id, actor, action)
     values ('11111111-1111-1111-1111-111111111111', 'system', 'forged') $$,
  '42501',
  null,
  'a user cannot write audit events attributed to anyone but themselves'
);

select throws_ok(
  $$ update public.audit_events set action = 'tampered' $$,
  '42501',
  null,
  'audit events cannot be altered'
);

-- -----------------------------------------------------------------------------
-- Sharing
-- -----------------------------------------------------------------------------

create temp table share_token as
select * from public.create_share_link('{"claims": ["test"]}', '{findings}', 7);
grant select on share_token to anon, authenticated;

select is(
  (select count(*)::int from share_token),
  1,
  'a user can create a share link'
);

select isnt(
  (select token_hash from public.share_grants limit 1),
  (select token from share_token),
  'the raw token is not stored — only its hash'
);

select throws_ok(
  $$ select * from public.create_share_link('{}', '{}', 365) $$,
  '22023',
  null,
  'share links are limited to 7 or 30 days'
);

select throws_ok(
  $$ update public.share_grants set snapshot = '{"tampered": true}' $$,
  '42501',
  null,
  'a shared snapshot cannot be altered after creation'
);

-- -----------------------------------------------------------------------------
-- User B sees none of user A's data
-- -----------------------------------------------------------------------------

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');

select is_empty($$ select 1 from public.day_entries $$,         'B cannot read A''s day entries');
select is_empty($$ select 1 from public.day_entry_revisions $$, 'B cannot read A''s revision history');
select is_empty($$ select 1 from public.treatments $$,          'B cannot read A''s treatments');
select is_empty($$ select 1 from public.clinical_events $$,     'B cannot read A''s clinical events');
select is_empty($$ select 1 from public.custom_symptoms $$,     'B cannot read A''s custom symptoms');
select is_empty($$ select 1 from public.consents $$,            'B cannot read A''s consents');
select is_empty($$ select 1 from public.audit_events $$,        'B cannot read A''s audit log');
select is_empty($$ select 1 from public.share_grants $$,        'B cannot read A''s share links');

select is(
  (select count(*)::int from public.profiles),
  1,
  'B sees exactly one profile: their own'
);

update public.treatments set label = 'hijacked';
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(
  (select label from public.treatments limit 1),
  'Norethisterone 5 mg',
  'B''s update against A''s rows changes nothing'
);

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ insert into public.day_entries (user_id, date, client_updated_at)
     values ('11111111-1111-1111-1111-111111111111', '2026-10-05', now()) $$,
  '42501',
  null,
  'B cannot write a row into A''s record'
);

-- -----------------------------------------------------------------------------
-- Anonymous clients: no table access; only the share function
-- -----------------------------------------------------------------------------

select pg_temp.as_anon();

select throws_ok(
  $$ select 1 from public.day_entries $$,
  '42501',
  null,
  'anonymous clients have no access to day entries'
);

select throws_ok(
  $$ select 1 from public.share_grants $$,
  '42501',
  null,
  'anonymous clients cannot list share links'
);

select is(
  (select public.view_shared_report((select token from share_token))->'snapshot'),
  '{"claims": ["test"]}'::jsonb,
  'a valid token returns exactly the approved snapshot'
);

select is(
  public.view_shared_report('not-a-real-token-but-long-enough'),
  null,
  'an unknown token returns nothing'
);

-- Revoke, then the same token must stop working.
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
update public.share_grants set revoked_at = now();
select pg_temp.as_anon();

select is(
  public.view_shared_report((select token from share_token)),
  null,
  'a revoked link returns nothing'
);

-- -----------------------------------------------------------------------------
-- Erasure
-- -----------------------------------------------------------------------------

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select lives_ok($$ select public.delete_my_account() $$, 'a user can delete their account');

reset role;
select is(
  (select count(*)::int from public.day_entries where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from public.day_entry_revisions where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from public.treatments where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from public.share_grants where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from public.audit_events where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'deleting an account erases every row, including history and audit'
);

select * from finish();
rollback;
