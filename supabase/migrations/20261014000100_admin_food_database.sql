-- =============================================================================
-- Admin Food Database (spec §11, §78): management of the shared catalogue and
-- review of user-created foods.
--
-- Nothing new is modelled. The existing tables already carry everything:
--   food_items        the shared catalogue. "Inactive" is its soft delete
--                     (is_deleted): hidden from users, kept for history.
--   food_submissions  user-created foods: PENDING_REVIEW → APPROVED / REJECTED.
--                     Approval creates the shared food (source_submission_id
--                     keeps the provenance; the submission keeps the values
--                     the user entered).
--   food_item_versions, audit_logs   written by the existing triggers.
--
-- Added here:
--   * one active food per normalized name (unique index);
--   * admin functions: list, likely duplicates, create, edit, activate /
--     deactivate, approve, reject. Each checks the caller's role itself and
--     uses the existing version check (updated_at) against stale edits;
--   * after approval the submitter's history follows the shared food
--     (search_foods, food_usage, copy_meal).
--
-- Historical meals are untouched: meal_items keep their own nutrition
-- snapshots and no function here writes to meals or meal_items.
-- =============================================================================

-- One active shared food per name ("Chicken Biryani" = "chicken  biryani!").
-- Inactive and merged foods do not count, so a name can be reused after a
-- food is deactivated. Replaces the plain index on the same column.
create unique index food_items_active_name_unique on public.food_items (name_normalized)
  where not is_deleted and merged_into_food_id is null;
drop index public.food_items_name_idx;

