-- =============================================================================
-- Groups and memberships (spec §46–48, §64). Group roles are independent of
-- global RBAC.
-- =============================================================================

create function private.generate_group_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- No ambiguous characters (0/O, 1/I/L).
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
      into v_code
    from generate_series(1, 8);
    exit when not exists (select 1 from public.groups g where g.code = v_code);
  end loop;
  return v_code;
end;
$$;

create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null constraint groups_name_length check (char_length(btrim(name)) between 1 and 60),
  description text constraint groups_description_length check (char_length(description) <= 500),
  -- One code per group; no regeneration in Phase 1 (immutable, see trigger).
  code        text not null unique default private.generate_group_code()
                constraint groups_code_format check (code ~ '^[A-Z0-9]{6,12}$'),
  creator_id  uuid not null default auth.uid() references public.profiles (id),
  is_active   boolean not null default true,
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint groups_deleted_consistent check (is_active = (deleted_at is null))
);

create trigger groups_set_updated_at
before update on public.groups
for each row execute function private.set_updated_at();

create table public.group_memberships (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id),
  user_id    uuid not null references public.profiles (id),
  role       public.group_role not null default 'MEMBER',
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  removed_by uuid references public.profiles (id), -- null when the member left voluntarily
  is_active  boolean not null default true,
  constraint group_memberships_active_consistent check (is_active = (left_at is null)),
  constraint group_memberships_removed_inactive check (removed_by is null or not is_active)
);

-- One active membership per user per group; past memberships are kept.
create unique index group_memberships_active_unique on public.group_memberships (group_id, user_id) where is_active;
create index group_memberships_group_user_idx on public.group_memberships (group_id, user_id);
create index group_memberships_user_active_idx on public.group_memberships (user_id) where is_active;

-- -----------------------------------------------------------------------------
-- Group helpers (SECURITY DEFINER: read memberships without recursing into
-- group_memberships RLS). They answer only for the calling user.
-- -----------------------------------------------------------------------------
create function private.group_role_of_caller(p_group_id uuid)
returns public.group_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.group_memberships m
  join public.groups g on g.id = m.group_id and g.is_active
  join public.profiles p on p.id = m.user_id and p.is_active
  where m.group_id = p_group_id and m.user_id = (select auth.uid()) and m.is_active;
$$;

create function private.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.group_role_of_caller(p_group_id) is not null;
$$;

create function private.is_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.group_role_of_caller(p_group_id) = 'ADMIN';
$$;

revoke all on function
  private.group_role_of_caller(uuid), private.is_group_member(uuid), private.is_group_admin(uuid),
  private.generate_group_code()
from public;
grant execute on function
  private.group_role_of_caller(uuid), private.is_group_member(uuid), private.is_group_admin(uuid),
  private.generate_group_code()
to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Integrity triggers
-- -----------------------------------------------------------------------------

-- The creator becomes the group's ADMIN member.
create function private.add_group_creator_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.group_memberships (group_id, user_id, role)
  values (new.id, new.creator_id, 'ADMIN');
  return null;
end;
$$;

create trigger groups_add_creator_membership
after insert on public.groups
for each row execute function private.add_group_creator_membership();

create function private.guard_group()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code <> old.code or new.creator_id <> old.creator_id or new.created_at <> old.created_at then
    raise exception 'Group code, creator and creation time are immutable' using errcode = '42501';
  end if;
  if old.is_active and not new.is_active then
    new.deleted_at := coalesce(new.deleted_at, now());
    new.deleted_by := coalesce(new.deleted_by, private.current_actor_id());
  elsif not old.is_active and new.is_active then
    new.deleted_at := null;
    new.deleted_by := null;
  end if;
  return new;
end;
$$;

create trigger groups_guard
before update on public.groups
for each row execute function private.guard_group();

-- Membership changes (spec §46): any member may leave; only the group admin may
-- remove others or change roles. Memberships are never reactivated — rejoining
-- creates a new row, so history before a departure stays inaccessible.
create function private.guard_group_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_actor_id();
  v_privileged boolean := auth.uid() is null or private.is_admin();
begin
  if new.group_id <> old.group_id or new.user_id <> old.user_id or new.joined_at <> old.joined_at then
    raise exception 'Membership group, user and join time are immutable' using errcode = '42501';
  end if;

  if not old.is_active and new.is_active then
    raise exception 'Memberships cannot be reactivated; rejoin instead' using errcode = '42501';
  end if;

  if not v_privileged then
    if new.role <> old.role and not private.is_group_admin(old.group_id) then
      raise exception 'Only a group admin can change member roles' using errcode = '42501';
    end if;
    if old.is_active and not new.is_active
       and old.user_id <> auth.uid() and not private.is_group_admin(old.group_id) then
      raise exception 'Only a group admin can remove other members' using errcode = '42501';
    end if;
  end if;

  if old.is_active and not new.is_active then
    new.left_at := now();
    new.removed_by := case when old.user_id = v_actor then null else v_actor end;
  end if;

  return new;
end;
$$;

create trigger group_memberships_guard
before update on public.group_memberships
for each row execute function private.guard_group_membership();

-- -----------------------------------------------------------------------------
-- Group-visible data (spec §47–48). The ONLY way group members read each
-- other's data: calories/protein vs personal target, steps, workout done.
-- Weight, body fat, InBody and calculation inputs are never returned.
-- Visible only for current members of an active group, only about current
-- members, and only for dates on/after the viewed member joined.
-- -----------------------------------------------------------------------------
create function public.get_group_member_day(p_group_id uuid, p_date date)
returns table (
  user_id          uuid,
  name             text,
  group_role       public.group_role,
  calories         numeric,
  calories_target  integer,
  protein_g        numeric,
  protein_target_g numeric,
  steps            integer,
  workout_logged   boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_group_member(p_group_id) then
    raise exception 'Not a member of this group' using errcode = '42501';
  end if;

  return query
  select
    m.user_id,
    p.name,
    m.role,
    n.calories,
    t.calories,
    n.protein_g,
    t.protein_g,
    s.steps,
    exists (
      select 1 from public.workouts w
      where w.user_id = m.user_id and w.workout_date = p_date and not w.is_deleted
    )
  from public.group_memberships m
  join public.profiles p on p.id = m.user_id and p.is_active
  left join public.daily_target_snapshots t on t.user_id = m.user_id and t.target_date = p_date
  left join lateral (
    -- No meal items → null (missing data is not zero).
    select sum(mi.snapshot_calories) as calories, sum(mi.snapshot_protein_g) as protein_g
    from public.meals ml
    join public.meal_items mi on mi.meal_id = ml.id and not mi.is_deleted
    where ml.user_id = m.user_id and ml.meal_date = p_date and not ml.is_deleted
  ) n on true
  left join public.steps_entries s
    on s.user_id = m.user_id and s.entry_date = p_date and s.is_active and not s.is_deleted
  where m.group_id = p_group_id
    and m.is_active
    and p_date >= (m.joined_at at time zone p.timezone)::date
  order by p.name nulls last, m.user_id;
end;
$$;

revoke all on function public.get_group_member_day(uuid, date) from public, anon;
grant execute on function public.get_group_member_day(uuid, date) to authenticated;
