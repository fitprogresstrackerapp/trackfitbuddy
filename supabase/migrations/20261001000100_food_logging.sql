-- =============================================================================
-- Food logging (Phase 1 Food feature):
--   * log_meal()      — create a meal with its items atomically (today, or a
--                       narrowly-scoped historical late entry)
--   * copy_meal()     — copy a previous meal into a date as a NEW meal
--   * search_foods()  — server-side food search with usage-aware ranking
--   * food_usage()    — the caller's recently / frequently logged foods
--   * guard change    — admits past-date INSERTs only through log_meal()
--
-- Locking is NOT weakened: existing past records stay non-editable and
-- non-deletable for users; only brand-new meals (and their own items) may be
-- created for a past date, and only inside log_meal(). See docs/food.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Late-entry grants — one-shot, transaction-scoped permission rows written only
-- by log_meal() (SECURITY DEFINER). Not granted to any client role, so a grant
-- cannot be forged, even with direct SQL access as `authenticated`.
-- -----------------------------------------------------------------------------
create table private.late_entry_grants (
  txid      bigint not null,
  user_id   uuid not null,
  meal_date date not null,
  meal_id   uuid,
  primary key (txid, user_id, meal_date)
);

revoke all on private.late_entry_grants from public, anon, authenticated;

create function private.late_entry_granted(
  p_user_id uuid,
  p_date date,
  p_meal_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.late_entry_grants g
    where g.txid = txid_current()
      and g.user_id = p_user_id
      and g.meal_date = p_date
      and g.meal_id is not distinct from p_meal_id
  );
$$;

