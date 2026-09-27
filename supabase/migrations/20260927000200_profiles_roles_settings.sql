-- =============================================================================
-- Identity & access: profiles, global roles, manager assignments, settings,
-- and the SECURITY DEFINER helpers RLS policies are built on.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles — one row per auth user (profiles.id = auth.users.id).
-- Not stored here on purpose:
--   * age          → derived from date_of_birth (spec §50)
--   * current weight → latest row in weight_measurements (single source of truth)
--   * goals / objective → goals + goal_focuses (versioned, cycle-lockable)
--   * is_profile_complete → derived; see view public.profile_readiness
--   * PIN          → Supabase Auth credential, never stored in public tables
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete restrict,
  phone                 text not null unique
                          constraint profiles_phone_e164 check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  name                  text constraint profiles_name_length check (char_length(btrim(name)) between 1 and 100),
  date_of_birth         date constraint profiles_dob_range check (date_of_birth >= date '1900-01-01'),
  gender                public.gender,
  height_cm             numeric(5, 1) constraint profiles_height_range check (height_cm between 50 and 272),
  activity_level        public.activity_level,
  job                   text constraint profiles_job_length check (char_length(job) <= 200),
  hobbies               text constraint profiles_hobbies_length check (char_length(hobbies) <= 500),
  bmr_kcal              integer constraint profiles_bmr_range check (bmr_kcal between 500 and 5000),
  -- Realistic weekly workout capacity (spec §16). Current preference; each
  -- recommendation cycle stores its own locked copy.
  workout_days_per_week smallint constraint profiles_workout_capacity check (workout_days_per_week between 2 and 6),
  -- IANA zone used for all calendar-day rules ("today", locking, Mon–Sun weeks).
  timezone              text not null default 'Asia/Kolkata',
  is_active             boolean not null default true,
  deleted_at            timestamptz,
  deactivated_by        uuid references public.profiles (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint profiles_deactivation_consistent check (
    (is_active and deleted_at is null and deactivated_by is null)
    or (not is_active and deleted_at is not null)
  )
);

comment on table public.profiles is 'Application user profile; id equals auth.users.id. Soft-deactivated, never hard-deleted.';
create index profiles_active_idx on public.profiles (is_active);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- user_roles — global RBAC (spec §51). Group leadership is NOT a global role;
-- it lives in group_memberships.role.
-- -----------------------------------------------------------------------------
create table public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id),
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  constraint user_roles_unique unique (user_id, role)
);

create index user_roles_role_idx on public.user_roles (role);

-- -----------------------------------------------------------------------------
-- manager_user_assignments — manager/trainer → assigned users (spec §52).
-- -----------------------------------------------------------------------------
create table public.manager_user_assignments (
  id         uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.profiles (id),
  user_id    uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  constraint manager_user_assignments_unique unique (manager_id, user_id),
  constraint manager_user_assignments_not_self check (manager_id <> user_id)
);

create index manager_user_assignments_user_idx on public.manager_user_assignments (user_id);

-- -----------------------------------------------------------------------------
-- system_settings — central configuration (spec §77).
-- -----------------------------------------------------------------------------
create table public.system_settings (
  key         text primary key constraint system_settings_key_format check (key ~ '^[a-z][a-z0-9_]*$'),
  value_json  jsonb not null,
  description text,
  updated_by  uuid references public.profiles (id),
  updated_at  timestamptz not null default now()
);

