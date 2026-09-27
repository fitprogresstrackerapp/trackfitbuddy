-- =============================================================================
-- Phone + PIN authentication support and atomic onboarding save.
--
-- Login flow (see docs/auth.md):
--   browser → Edge Function `pin-login` (service role)
--           → public.auth_verify_pin()  — bcrypt check + per-phone lockout
--           → Supabase Auth password sign-in with a server-derived secret
--   The PIN never reaches Supabase Auth and is never stored in plaintext.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- PIN credentials — private schema: not exposed through the Data API and not
-- granted to anon/authenticated. Only SECURITY DEFINER functions touch it.
-- -----------------------------------------------------------------------------
create table private.user_pins (
  user_id    uuid primary key references public.profiles (id),
  pin_hash   text not null constraint user_pins_bcrypt check (pin_hash like '$2%'),
  pin_set_at timestamptz not null default now(),
  pin_set_by uuid references public.profiles (id)
);

-- Failed-attempt tracking per phone number (also for unknown numbers, so a
-- lockout does not reveal whether an account exists).
create table private.login_attempts (
  phone          text primary key,
  failed_count   integer not null default 0 constraint login_attempts_count_nn check (failed_count >= 0),
  last_failed_at timestamptz,
  locked_until   timestamptz
);

revoke all on private.user_pins, private.login_attempts from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- auth_set_pin — create or reset a user's PIN (admin create-user / reset-PIN
-- server functions and the provisioning script). Service role only.
-- -----------------------------------------------------------------------------
create function public.auth_set_pin(p_user_id uuid, p_pin text, p_actor_id uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_phone  text;
  v_exists boolean;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits' using errcode = '22023';
  end if;

  select phone into v_phone from public.profiles where id = p_user_id;
  if v_phone is null then
    raise exception 'Unknown user' using errcode = 'P0002';
  end if;

  select exists (select 1 from private.user_pins where user_id = p_user_id) into v_exists;

  insert into private.user_pins (user_id, pin_hash, pin_set_at, pin_set_by)
  values (p_user_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), now(), p_actor_id)
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash, pin_set_at = excluded.pin_set_at, pin_set_by = excluded.pin_set_by;

  -- A new PIN clears any lockout on the number.
  delete from private.login_attempts where phone = v_phone;

  -- Audit without any PIN material.
  insert into public.audit_logs (actor_user_id, target_user_id, entity_type, entity_id, action, reason)
  values (
    p_actor_id, p_user_id, 'user_pins', p_user_id,
    case when v_exists then 'PIN_RESET' else 'CREATE' end::public.audit_action,
    nullif(current_setting('app.audit_reason', true), '')
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- auth_verify_pin — verify phone + PIN with lockout. Service role only.
-- Returns status:
--   OK       correct PIN, active account (user_id set)
--   INVALID  malformed input, unknown phone or wrong PIN (indistinguishable)
--   LOCKED   too many recent failures for this phone
--   DISABLED correct PIN but the account is deactivated
-- Policy: 5 failures within 15 minutes lock the phone for 15 minutes.
-- -----------------------------------------------------------------------------
create function public.auth_verify_pin(p_phone text, p_pin text)
returns table (status text, user_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_max_failures constant integer := 5;
  c_window       constant interval := interval '15 minutes';
  c_lock         constant interval := interval '15 minutes';
  v_attempt  private.login_attempts%rowtype;
  v_user_id  uuid;
  v_active   boolean;
  v_hash     text;
  v_ok       boolean;
  v_failures integer;
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' or p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return query select 'INVALID'::text, null::uuid;
    return;
  end if;

  -- Serialise attempts per phone so parallel guesses cannot exceed the limit.
  perform pg_advisory_xact_lock(hashtext('pin-login:' || p_phone));

  select * into v_attempt from private.login_attempts a where a.phone = p_phone;
  if v_attempt.locked_until is not null and v_attempt.locked_until > now() then
    return query select 'LOCKED'::text, null::uuid;
    return;
  end if;

  select p.id, p.is_active, up.pin_hash
    into v_user_id, v_active, v_hash
  from public.profiles p
  join private.user_pins up on up.user_id = p.id
  where p.phone = p_phone;

  if v_hash is null then
    -- Spend the same bcrypt work for unknown numbers (timing parity).
    perform extensions.crypt(p_pin, extensions.gen_salt('bf', 10));
    v_ok := false;
  else
    v_ok := extensions.crypt(p_pin, v_hash) = v_hash;
  end if;

  if not v_ok then
    v_failures := case
      when v_attempt.phone is null or v_attempt.last_failed_at < now() - c_window
           or v_attempt.locked_until is not null then 1
      else v_attempt.failed_count + 1
    end;

    insert into private.login_attempts as a (phone, failed_count, last_failed_at, locked_until)
    values (
      p_phone,
      case when v_failures >= c_max_failures then 0 else v_failures end,
      now(),
      case when v_failures >= c_max_failures then now() + c_lock end
    )
    on conflict (phone) do update
      set failed_count = excluded.failed_count,
          last_failed_at = excluded.last_failed_at,
          locked_until = excluded.locked_until;

    return query select 'INVALID'::text, null::uuid;
    return;
  end if;

  delete from private.login_attempts a where a.phone = p_phone;

  if not v_active then
    return query select 'DISABLED'::text, null::uuid;
    return;
  end if;

  return query select 'OK'::text, v_user_id;
end;
$$;

revoke all on function public.auth_set_pin(uuid, text, uuid), public.auth_verify_pin(text, text)
from public, anon, authenticated;
grant execute on function public.auth_set_pin(uuid, text, uuid), public.auth_verify_pin(text, text)
to service_role;

-- -----------------------------------------------------------------------------
-- save_onboarding_measurements — onboarding step 2, atomic and idempotent.
-- Runs as the caller (RLS and record guards apply). Sets height and records
-- the initial weight as today's MANUAL measurement; repeating the call (retry,
-- double submit, refresh) updates that same measurement instead of adding one.
-- -----------------------------------------------------------------------------
create function public.save_onboarding_measurements(p_height_cm numeric, p_weight_kg numeric)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_today   date;
  v_weight_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('onboarding:' || v_user_id::text));

  update public.profiles set height_cm = p_height_cm where id = v_user_id;
  if not found then
    raise exception 'Profile not available' using errcode = '42501';
  end if;

  v_today := private.user_local_date(v_user_id);

  select w.id into v_weight_id
  from public.weight_measurements w
  where w.user_id = v_user_id and w.measurement_date = v_today
    and w.source = 'MANUAL' and not w.is_deleted
  order by w.created_at desc
  limit 1;

  if v_weight_id is null then
    insert into public.weight_measurements (user_id, measurement_date, weight_kg, source)
    values (v_user_id, v_today, p_weight_kg, 'MANUAL');
  else
    update public.weight_measurements set weight_kg = p_weight_kg where id = v_weight_id;
  end if;
end;
$$;

revoke all on function public.save_onboarding_measurements(numeric, numeric) from public, anon;
grant execute on function public.save_onboarding_measurements(numeric, numeric) to authenticated;
