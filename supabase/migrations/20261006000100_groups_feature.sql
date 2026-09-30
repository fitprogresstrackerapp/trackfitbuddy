-- =============================================================================
-- Groups & shared progress (spec §46–48, §64–65). Prompt 11.
--
-- Builds on the existing groups / group_memberships tables (…0600). It adds
-- no new tables. Group roles stay the spec's MEMBER / LEADER / ADMIN and are
-- independent of global RBAC.
--
--   * Server-side functions for every group action (create, preview, join,
--     leave, remove, change role). Codes are generated and normalised on the
--     server; the browser never chooses creators, members or privileges.
--   * Admin continuity: the only group admin can't leave (or step down)
--     while other members remain; they make someone else admin first. The
--     last member leaving deactivates the group (soft delete).
--   * Shared data remains available only through get_group_member_day(). It
--     is rebuilt with:
--       - the target in force on the date (snapshot, else the covering
--         cycle);
--       - the same nutrition aggregation as Progress and recommendations;
--       - the role-based history rule below.
--   * History rule: a member's data is shown from the day that member joined.
--     A MEMBER sees only dates from their own join day onward; a LEADER or
--     ADMIN also sees the time before they joined ("limited historical
--     access", spec §48). Former members see nothing.
--   * Audit: creation, join, leave, removal, role change and deactivation
--     (the previous triggers skipped a user's own actions).
--   * A creator who left can no longer read the group row.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- is_group_admin() returned NULL (not false) for someone outside the group,
-- and `if not NULL` does not fire. It now always answers true or false, so no
-- caller's `if not private.is_group_admin(…)` check can be bypassed.
-- -----------------------------------------------------------------------------
create or replace function private.is_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.group_role_of_caller(p_group_id) = 'ADMIN', false);
$$;

-- -----------------------------------------------------------------------------
-- Group row visibility: members (and app admins). The creator clause now only
-- covers the moment of creation (INSERT … RETURNING runs before the creator's
-- membership row exists), so a creator who left loses access like anyone else.
-- -----------------------------------------------------------------------------
create function private.group_creation_pending(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.group_memberships m where m.group_id = p_group_id);
$$;

revoke all on function private.group_creation_pending(uuid) from public, anon;
grant execute on function private.group_creation_pending(uuid) to authenticated, service_role;

drop policy groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
using (
  private.is_group_member(id)
  or (creator_id = (select auth.uid()) and private.group_creation_pending(id))
  or (select private.is_admin())
);

-- -----------------------------------------------------------------------------
-- Membership integrity: the previous rules, plus admin continuity.
-- -----------------------------------------------------------------------------
create or replace function private.guard_group_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_actor_id();
  v_privileged boolean := auth.uid() is null or private.is_admin();
  v_loses_admin boolean;
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

  -- A group always keeps an admin while it has members.
  v_loses_admin := old.is_active and old.role = 'ADMIN' and (not new.is_active or new.role <> 'ADMIN');
  if v_loses_admin
     and not exists (
       select 1 from public.group_memberships o
       where o.group_id = old.group_id and o.id <> old.id and o.is_active and o.role = 'ADMIN'
     )
     and exists (
       select 1 from public.group_memberships o
       where o.group_id = old.group_id and o.id <> old.id and o.is_active
     ) then
    raise exception 'Make another member a group admin first' using errcode = 'P0001';
  end if;

  if old.is_active and not new.is_active then
    new.left_at := now();
    new.removed_by := case when old.user_id = v_actor then null else v_actor end;
  end if;

  return new;
end;
$$;

-- The last member leaving deactivates the group (it has nobody to show).
create function private.deactivate_empty_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_active and not new.is_active
     and not exists (select 1 from public.group_memberships m where m.group_id = new.group_id and m.is_active) then
    update public.groups set is_active = false where id = new.group_id and is_active;
  end if;
  return null;
end;
$$;

create trigger group_memberships_deactivate_empty_group
after update on public.group_memberships
for each row execute function private.deactivate_empty_group();

-- -----------------------------------------------------------------------------
-- Audit (spec §63): every group and membership change, including a user's
-- own. Only structure is logged (names, roles, dates), never member data.
-- -----------------------------------------------------------------------------
drop trigger groups_audit on public.groups;
drop trigger group_memberships_audit on public.group_memberships;

create function private.audit_group_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.audit_action;
  v_reason text;
  v_owner uuid;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_table_name = 'groups' then
    v_owner := new.creator_id;
    if tg_op = 'INSERT' then
      v_action := 'CREATE';
      v_reason := 'Group created';
      v_new := jsonb_build_object('name', new.name, 'description', new.description);
    elsif old.is_active and not new.is_active then
      v_action := 'DELETE';
      v_reason := 'Group deactivated';
    elsif (new.name, new.description) is distinct from (old.name, old.description) then
      v_action := 'UPDATE';
      v_old := jsonb_build_object('name', old.name, 'description', old.description);
      v_new := jsonb_build_object('name', new.name, 'description', new.description);
    else
      return null;
    end if;
  else
    v_owner := new.user_id;
    if tg_op = 'INSERT' then
      v_action := 'CREATE';
      v_reason := case when new.role = 'ADMIN' then 'Created group (group admin)' else 'Joined group' end;
      v_new := jsonb_build_object('group_id', new.group_id, 'role', new.role);
    elsif old.is_active and not new.is_active then
      v_action := 'DELETE';
      v_reason := case when new.removed_by is null then 'Left group' else 'Removed by group admin' end;
      v_old := jsonb_build_object('group_id', old.group_id, 'role', old.role);
    elsif new.role <> old.role then
      v_action := 'ROLE_CHANGE';
      v_reason := 'Group role changed';
      v_old := jsonb_build_object('group_id', old.group_id, 'role', old.role);
      v_new := jsonb_build_object('group_id', new.group_id, 'role', new.role);
    else
      return null;
    end if;
  end if;

  insert into public.audit_logs (
    actor_user_id, target_user_id, entity_type, entity_id, action, old_values_json, new_values_json, reason
  ) values (
    private.current_actor_id(), v_owner, tg_table_name, new.id, v_action, v_old, v_new, v_reason
  );
  return null;
end;
$$;

create trigger groups_audit after insert or update on public.groups
  for each row execute function private.audit_group_change();
create trigger group_memberships_audit after insert or update on public.group_memberships
  for each row execute function private.audit_group_change();

-- -----------------------------------------------------------------------------
-- Group actions. SECURITY DEFINER, always acting for auth.uid(); nothing the
-- caller passes can name another creator, member or privilege.
-- -----------------------------------------------------------------------------

-- Codes are typed by people: case, spaces and dashes are ignored.
create function private.normalize_group_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
$$;

create function private.require_active_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- Create: the group, its server-generated code and the creator's ADMIN
-- membership, in one transaction (the membership comes from the existing
-- groups_add_creator_membership trigger).
create function public.create_group(p_name text, p_description text default null)
returns table (id uuid, code text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_active_user();
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if char_length(v_name) not between 1 and 60 then
    raise exception 'The group name must be 1–60 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(v_description, '')) > 500 then
    raise exception 'The description can be at most 500 characters' using errcode = '22023';
  end if;
  return query
  insert into public.groups as g (name, description, creator_id)
  values (v_name, v_description, v_user)
  returning g.id, g.code;
end;
$$;

-- Confirm step (spec §46): the group behind a code, before joining. An
-- unknown or inactive code returns no row; nothing else is revealed.
create function public.preview_group(p_code text)
returns table (id uuid, name text, description text, member_count integer, already_member boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_active_user();
begin
  return query
  select g.id, g.name, g.description,
         (select count(*)::integer from public.group_memberships m
          join public.profiles p on p.id = m.user_id and p.is_active
          where m.group_id = g.id and m.is_active),
         exists (select 1 from public.group_memberships m
                 where m.group_id = g.id and m.user_id = v_user and m.is_active)
  from public.groups g
  where g.code = private.normalize_group_code(p_code) and g.is_active;
end;
$$;

-- Join by code: immediate access (spec §46). Joining a group you're already
-- in changes nothing. Rejoining after leaving creates a new membership
-- (earlier ones stay as history).
create function public.join_group(p_code text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_active_user();
  v_group uuid;
begin
  select g.id into v_group from public.groups g
  where g.code = private.normalize_group_code(p_code) and g.is_active;
  if v_group is null then
    raise exception 'Invalid group code' using errcode = 'P0002';
  end if;

  perform set_config('app.actor_id', v_user::text, true);
  insert into public.group_memberships (group_id, user_id, role)
  values (v_group, v_user, 'MEMBER')
  on conflict (group_id, user_id) where is_active do nothing;
  return v_group;
end;
$$;

-- Any member may leave (spec §46). Access ends immediately.
create function public.leave_group(p_group_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_active_user();
begin
  update public.group_memberships
  set is_active = false
  where group_id = p_group_id and user_id = v_user and is_active;
  if not found then
    raise exception 'Not a member of this group' using errcode = '42501';
  end if;
end;
$$;

-- Only the group's admin may remove another member (spec §46).
create function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_active_user();
begin
  if not private.is_group_admin(p_group_id) then
    raise exception 'Only a group admin can remove members' using errcode = '42501';
  end if;
  if p_user_id = v_user then
    raise exception 'Use leave to leave the group yourself' using errcode = '22023';
  end if;
  update public.group_memberships
  set is_active = false
  where group_id = p_group_id and user_id = p_user_id and is_active;
  if not found then
    raise exception 'Not a member of this group' using errcode = 'P0002';
  end if;
end;
$$;

-- The group admin assigns roles (e.g. a leader, or a second admin before
-- leaving).
create function public.set_group_member_role(p_group_id uuid, p_user_id uuid, p_role public.group_role)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_active_user();
begin
  if not private.is_group_admin(p_group_id) then
    raise exception 'Only a group admin can change roles' using errcode = '42501';
  end if;
  if p_role is null then
    raise exception 'A role is required' using errcode = '22023';
  end if;
  perform set_config('app.actor_id', v_user::text, true);
  update public.group_memberships
  set role = p_role
  where group_id = p_group_id and user_id = p_user_id and is_active;
  if not found then
    raise exception 'Not a member of this group' using errcode = 'P0002';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Group reads. Only group structure and display names, only for active
-- members of active groups. No other profile field is ever returned.
-- -----------------------------------------------------------------------------

-- The first date a caller can view in a group: their own join day (MEMBER),
-- or the group's creation day (LEADER / ADMIN, spec §48).
create function private.group_history_from(p_group_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case when m.role in ('ADMIN', 'LEADER')
              then (g.created_at at time zone p.timezone)::date
              else (m.joined_at at time zone p.timezone)::date end
  from public.group_memberships m
  join public.groups g on g.id = m.group_id and g.is_active
  join public.profiles p on p.id = m.user_id and p.is_active
  where m.group_id = p_group_id and m.user_id = (select auth.uid()) and m.is_active;
$$;

revoke all on function private.group_history_from(uuid) from public, anon;
grant execute on function private.group_history_from(uuid) to authenticated;

create function public.get_my_groups()
returns table (
  id           uuid,
  name         text,
  description  text,
  code         text,
  my_role      public.group_role,
  member_count integer,
  joined_at    timestamptz,
  history_from date
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.name, g.description, g.code, m.role,
         (select count(*)::integer from public.group_memberships o
          join public.profiles op on op.id = o.user_id and op.is_active
          where o.group_id = g.id and o.is_active),
         m.joined_at,
         private.group_history_from(g.id)
  from public.group_memberships m
  join public.groups g on g.id = m.group_id and g.is_active
  where m.user_id = (select auth.uid()) and m.is_active and private.is_active_user()
  order by g.name, g.id;
$$;

create function public.get_group_members(p_group_id uuid)
returns table (user_id uuid, name text, group_role public.group_role, joined_at timestamptz)
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
  select m.user_id, p.name, m.role, m.joined_at
  from public.group_memberships m
  join public.profiles p on p.id = m.user_id and p.is_active
  where m.group_id = p_group_id and m.is_active
  order by m.role = 'ADMIN' desc, p.name nulls last, m.user_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Group-visible daily summary (spec §47): the ONLY way to see another
-- member's data. Per active member of an active group the caller belongs to:
--   calories and protein (the same aggregation of logged meal-item snapshots
--   as Progress and recommendations; nothing logged → null), the target in
--   force on that date (the date's snapshot, else the covering non-replaced
--   cycle's final targets; never today's), steps (the active entry; none →
--   null), steps_target (no step goal exists in Phase 1 → null) and whether a
--   workout was logged (a workout day, any number of workouts).
-- Never weight, body composition, InBody, profile fields, meals or workouts.
-- -----------------------------------------------------------------------------
drop function public.get_group_member_day(uuid, date);

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
  steps_target     integer,
  workout_logged   boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_history_from date := private.group_history_from(p_group_id);
begin
  if v_history_from is null then
    raise exception 'Not a member of this group' using errcode = '42501';
  end if;
  if p_date is null or p_date > private.user_local_date(auth.uid()) then
    raise exception 'Choose today or an earlier date' using errcode = '22023';
  end if;
  if p_date < v_history_from then
    return; -- before this caller's visible history: nothing
  end if;

  return query
  select
    m.user_id,
    p.name,
    m.role,
    n.calories,
    coalesce(t.calories, c.final_calories),
    n.protein_g,
    coalesce(t.protein_g, c.final_protein_g),
    s.steps,
    null::integer,
    exists (
      select 1 from public.workouts w
      where w.user_id = m.user_id and w.workout_date = p_date and not w.is_deleted
    )
  from public.group_memberships m
  join public.profiles p on p.id = m.user_id and p.is_active
  left join public.daily_target_snapshots t on t.user_id = m.user_id and t.target_date = p_date
  left join lateral (
    select cy.final_calories, cy.final_protein_g
    from public.recommendation_cycles cy
    where cy.user_id = m.user_id and cy.status <> 'REPLACED'
      and cy.period_start <= p_date and (cy.period_end is null or cy.period_end >= p_date)
    order by cy.period_start desc
    limit 1
  ) c on true
  left join lateral (
    select d.calories, d.protein_g
    from public.recommendation_daily_nutrition(m.user_id, p_date, p_date) d
  ) n on true
  left join public.steps_entries s
    on s.user_id = m.user_id and s.entry_date = p_date and s.is_active and not s.is_deleted
  where m.group_id = p_group_id
    and m.is_active
    and p_date >= (m.joined_at at time zone p.timezone)::date
  order by p.name nulls last, m.user_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges: signed-in users only; anon never.
-- -----------------------------------------------------------------------------
revoke all on function
  public.create_group(text, text),
  public.preview_group(text),
  public.join_group(text),
  public.leave_group(uuid),
  public.remove_group_member(uuid, uuid),
  public.set_group_member_role(uuid, uuid, public.group_role),
  public.get_my_groups(),
  public.get_group_members(uuid),
  public.get_group_member_day(uuid, date),
  private.normalize_group_code(text),
  private.require_active_user()
from public, anon;
grant execute on function
  public.create_group(text, text),
  public.preview_group(text),
  public.join_group(text),
  public.leave_group(uuid),
  public.remove_group_member(uuid, uuid),
  public.set_group_member_role(uuid, uuid, public.group_role),
  public.get_my_groups(),
  public.get_group_members(uuid),
  public.get_group_member_day(uuid, date),
  private.normalize_group_code(text),
  private.require_active_user()
to authenticated;

revoke all on function private.audit_group_change(), private.deactivate_empty_group() from public, anon;