-- Admin search and duplicate detection also cover inactive foods.
create index food_items_all_name_trgm_idx on public.food_items
  using gin (name_normalized extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Where a shared food came from. Derived from existing columns, never stored
-- twice: approved from a user's submission, created by an admin in the app, or
-- loaded by the operator (the starter catalogue; no acting user).
create function private.food_source(p_created_by uuid, p_source_submission_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_source_submission_id is not null then 'USER_SUBMISSION'
    when p_created_by is not null then 'ADMIN'
    else 'CATALOGUE'
  end;
$$;

-- Every food-catalogue write starts here: ADMIN / SUPER_ADMIN only, and the
-- reason for the audit rows written in this transaction.
create function private.begin_food_admin(p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform set_config('app.audit_reason', coalesce(left(nullif(btrim(p_reason), ''), 500), ''), true);
  perform set_config('app.audit_action', '', true);
end;
$$;

-- The same limits as the app's food form (src/features/food/schemas.ts) on top
-- of the table constraints. Values are never adjusted, only accepted or refused.
create function private.check_food_values(
  p_name text,
  p_serving_quantity numeric,
  p_serving_unit text,
  p_calories numeric,
  p_protein_g numeric,
  p_carbs_g numeric,
  p_fat_g numeric,
  p_fiber_g numeric
) returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_name is null or char_length(btrim(p_name)) not between 2 and 120
     or private.normalize_name(p_name) is null then
    raise exception 'Enter a food name of 2 to 120 characters' using errcode = '22023';
  end if;
  if p_serving_quantity is null or p_serving_quantity <= 0 or p_serving_quantity > 5000 then
    raise exception 'Serving size must be more than 0 and at most 5,000' using errcode = '22023';
  end if;
  if p_serving_unit is null or p_serving_unit !~ '^[a-z][a-z ]{0,19}$' then
    raise exception 'Use a simple unit such as g, ml, piece or bowl' using errcode = '22023';
  end if;
  if p_calories is null or p_calories < 0 or p_calories > 5000 then
    raise exception 'Calories must be between 0 and 5,000' using errcode = '22023';
  end if;
  if p_protein_g is null or p_carbs_g is null or p_fat_g is null or p_fiber_g is null
     or least(p_protein_g, p_carbs_g, p_fat_g, p_fiber_g) < 0
     or greatest(p_protein_g, p_carbs_g, p_fat_g, p_fiber_g) > 1000 then
    raise exception 'Protein, carbs, fat and fiber must be between 0 and 1,000 g' using errcode = '22023';
  end if;
end;
$$;

-- Refuses a second active food with the same normalized name.
create function private.assert_food_name_free(p_name text, p_except uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.food_items f
    where f.name_normalized = private.normalize_name(p_name)
      and not f.is_deleted and f.merged_into_food_id is null
      and f.id is distinct from p_except
  ) then
    raise exception 'An active food with this name already exists. Use a more specific name.'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function
  private.food_source(uuid, uuid),
  private.begin_food_admin(text),
  private.check_food_values(text, numeric, text, numeric, numeric, numeric, numeric, numeric),
  private.assert_food_name_free(text, uuid)
from public, anon;
grant execute on function
  private.food_source(uuid, uuid),
  private.begin_food_admin(text),
  private.check_food_values(text, numeric, text, numeric, numeric, numeric, numeric, numeric),
  private.assert_food_name_free(text, uuid)
to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- admin_list_foods — the catalogue and the review queue in one server-side
-- list: search, filters, sorting and pagination.
--
--   kind    FOOD (a shared food) | SUBMISSION (a user-created food that is not
--           a shared food: pending or rejected)
--   status  ACTIVE | INACTIVE | PENDING_REVIEW | REJECTED
--   source  CATALOGUE | ADMIN | USER_SUBMISSION
--   p_sort  NAME | NEWEST | UPDATED | STATUS (pending first)
--
-- Nutrition values are per serving_quantity of serving_unit, as stored.
-- Merged foods are not listed (there is no merge tool; none exist).
-- Of the submitter only the name is returned.
-- -----------------------------------------------------------------------------
create function public.admin_list_foods(
  p_search text default null,
  p_status text default null,
  p_source text default null,
  p_sort text default 'NAME',
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  kind              text,
  id                uuid,
  name              text,
  serving_quantity  numeric,
  serving_unit      text,
  calories          numeric,
  protein_g         numeric,
  carbs_g           numeric,
  fat_g             numeric,
  fiber_g           numeric,
  is_approximate    boolean,
  status            text,
  source            text,
  submitted_by_name text,
  review_notes      text,
  created_at        timestamptz,
  updated_at        timestamptz,
  version           integer,
  total_count       bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_q text := private.normalize_name(p_search);
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('ACTIVE', 'INACTIVE', 'PENDING_REVIEW', 'REJECTED') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  if p_source is not null and p_source not in ('CATALOGUE', 'ADMIN', 'USER_SUBMISSION') then
    raise exception 'Unknown source' using errcode = '22023';
  end if;

  return query
  with entries as (
    select 'FOOD'::text as kind, f.id, f.name, f.name_normalized, f.serving_quantity, f.serving_unit,
           f.calories, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g, f.is_approximate,
           case when f.is_deleted then 'INACTIVE' else 'ACTIVE' end as status,
           private.food_source(f.created_by, f.source_submission_id) as source,
           s.submitted_by, f.delete_reason as review_notes, f.created_at, f.updated_at, f.version
    from public.food_items f
    left join public.food_submissions s on s.id = f.source_submission_id
    where f.merged_into_food_id is null
    union all
    select 'SUBMISSION'::text, s.id, s.name, s.name_normalized, s.serving_quantity, s.serving_unit,
           s.calories, s.protein_g, s.carbs_g, s.fat_g, s.fiber_g, true,
           s.status::text, 'USER_SUBMISSION'::text,
           s.submitted_by, s.review_notes, s.created_at, s.updated_at, null::integer
    from public.food_submissions s
    where s.status in ('PENDING_REVIEW', 'REJECTED')
  )
  select e.kind, e.id, e.name, e.serving_quantity, e.serving_unit, e.calories, e.protein_g, e.carbs_g,
         e.fat_g, e.fiber_g, e.is_approximate, e.status, e.source, p.name, e.review_notes,
         e.created_at, e.updated_at, e.version, count(*) over ()
  from entries e
  left join public.profiles p on p.id = e.submitted_by
  where (p_status is null or e.status = p_status)
    and (p_source is null or e.source = p_source)
    and (v_q is null or e.name_normalized like '%' || v_q || '%'
         or v_q operator(extensions.<%) e.name_normalized)
  order by
    case when p_sort = 'STATUS'
      then array_position(array['PENDING_REVIEW', 'ACTIVE', 'INACTIVE', 'REJECTED'], e.status) end,
    case when p_sort = 'NEWEST' then e.created_at end desc,
    case when p_sort = 'UPDATED' then e.updated_at end desc,
    e.name_normalized, e.created_at, e.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- -----------------------------------------------------------------------------
-- admin_food_duplicates — shared foods whose name is the same as, contains, is
-- contained in, or is spelled like p_name (trigram similarity). Deterministic;
-- it only informs the admin and never merges or blocks by itself.
-- -----------------------------------------------------------------------------
create function public.admin_food_duplicates(p_name text, p_exclude_food_id uuid default null)
returns table (
  id               uuid,
  name             text,
  serving_quantity numeric,
  serving_unit     text,
  calories         numeric,
  protein_g        numeric,
  carbs_g          numeric,
  fat_g            numeric,
  fiber_g          numeric,
  status           text,
  is_exact         boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_q text := private.normalize_name(p_name);
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_q is null or char_length(v_q) < 2 then
    return;
  end if;
  return query
  select f.id, f.name, f.serving_quantity, f.serving_unit, f.calories, f.protein_g, f.carbs_g,
         f.fat_g, f.fiber_g,
         case when f.is_deleted then 'INACTIVE' else 'ACTIVE' end,
         f.name_normalized = v_q
  from public.food_items f
  where f.merged_into_food_id is null
    and f.id is distinct from p_exclude_food_id
    and (f.name_normalized = v_q
         or f.name_normalized like '%' || v_q || '%'
         or v_q like '%' || f.name_normalized || '%'
         or extensions.similarity(f.name_normalized, v_q) >= 0.4)
  order by (f.name_normalized = v_q) desc, f.is_deleted,
           extensions.similarity(f.name_normalized, v_q) desc, f.name_normalized, f.id
  limit 6;
end;
$$;

-- -----------------------------------------------------------------------------
-- admin_create_food — a new shared food, created by an admin.
-- -----------------------------------------------------------------------------
create function public.admin_create_food(
  p_name text,
  p_serving_quantity numeric,
  p_serving_unit text,
  p_calories numeric,
  p_protein_g numeric,
  p_carbs_g numeric,
  p_fat_g numeric,
  p_fiber_g numeric,
  p_is_approximate boolean default true,
  p_active boolean default true
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.begin_food_admin();
  perform private.check_food_values(p_name, p_serving_quantity, p_serving_unit, p_calories,
                                    p_protein_g, p_carbs_g, p_fat_g, p_fiber_g);
  if coalesce(p_active, true) then
    perform private.assert_food_name_free(p_name);
  end if;
  begin
    insert into public.food_items (
      name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g,
      is_approximate, is_deleted
    ) values (
      btrim(p_name), p_serving_quantity, p_serving_unit, p_calories, p_protein_g, p_carbs_g,
      p_fat_g, p_fiber_g, coalesce(p_is_approximate, true), not coalesce(p_active, true)
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'An active food with this name already exists. Use a more specific name.'
      using errcode = '22023';
  end;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- admin_update_food — edits a shared food the admin has open. A changed name,
-- serving or nutrition value bumps the food's version (existing trigger); the
-- previous values stay in food_item_versions and in the audit log.
-- Meals already logged keep their snapshots; only new logs use the new values.
-- -----------------------------------------------------------------------------
create function public.admin_update_food(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_name text,
  p_serving_quantity numeric,
  p_serving_unit text,
  p_calories numeric,
  p_protein_g numeric,
  p_carbs_g numeric,
  p_fat_g numeric,
  p_fiber_g numeric,
  p_is_approximate boolean,
  p_reason text default null
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.food_items%rowtype;
begin
  perform private.begin_food_admin(p_reason);
  select * into v_row from public.food_items where id = p_id for update;
  if not found or v_row.merged_into_food_id is not null then
    raise exception 'Food not found' using errcode = 'P0002';
  end if;
  perform private.assert_current_version(v_row.updated_at, p_expected_updated_at);
  perform private.check_food_values(p_name, p_serving_quantity, p_serving_unit, p_calories,
                                    p_protein_g, p_carbs_g, p_fat_g, p_fiber_g);
  if (btrim(p_name), p_serving_quantity, p_serving_unit, p_calories, p_protein_g, p_carbs_g, p_fat_g,
      p_fiber_g, coalesce(p_is_approximate, v_row.is_approximate))
     is not distinct from
     (v_row.name, v_row.serving_quantity, v_row.serving_unit, v_row.calories, v_row.protein_g,
      v_row.carbs_g, v_row.fat_g, v_row.fiber_g, v_row.is_approximate) then
    raise exception 'Nothing to correct' using errcode = '22023';
  end if;
  if not v_row.is_deleted then
    perform private.assert_food_name_free(p_name, p_id);
  end if;
  begin
    update public.food_items
    set name = btrim(p_name), serving_quantity = p_serving_quantity, serving_unit = p_serving_unit,
        calories = p_calories, protein_g = p_protein_g, carbs_g = p_carbs_g, fat_g = p_fat_g,
        fiber_g = p_fiber_g, is_approximate = coalesce(p_is_approximate, v_row.is_approximate)
    where id = p_id;
  exception when unique_violation then
    raise exception 'An active food with this name already exists. Use a more specific name.'
      using errcode = '22023';
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- admin_set_food_active — deactivate (hide from users) or activate again.
-- A food is never physically deleted: meals that used it keep referring to it.
-- -----------------------------------------------------------------------------
create function public.admin_set_food_active(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_active boolean,
  p_reason text default null
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.food_items%rowtype;
begin
  perform private.begin_food_admin(p_reason);
  if p_active is null then
    raise exception 'Choose active or inactive' using errcode = '22023';
  end if;
  select * into v_row from public.food_items where id = p_id for update;
  if not found or v_row.merged_into_food_id is not null then
    raise exception 'Food not found' using errcode = 'P0002';
  end if;
  perform private.assert_current_version(v_row.updated_at, p_expected_updated_at);
  if v_row.is_deleted = not p_active then
    raise exception 'The food already has this status' using errcode = '22023';
  end if;
  if p_active then
    perform private.assert_food_name_free(v_row.name, p_id);
  end if;
  begin
    update public.food_items
    set is_deleted = not p_active,
        delete_reason = case when p_active then null else left(nullif(btrim(p_reason), ''), 500) end
    where id = p_id;
  exception when unique_violation then
    raise exception 'An active food with this name already exists. Use a more specific name.'
      using errcode = '22023';
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- admin_approve_food_submission — the reviewed values become a shared food.
-- The admin may correct the name or values before approving (spec §11: "Admin
-- can edit and approve"); the submission row keeps what the user entered and
-- the food keeps a link to it (source_submission_id). One transaction.
-- -----------------------------------------------------------------------------
create function public.admin_approve_food_submission(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_name text,
  p_serving_quantity numeric,
  p_serving_unit text,
  p_calories numeric,
  p_protein_g numeric,
  p_carbs_g numeric,
  p_fat_g numeric,
  p_fiber_g numeric,
  p_is_approximate boolean default true,
  p_notes text default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row  public.food_submissions%rowtype;
  v_food uuid;
begin
  perform private.begin_food_admin(p_notes);
  select * into v_row from public.food_submissions where id = p_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  perform private.assert_current_version(v_row.updated_at, p_expected_updated_at);
  if v_row.status <> 'PENDING_REVIEW' then
    raise exception 'This food has already been reviewed' using errcode = '22023';
  end if;
  perform private.check_food_values(p_name, p_serving_quantity, p_serving_unit, p_calories,
                                    p_protein_g, p_carbs_g, p_fat_g, p_fiber_g);
  perform private.assert_food_name_free(p_name);
  begin
    insert into public.food_items (
      name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g,
      is_approximate, source_submission_id
    ) values (
      btrim(p_name), p_serving_quantity, p_serving_unit, p_calories, p_protein_g, p_carbs_g,
      p_fat_g, p_fiber_g, coalesce(p_is_approximate, true), p_id
    )
    returning id into v_food;
  exception when unique_violation then
    raise exception 'An active food with this name already exists. Use a more specific name.'
      using errcode = '22023';
  end;
  update public.food_submissions
  set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(),
      review_notes = left(nullif(btrim(p_notes), ''), 500), approved_food_item_id = v_food
  where id = p_id;
  return v_food;
end;
$$;

-- -----------------------------------------------------------------------------
-- admin_reject_food_submission — the food never becomes shared. The record is
-- kept (with the reviewer, time and note); meals that already used it keep
-- their snapshots, and the user can no longer log it.
-- -----------------------------------------------------------------------------
create function public.admin_reject_food_submission(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_notes text default null
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.food_submissions%rowtype;
begin
  perform private.begin_food_admin(p_notes);
  select * into v_row from public.food_submissions where id = p_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  perform private.assert_current_version(v_row.updated_at, p_expected_updated_at);
  if v_row.status <> 'PENDING_REVIEW' then
    raise exception 'This food has already been reviewed' using errcode = '22023';
  end if;
  update public.food_submissions
  set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(),
      review_notes = left(nullif(btrim(p_notes), ''), 500)
  where id = p_id;
end;
$$;

revoke all on function
  public.admin_list_foods(text, text, text, text, integer, integer),
  public.admin_food_duplicates(text, uuid),
  public.admin_create_food(text, numeric, text, numeric, numeric, numeric, numeric, numeric, boolean, boolean),
  public.admin_update_food(uuid, timestamptz, text, numeric, text, numeric, numeric, numeric, numeric, numeric, boolean, text),
  public.admin_set_food_active(uuid, timestamptz, boolean, text),
  public.admin_approve_food_submission(uuid, timestamptz, text, numeric, text, numeric, numeric, numeric, numeric, numeric, boolean, text),
  public.admin_reject_food_submission(uuid, timestamptz, text)
from public, anon;
grant execute on function
  public.admin_list_foods(text, text, text, text, integer, integer),
  public.admin_food_duplicates(text, uuid),
  public.admin_create_food(text, numeric, text, numeric, numeric, numeric, numeric, numeric, boolean, boolean),
  public.admin_update_food(uuid, timestamptz, text, numeric, text, numeric, numeric, numeric, numeric, numeric, boolean, text),
  public.admin_set_food_active(uuid, timestamptz, boolean, text),
  public.admin_approve_food_submission(uuid, timestamptz, text, numeric, text, numeric, numeric, numeric, numeric, numeric, boolean, text),
  public.admin_reject_food_submission(uuid, timestamptz, text)
to authenticated;

-- -----------------------------------------------------------------------------
-- After approval, the submitter's own history follows the shared food.
--
-- Meals logged from a submission keep pointing at it (and keep their
-- snapshots). Once it is approved, those uses count for the shared food, so it
-- stays in the user's recent / frequent foods and ranks in their search, and a
-- copied meal logs the shared food. Only the usage and copy sources change;
-- everything else in these three functions is as before.
-- -----------------------------------------------------------------------------
create or replace function public.search_foods(p_query text, p_limit integer default 20)
returns table (
  source           text,
  id               uuid,
  name             text,
  serving_quantity numeric,
  serving_unit     text,
  calories         numeric,
  protein_g        numeric,
  carbs_g          numeric,
  fat_g            numeric,
  fiber_g          numeric,
  is_approximate   boolean,
  review_status    public.food_review_status,
  match_rank       integer,
  use_count        integer,
  last_used        date,
  similarity       real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select private.normalize_name(p_query) as n
  ),
  usage as (
    select coalesce(mi.food_item_id, a.approved_food_item_id) as food_item_id,
           case when a.id is null then mi.food_submission_id end as food_submission_id,
           count(*)::integer as use_count, max(m.meal_date) as last_used
    from public.meal_items mi
    join public.meals m on m.id = mi.meal_id
    left join public.food_submissions a on a.id = mi.food_submission_id and a.status = 'APPROVED'
    where mi.user_id = (select auth.uid()) and not mi.is_deleted and not m.is_deleted
    group by 1, 2
  ),
  candidates as (
    select 'FOOD'::text as source, f.id, f.name, f.name_normalized, f.serving_quantity, f.serving_unit,
           f.calories, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g, f.is_approximate,
           null::public.food_review_status as review_status
    from public.food_items f, q
    where q.n is not null and char_length(q.n) >= 2
      and not f.is_deleted and f.merged_into_food_id is null
      and (f.name_normalized like '%' || q.n || '%' or q.n operator(extensions.<%) f.name_normalized)
    union all
    select 'SUBMISSION'::text, s.id, s.name, s.name_normalized, s.serving_quantity, s.serving_unit,
           s.calories, s.protein_g, s.carbs_g, s.fat_g, s.fiber_g, true, s.status
    from public.food_submissions s, q
    where q.n is not null and char_length(q.n) >= 2
      and s.submitted_by = (select auth.uid()) and s.status = 'PENDING_REVIEW'
      and (s.name_normalized like '%' || q.n || '%' or q.n operator(extensions.<%) s.name_normalized)
  )
  select c.source, c.id, c.name, c.serving_quantity, c.serving_unit,
         c.calories, c.protein_g, c.carbs_g, c.fat_g, c.fiber_g, c.is_approximate, c.review_status,
         case
           when c.name_normalized = q.n then 0
           when c.name_normalized like q.n || '%' or c.name_normalized like '% ' || q.n || '%' then 1
           else 2
         end as match_rank,
         coalesce(u.use_count, 0) as use_count,
         u.last_used,
         extensions.word_similarity(q.n, c.name_normalized) as similarity
  from candidates c
  cross join q
  left join usage u
    on (c.source = 'FOOD' and u.food_item_id = c.id)
    or (c.source = 'SUBMISSION' and u.food_submission_id = c.id)
  order by match_rank, u.last_used desc nulls last, use_count desc, similarity desc, c.name
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

create or replace function public.food_usage(p_order text default 'recent', p_limit integer default 8)
returns table (
  source           text,
  id               uuid,
  name             text,
  serving_quantity numeric,
  serving_unit     text,
  calories         numeric,
  protein_g        numeric,
  carbs_g          numeric,
  fat_g            numeric,
  fiber_g          numeric,
  is_approximate   boolean,
  review_status    public.food_review_status,
  use_count        integer,
  last_used        date
)
language sql
stable
security invoker
set search_path = ''
as $$
  with usage as (
    select case
             when mi.food_item_id is not null then private.resolve_food(mi.food_item_id)
             when a.id is not null then private.resolve_food(a.approved_food_item_id)
           end as food_item_id,
           case when a.id is null then mi.food_submission_id end as food_submission_id,
           count(*)::integer as use_count,
           max(m.meal_date) as last_used,
           max(mi.created_at) as last_logged_at
    from public.meal_items mi
    join public.meals m on m.id = mi.meal_id
    left join public.food_submissions a on a.id = mi.food_submission_id and a.status = 'APPROVED'
    where mi.user_id = (select auth.uid()) and not mi.is_deleted and not m.is_deleted
    group by 1, 2
  ),
  foods as (
    select 'FOOD'::text as source, f.id, f.name, f.serving_quantity, f.serving_unit, f.calories,
           f.protein_g, f.carbs_g, f.fat_g, f.fiber_g, f.is_approximate,
           null::public.food_review_status as review_status,
           sum(u.use_count)::integer as use_count, max(u.last_used) as last_used,
           max(u.last_logged_at) as last_logged_at
    from usage u
    join public.food_items f on f.id = u.food_item_id
    where not f.is_deleted and f.merged_into_food_id is null
    group by f.id
    union all
    select 'SUBMISSION'::text, s.id, s.name, s.serving_quantity, s.serving_unit, s.calories,
           s.protein_g, s.carbs_g, s.fat_g, s.fiber_g, true, s.status,
           u.use_count, u.last_used, u.last_logged_at
    from usage u
    join public.food_submissions s on s.id = u.food_submission_id
    where s.submitted_by = (select auth.uid()) and s.status = 'PENDING_REVIEW'
  )
  select source, id, name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g,
         fiber_g, is_approximate, review_status, use_count, last_used
  from foods
  order by
    case when p_order = 'frequent' then use_count end desc nulls last,
    last_used desc, last_logged_at desc, name
  limit least(greatest(coalesce(p_limit, 8), 1), 20);
$$;

create or replace function public.copy_meal(p_source_meal_id uuid, p_target_date date)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_category public.meal_category;
  v_name     text;
  v_items    jsonb;
begin
  select m.meal_category, m.meal_name into v_category, v_name
  from public.meals m
  where m.id = p_source_meal_id and m.user_id = v_user and not m.is_deleted;
  if not found then
    raise exception 'Meal not found' using errcode = 'P0002';
  end if;

  select jsonb_agg(
           case
             when mi.food_item_id is not null then
               jsonb_build_object('food_item_id', private.resolve_food(mi.food_item_id), 'quantity', mi.quantity)
             when af.id is not null then
               -- The user's own food, since approved: copy the shared food.
               jsonb_build_object('food_item_id', private.resolve_food(af.id), 'quantity', mi.quantity)
             else
               jsonb_build_object('food_submission_id', mi.food_submission_id, 'quantity', mi.quantity)
           end
           order by mi.created_at, mi.id
         )
    into v_items
  from public.meal_items mi
  left join public.food_submissions a on a.id = mi.food_submission_id and a.status = 'APPROVED'
  -- Only while the quantity still means the same thing (the admin may have
  -- approved the food with another serving unit).
  left join public.food_items af on af.id = a.approved_food_item_id and af.serving_unit = a.serving_unit
  where mi.meal_id = p_source_meal_id and not mi.is_deleted;

  if v_items is null then
    raise exception 'This meal has no food to copy' using errcode = '22023';
  end if;

  return public.log_meal(p_target_date, v_items, v_category, v_name, p_source_meal_id);
end;
$$;
