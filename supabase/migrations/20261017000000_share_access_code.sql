-- =============================================================================
-- Share links need an access code
--
-- A link alone was enough to open a shared report, so a forwarded or leaked link
-- exposed it. Now every link also needs a 6-digit code, made on the server and
-- shown to the patient once, which she gives the clinician by another route
-- (aloud, or in a different message). Five wrong codes lock the link for good.
-- Links can also last a single day.
-- =============================================================================

alter table public.share_grants
  -- SHA-256 of token || ':' || code. Keyed by the token, so the hash says nothing
  -- about the code without the link, and the link alone cannot open the report.
  add column code_hash text,
  add column failed_attempts int not null default 0;

-- Links made before this change have no code and can no longer be opened.
update public.share_grants set revoked_at = now() where revoked_at is null;

-- The return type changes (it now includes the code), so replace, not alter.
drop function public.create_share_link(jsonb, text[], int);

create function public.create_share_link(
  p_snapshot jsonb,
  p_sections text[],
  p_days     int
)
returns table (id uuid, token text, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_token  text;
  v_code   text;
  v_id     uuid;
  v_expiry timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_days not in (1, 7, 30) then
    raise exception 'share links last 1, 7 or 30 days' using errcode = '22023';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'snapshot must be an object' using errcode = '22023';
  end if;

  -- 32 random bytes, URL-safe base64: 256 bits, unguessable.
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  -- 6 digits from 4 random bytes (the modulo bias is negligible at this size).
  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  v_expiry := now() + make_interval(days => p_days);

  insert into public.share_grants (user_id, token_hash, code_hash, snapshot, sections, expires_at)
  values (
    v_uid,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    encode(extensions.digest(v_token || ':' || v_code, 'sha256'), 'hex'),
    p_snapshot,
    p_sections,
    v_expiry
  )
  returning share_grants.id into v_id;

  insert into public.audit_events (user_id, actor, action, target)
  values (v_uid, 'patient', 'share_link_created', v_id::text);

  return query select v_id, v_token, v_code, v_expiry;
end;
$$;

revoke all on function public.create_share_link(jsonb, text[], int) from public, anon;
grant execute on function public.create_share_link(jsonb, text[], int) to authenticated;

-- The single anonymous entry point now takes the code too.
drop function public.view_shared_report(text);

create function public.view_shared_report(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.share_grants%rowtype;
begin
  if p_token is null or char_length(p_token) < 20 or p_code is null then
    return null;
  end if;

  select * into v_grant
  from public.share_grants
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and revoked_at is null
    and expires_at > now()
    and code_hash is not null
  for update;

  if not found then
    return null; -- expired, revoked, locked and never-existed are indistinguishable
  end if;

  if v_grant.code_hash <> encode(extensions.digest(p_token || ':' || p_code, 'sha256'), 'hex') then
    -- A wrong code. After five, the link locks for good: guessing 1 in a million
    -- five times is hopeless, and the patient sees the link disappear.
    update public.share_grants
       set failed_attempts = failed_attempts + 1,
           revoked_at = case when failed_attempts + 1 >= 5 then now() end
     where id = v_grant.id;
    insert into public.audit_events (user_id, actor, action, target)
    values (
      v_grant.user_id, 'clinician_link',
      case when v_grant.failed_attempts + 1 >= 5 then 'share_link_locked' else 'share_link_wrong_code' end,
      v_grant.id::text
    );
    return null;
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

revoke all on function public.view_shared_report(text, text) from public;
grant execute on function public.view_shared_report(text, text) to anon, authenticated;