create function private.validate_system_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v jsonb := new.value_json;
begin
  case new.key
    when 'nutrition_tolerance' then
      -- spec §27: admin can configure 80 / 85 / 90 %
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not in (0.80, 0.85, 0.90) then
        raise exception 'nutrition_tolerance must be one of 0.80, 0.85, 0.90' using errcode = '22023';
      end if;
    when 'calorie_lower_tolerance' then
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 0.50 and 1.00 then
        raise exception 'calorie_lower_tolerance must be a number between 0.50 and 1.00' using errcode = '22023';
      end if;
    when 'calorie_upper_tolerance' then
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 1.00 and 2.00 then
        raise exception 'calorie_upper_tolerance must be a number between 1.00 and 2.00' using errcode = '22023';
      end if;
    when 'ai_monthly_budget' then
      if jsonb_typeof(v) not in ('number', 'null') or (jsonb_typeof(v) = 'number' and (v::text)::numeric < 0) then
        raise exception 'ai_monthly_budget must be null or a non-negative number' using errcode = '22023';
      end if;
    when 'ai_batch_size' then
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric <> trunc((v::text)::numeric)
         or (v::text)::numeric not between 1 and 100 then
        raise exception 'ai_batch_size must be an integer between 1 and 100' using errcode = '22023';
      end if;
    when 'recommendation_processing_day' then
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric <> trunc((v::text)::numeric)
         or (v::text)::numeric not between 1 and 28 then
        raise exception 'recommendation_processing_day must be an integer between 1 and 28' using errcode = '22023';
      end if;
    when 'ai_provider', 'ai_model' then
      if jsonb_typeof(v) not in ('string', 'null') then
        raise exception '% must be a string or null', new.key using errcode = '22023';
      end if;
    when 'ai_budget_currency' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[A-Z]{3}$' then
        raise exception 'ai_budget_currency must be an ISO 4217 code' using errcode = '22023';
      end if;
    else
      null; -- unknown keys are allowed but unvalidated
  end case;

  new.updated_at := now();
  new.updated_by := private.current_actor_id();
  return new;
end;
$$;

create trigger system_settings_validate
before insert or update on public.system_settings
for each row execute function private.validate_system_setting();

-- Phase 1 defaults (spec §27, §38, §30, §77). Configuration, not demo data.
insert into public.system_settings (key, value_json, description) values
  ('nutrition_tolerance',           '0.85',  'Minimum fraction of a higher-is-better nutrient target that counts as met.'),
  ('calorie_lower_tolerance',       '0.85',  'Lower bound of the acceptable calorie range, as a fraction of target.'),
  ('calorie_upper_tolerance',       '1.10',  'Upper bound of the acceptable calorie range, as a fraction of target.'),
  ('ai_monthly_budget',             'null',  'Monthly AI spend limit in ai_budget_currency; null = not configured (processing must not start).'),
  ('ai_budget_currency',            '"INR"', 'Currency for AI budget and cost tracking.'),
  ('ai_batch_size',                 '12',    'Users per AI processing batch (spec: initially 10–15).'),
  ('ai_provider',                   'null',  'Active AI provider identifier.'),
  ('ai_model',                      'null',  'Active AI model identifier.'),
  ('recommendation_processing_day', '4',     'Ideal day of month for recommendation processing.');

-- -----------------------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so they can read role/assignment tables
-- without triggering those tables' own RLS (prevents policy recursion).
-- They only ever answer questions about the *calling* user, so they cannot be
-- used to probe other users' privileges.
-- -----------------------------------------------------------------------------

create function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  );
$$;

create function private.has_role(p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles r
    join public.profiles p on p.id = r.user_id
    where r.user_id = (select auth.uid())
      and r.role = p_role
      and p.is_active
  );
$$;

create function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('SUPER_ADMIN');
$$;

-- ADMIN or SUPER_ADMIN: operational access across users.
create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('ADMIN') or private.has_role('SUPER_ADMIN');
$$;

-- Highest global role of the caller (null when not an active user).
create function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select r.role
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
  where r.user_id = (select auth.uid()) and p.is_active
  order by r.role  -- enum order: SUPER_ADMIN < ADMIN < MANAGER < USER
  limit 1;
$$;

-- Does a given user hold a role? Used by admin policies (e.g. admins may not
-- touch super admins). Only meaningful to admins; callers see no data.
create function private.user_has_role(p_user_id uuid, p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.user_roles where user_id = p_user_id and role = p_role);
$$;