-- Only the guard (running as its owner) calls this; no client role needs it.
revoke all on function private.late_entry_granted(uuid, date, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Record guard — identical to the previous version except for the INSERT rule:
-- a normal user may create a record for a PAST date only when log_meal() has
-- granted it in this transaction (a new meal, then items of that meal only).
-- Future dates and every UPDATE/DELETE rule are unchanged.
-- -----------------------------------------------------------------------------
create or replace function private.guard_user_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date_col   text := nullif(tg_argv[0], '');
  v_apply_lock boolean := tg_argv[1] = 'lock';
  v_actor      uuid := private.current_actor_id();
  v_old        jsonb;
  v_new        jsonb;
  v_patch      jsonb := '{}';
  v_date       date;
  v_old_date   date;
  v_locked     boolean := false;
  v_today      date;
  v_owner      uuid;
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null then
      raise exception 'Records cannot be hard-deleted; use soft deletion' using errcode = '42501';
    end if;
    return old;
  end if;

  v_new := to_jsonb(new);
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    if (v_new -> 'user_id') is distinct from (v_old -> 'user_id')
       or (v_new -> 'created_at') is distinct from (v_old -> 'created_at')
       or (v_new -> 'created_by') is distinct from (v_old -> 'created_by')
       or (v_new -> 'meal_id') is distinct from (v_old -> 'meal_id') then
      raise exception 'Ownership and creation fields are immutable' using errcode = '42501';
    end if;
  elsif v_new ? 'created_by' then
    v_patch := v_patch || jsonb_build_object('created_by', v_actor);
  end if;

  -- Soft-delete bookkeeping.
  if v_new ? 'is_deleted' then
    if (v_new ->> 'is_deleted')::boolean
       and (tg_op = 'INSERT' or not (v_old ->> 'is_deleted')::boolean) then
      v_patch := v_patch || jsonb_build_object(
        'deleted_at', coalesce(v_new ->> 'deleted_at', now()::text),
        'deleted_by', coalesce(v_new ->> 'deleted_by', v_actor::text)
      );
      if v_new ? 'is_active' then
        v_patch := v_patch || jsonb_build_object('is_active', false); -- steps: a deleted entry is never active
      end if;
    elsif tg_op = 'UPDATE' and not (v_new ->> 'is_deleted')::boolean and (v_old ->> 'is_deleted')::boolean then
      v_patch := v_patch || jsonb_build_object('deleted_at', null, 'deleted_by', null, 'delete_reason', null);
    end if;
  end if;

  -- Lock bookkeeping.
  if v_new ? 'is_locked' then
    if (v_new ->> 'is_locked')::boolean and (tg_op = 'INSERT' or not (v_old ->> 'is_locked')::boolean) then
      v_patch := v_patch || jsonb_build_object('locked_at', coalesce(v_new ->> 'locked_at', now()::text));
    elsif not (v_new ->> 'is_locked')::boolean then
      v_patch := v_patch || jsonb_build_object('locked_at', null);
    end if;
  end if;

  -- Lock enforcement for normal users only.
  if v_apply_lock and pg_trigger_depth() = 1 and auth.uid() is not null and not private.is_admin() then
    if v_date_col is null then
      -- meal_items: the parent meal carries date and lock state.
      select m.meal_date, m.is_locked or m.is_deleted into v_date, v_locked
      from public.meals m where m.id = (v_new ->> 'meal_id')::uuid;
      v_old_date := v_date;
    else
      v_date := (v_new ->> v_date_col)::date;
      v_old_date := coalesce((v_old ->> v_date_col)::date, v_date);
    end if;

    v_owner := (v_new ->> 'user_id')::uuid;
    v_today := private.user_local_date(v_owner);

    if tg_op = 'INSERT' then
      if v_date is null or v_date > v_today or v_locked then
        raise exception 'Records can only be created for today (%)', v_today using errcode = '42501';
      end if;
      if v_date < v_today and not (
        (tg_table_name = 'meals' and private.late_entry_granted(v_owner, v_date, null))
        or (tg_table_name = 'meal_items'
            and private.late_entry_granted(v_owner, v_date, (v_new ->> 'meal_id')::uuid))
      ) then
        raise exception 'Records can only be created for today (%)', v_today using errcode = '42501';
      end if;
      if coalesce((v_new ->> 'is_locked')::boolean, false) or coalesce((v_new ->> 'is_deleted')::boolean, false) then
        raise exception 'New records cannot be created locked or deleted' using errcode = '42501';
      end if;
    else
      if v_locked or coalesce((v_old ->> 'is_locked')::boolean, false) or v_old_date < v_today then
        raise exception 'Record is locked and can no longer be changed' using errcode = '42501';
      end if;
      if v_date is distinct from v_old_date then
        raise exception 'The record date cannot be changed' using errcode = '42501';
      end if;
      if (v_new -> 'is_locked') is distinct from (v_old -> 'is_locked') then
        raise exception 'Lock state is managed by the system' using errcode = '42501';
      end if;
      if (v_old ->> 'is_deleted')::boolean and not (v_new ->> 'is_deleted')::boolean then
        raise exception 'Deleted records can only be restored by an admin' using errcode = '42501';
      end if;
      if (v_new -> 'is_active') is distinct from (v_old -> 'is_active')
         and not (v_new ->> 'is_deleted')::boolean then
        raise exception 'The active step entry is managed by the system' using errcode = '42501';
      end if;
    end if;
  end if;

  if v_patch <> '{}' then
    new := jsonb_populate_record(new, v_patch);
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- resolve_food — follows admin merges to the surviving food (spec §11). Returns
-- null for a deleted food. Only returns an id, never food data.
-- -----------------------------------------------------------------------------
create function private.resolve_food(p_food_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_food_id;
  v_next uuid;
  v_deleted boolean;
begin
  for i in 1..10 loop
    select f.merged_into_food_id, f.is_deleted into v_next, v_deleted
    from public.food_items f where f.id = v_id;
    if not found or v_deleted then
      return null;
    end if;
    if v_next is null then
      return v_id;
    end if;
    v_id := v_next;
  end loop;
  return null;
end;
$$;

revoke all on function private.resolve_food(uuid) from public, anon;
grant execute on function private.resolve_food(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- log_meal — creates one meal and all its items in a single transaction.
--
--   p_items: [{ "food_item_id": uuid } | { "food_submission_id": uuid },
--             "quantity": number }, …]   (1–40 items)
--
-- Nutrition snapshots are computed by the meal_items trigger from the food
-- source; clients never send nutrition values.
--
-- Dates (user's timezone):
--   today          → normal logging
--   past ≤ 90 days → late entry: allowed only as a NEW meal; it is locked
--                    immediately (its date is in the past)
--   future / older → rejected
--
-- SECURITY DEFINER so it can write the one-shot late-entry grant; ownership,
-- account state and food access are checked explicitly below.
-- -----------------------------------------------------------------------------
create function public.log_meal(
  p_meal_date date,
  p_items jsonb,
  p_meal_category public.meal_category default null,
  p_meal_name text default null,
  p_copied_from_meal_id uuid default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_max_items       constant integer := 40;
  c_late_entry_days constant integer := 90;
  v_user    uuid := auth.uid();
  v_today   date;
  v_late    boolean;
  v_meal_id uuid;
  v_item    jsonb;
begin
  if v_user is null or not private.is_active_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_meal_date is null then
    raise exception 'A date is required' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A meal needs at least one food' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > c_max_items then
    raise exception 'A meal can contain at most % foods', c_max_items using errcode = '22023';
  end if;

  v_today := private.user_local_date(v_user);
  if p_meal_date > v_today then
    raise exception 'Food cannot be logged for a future date' using errcode = '22023';
  end if;
  if p_meal_date < v_today - c_late_entry_days then
    raise exception 'Missing food can be added for the last % days only', c_late_entry_days
      using errcode = '22023';
  end if;
  v_late := p_meal_date < v_today;

  if p_copied_from_meal_id is not null and not exists (
    select 1 from public.meals m where m.id = p_copied_from_meal_id and m.user_id = v_user
  ) then
    raise exception 'Source meal not found' using errcode = 'P0002';
  end if;

  if v_late then
    insert into private.late_entry_grants (txid, user_id, meal_date)
    values (txid_current(), v_user, p_meal_date);
  end if;

  insert into public.meals (user_id, meal_date, meal_category, meal_name, copied_from_meal_id)
  values (v_user, p_meal_date, p_meal_category, nullif(btrim(p_meal_name), ''), p_copied_from_meal_id)
  returning id into v_meal_id;

  if v_late then
    update private.late_entry_grants
    set meal_id = v_meal_id
    where txid = txid_current() and user_id = v_user and meal_date = p_meal_date;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Invalid food entry' using errcode = '22023';
    end if;
    -- Snapshot, unit and food name are filled by the meal_items trigger.
    insert into public.meal_items (meal_id, user_id, food_item_id, food_submission_id, quantity)
    values (
      v_meal_id,
      v_user,
      nullif(v_item ->> 'food_item_id', '')::uuid,
      nullif(v_item ->> 'food_submission_id', '')::uuid,
      (v_item ->> 'quantity')::numeric
    );
  end loop;

  if v_late then
    delete from private.late_entry_grants where txid = txid_current() and user_id = v_user;
  end if;

  return v_meal_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- add_meal_items — appends foods to one of the caller's EXISTING meals in a
-- single statement. Runs as the caller, so RLS and the record guard apply:
-- only today's unlocked meals accept new items (never a past meal).
-- -----------------------------------------------------------------------------
create function public.add_meal_items(p_meal_id uuid, p_items jsonb)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one food' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 40 then
    raise exception 'Too many foods at once' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.meals m where m.id = p_meal_id and m.user_id = v_user and not m.is_deleted
  ) then
    raise exception 'Meal not found' using errcode = 'P0002';
  end if;

  insert into public.meal_items (meal_id, user_id, food_item_id, food_submission_id, quantity)
  select p_meal_id,
         v_user,
         nullif(item ->> 'food_item_id', '')::uuid,
         nullif(item ->> 'food_submission_id', '')::uuid,
         (item ->> 'quantity')::numeric
  from jsonb_array_elements(p_items) as item;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- copy_meal — copies one of the caller's meals into a date as a NEW meal with
-- the same foods and quantities (spec §10). The original is only read, never
-- changed; snapshots are taken now, from the food as it is today. Merged
-- foods are followed to the surviving food.
-- -----------------------------------------------------------------------------
create function public.copy_meal(p_source_meal_id uuid, p_target_date date)
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
             else
               jsonb_build_object('food_submission_id', mi.food_submission_id, 'quantity', mi.quantity)
           end
           order by mi.created_at, mi.id
         )
    into v_items
  from public.meal_items mi
  where mi.meal_id = p_source_meal_id and not mi.is_deleted;

  if v_items is null then
    raise exception 'This meal has no food to copy' using errcode = '22023';
  end if;

  return public.log_meal(p_target_date, v_items, v_category, v_name, p_source_meal_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- search_foods — shared approved foods + the caller's own pending submissions.
-- Runs as the caller (RLS applies). Ranking: exact / strong name match first,
-- then recently used, then frequently used, then broader similarity.
-- -----------------------------------------------------------------------------
create function public.search_foods(p_query text, p_limit integer default 20)
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
    select mi.food_item_id, mi.food_submission_id, count(*)::integer as use_count, max(m.meal_date) as last_used
    from public.meal_items mi
    join public.meals m on m.id = mi.meal_id
    where mi.user_id = (select auth.uid()) and not mi.is_deleted and not m.is_deleted
    group by mi.food_item_id, mi.food_submission_id
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

-- -----------------------------------------------------------------------------
-- food_usage — the caller's logged foods, most recent or most frequent first.
-- Merged foods resolve to the surviving food; unavailable foods are skipped.
-- -----------------------------------------------------------------------------
create function public.food_usage(p_order text default 'recent', p_limit integer default 8)
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
    select case when mi.food_item_id is not null then private.resolve_food(mi.food_item_id) end as food_item_id,
           mi.food_submission_id,
           count(*)::integer as use_count,
           max(m.meal_date) as last_used,
           max(mi.created_at) as last_logged_at
    from public.meal_items mi
    join public.meals m on m.id = mi.meal_id
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

revoke all on function
  public.log_meal(date, jsonb, public.meal_category, text, uuid),
  public.add_meal_items(uuid, jsonb),
  public.copy_meal(uuid, date),
  public.search_foods(text, integer),
  public.food_usage(text, integer)
from public, anon;
grant execute on function
  public.log_meal(date, jsonb, public.meal_category, text, uuid),
  public.add_meal_items(uuid, jsonb),
  public.copy_meal(uuid, date),
  public.search_foods(text, integer),
  public.food_usage(text, integer)
to authenticated;