-- Caller is an active MANAGER assigned to the given active user.
create function private.is_manager_of(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('MANAGER')
    and exists (
      select 1
      from public.manager_user_assignments a
      join public.profiles target on target.id = a.user_id
      where a.manager_id = (select auth.uid())
        and a.user_id = p_user_id
        and target.is_active
    );
$$;

-- The calendar date "today" for a user, in the user's own timezone.
create function private.user_local_date(p_user_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone p.timezone)::date from public.profiles p where p.id = p_user_id;
$$;

revoke all on function
  private.is_active_user(), private.has_role(public.app_role), private.is_super_admin(),
  private.is_admin(), private.current_app_role(), private.user_has_role(uuid, public.app_role),
  private.is_manager_of(uuid), private.user_local_date(uuid)
from public;
grant execute on function
  private.is_active_user(), private.has_role(public.app_role), private.is_super_admin(),
  private.is_admin(), private.current_app_role(), private.user_has_role(uuid, public.app_role),
  private.is_manager_of(uuid), private.user_local_date(uuid)
to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Profile integrity
-- -----------------------------------------------------------------------------

create function private.guard_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_actor_id();
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;

  if new.date_of_birth is not null and new.date_of_birth >= current_date then
    raise exception 'date_of_birth must be in the past' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.created_at <> old.created_at then
      raise exception 'profiles.id and created_at are immutable' using errcode = '42501';
    end if;

    -- Phone is the auth login identifier; it may only change through trusted
    -- server code that also updates auth.users.
    if auth.uid() is not null and new.phone <> old.phone then
      raise exception 'phone can only be changed by the server' using errcode = '42501';
    end if;

    if auth.uid() is not null and not private.is_admin() then
      if new.is_active is distinct from old.is_active
         or new.deleted_at is distinct from old.deleted_at
         or new.deactivated_by is distinct from old.deactivated_by then
        raise exception 'Only admins can change account status' using errcode = '42501';
      end if;
    end if;

    -- Admins cannot manage super-admin authority (spec §6).
    if auth.uid() is not null
       and old.id <> auth.uid()
       and not private.is_super_admin()
       and private.user_has_role(old.id, 'SUPER_ADMIN') then
      raise exception 'Only a super admin can modify a super admin profile' using errcode = '42501';
    end if;

    -- Stamp (de)activation.
    if old.is_active and not new.is_active then
      new.deleted_at := coalesce(new.deleted_at, now());
      new.deactivated_by := coalesce(new.deactivated_by, v_actor);
    elsif not old.is_active and new.is_active then
      new.deleted_at := null;
      new.deactivated_by := null;
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_guard
before insert or update on public.profiles
for each row execute function private.guard_profile();

-- Every profile starts with the USER role.
create function private.grant_default_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_roles (user_id, role, created_by)
  values (new.id, 'USER', private.current_actor_id())
  on conflict (user_id, role) do nothing;
  return new;
end;
$$;

create trigger profiles_grant_default_role
after insert on public.profiles
for each row execute function private.grant_default_role();

-- There must always be at least one active super admin once one exists.
create function private.protect_last_super_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'SUPER_ADMIN' and not exists (
    select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
    where r.role = 'SUPER_ADMIN' and r.id <> old.id and p.is_active
  ) then
    raise exception 'Cannot remove the last active super admin' using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger user_roles_protect_last_super_admin
before delete on public.user_roles
for each row execute function private.protect_last_super_admin();

create function private.validate_manager_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.user_roles where user_id = new.manager_id and role = 'MANAGER') then
    raise exception 'Assigned manager must hold the MANAGER role' using errcode = '23514';
  end if;
  new.created_by := coalesce(new.created_by, private.current_actor_id());
  return new;
end;
$$;

create trigger manager_user_assignments_validate
before insert or update on public.manager_user_assignments
for each row execute function private.validate_manager_assignment();
