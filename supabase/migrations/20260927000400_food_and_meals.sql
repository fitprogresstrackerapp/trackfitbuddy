-- =============================================================================
-- Food database, user submissions, merges, meals and meal items with
-- historical nutrition snapshots.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- food_submissions — user-created foods awaiting review (spec §11). Never part
-- of the shared database until an admin approves them into food_items.
-- -----------------------------------------------------------------------------
create table public.food_submissions (
  id                    uuid primary key default gen_random_uuid(),
  submitted_by          uuid not null default auth.uid() references public.profiles (id),
  name                  text not null constraint food_submissions_name_length check (char_length(btrim(name)) between 1 and 120),
  name_normalized       text generated always as (private.normalize_name(name)) stored,
  serving_quantity      numeric(8, 2) not null constraint food_submissions_serving_positive check (serving_quantity > 0),
  serving_unit          text not null constraint food_submissions_unit_format check (serving_unit ~ '^[a-z][a-z ]{0,19}$'),
  calories              numeric(8, 2) not null constraint food_submissions_calories_nn check (calories >= 0),
  protein_g             numeric(7, 2) not null constraint food_submissions_protein_nn check (protein_g >= 0),
  carbs_g               numeric(7, 2) not null constraint food_submissions_carbs_nn check (carbs_g >= 0),
  fat_g                 numeric(7, 2) not null constraint food_submissions_fat_nn check (fat_g >= 0),
  fiber_g               numeric(7, 2) not null constraint food_submissions_fiber_nn check (fiber_g >= 0),
  status                public.food_review_status not null default 'PENDING_REVIEW',
  reviewed_by           uuid references public.profiles (id),
  reviewed_at           timestamptz,
  review_notes          text,
  approved_food_item_id uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint food_submissions_id_owner_unique unique (id, submitted_by),
  constraint food_submissions_review_consistent check (
    (status = 'PENDING_REVIEW' and reviewed_at is null and reviewed_by is null and approved_food_item_id is null)
    or (status = 'APPROVED' and reviewed_at is not null and approved_food_item_id is not null)
    or (status = 'REJECTED' and reviewed_at is not null and approved_food_item_id is null)
  )
);

create index food_submissions_status_idx on public.food_submissions (status, created_at);
create index food_submissions_owner_idx on public.food_submissions (submitted_by, created_at desc);
create index food_submissions_name_trgm_idx on public.food_submissions
  using gin (name_normalized extensions.gin_trgm_ops);

create trigger food_submissions_set_updated_at
before update on public.food_submissions
for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- food_items — shared, curated food master (spec §11). Nutrition values are
-- per serving_quantity of serving_unit.
-- -----------------------------------------------------------------------------
create table public.food_items (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null constraint food_items_name_length check (char_length(btrim(name)) between 1 and 120),
  name_normalized      text generated always as (private.normalize_name(name)) stored,
  serving_quantity     numeric(8, 2) not null constraint food_items_serving_positive check (serving_quantity > 0),
  serving_unit         text not null constraint food_items_unit_format check (serving_unit ~ '^[a-z][a-z ]{0,19}$'),
  calories             numeric(8, 2) not null constraint food_items_calories_nn check (calories >= 0),
  protein_g            numeric(7, 2) not null constraint food_items_protein_nn check (protein_g >= 0),
  carbs_g              numeric(7, 2) not null constraint food_items_carbs_nn check (carbs_g >= 0),
  fat_g                numeric(7, 2) not null constraint food_items_fat_nn check (fat_g >= 0),
  fiber_g              numeric(7, 2) not null constraint food_items_fiber_nn check (fiber_g >= 0),
  -- Values are approximations and must be labelled as such (spec §10).
  is_approximate       boolean not null default true,
  source_submission_id uuid unique references public.food_submissions (id),
  merged_into_food_id  uuid references public.food_items (id),
  version              integer not null default 1,
  is_deleted           boolean not null default false,
  deleted_at           timestamptz,
  deleted_by           uuid references public.profiles (id),
  delete_reason        text,
  created_by           uuid default auth.uid() references public.profiles (id),
  updated_by           uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint food_items_not_merged_into_self check (merged_into_food_id <> id),
  constraint food_items_deleted_consistent check (is_deleted = (deleted_at is not null))
);

-- Search over the active shared catalogue.
create index food_items_name_trgm_idx on public.food_items
  using gin (name_normalized extensions.gin_trgm_ops)
  where not is_deleted and merged_into_food_id is null;
create index food_items_name_idx on public.food_items (name_normalized)
  where not is_deleted and merged_into_food_id is null;

alter table public.food_submissions
  add constraint food_submissions_approved_food_fk
  foreign key (approved_food_item_id) references public.food_items (id);

create trigger food_items_set_updated_at
before update on public.food_items
for each row execute function private.set_updated_at();

-- Version history of food master changes (spec table food_item_versions).
create table public.food_item_versions (
  id               uuid primary key default gen_random_uuid(),
  food_item_id     uuid not null references public.food_items (id),
  version          integer not null,
  name             text not null,
  serving_quantity numeric(8, 2) not null,
  serving_unit     text not null,
  calories         numeric(8, 2) not null,
  protein_g        numeric(7, 2) not null,
  carbs_g          numeric(7, 2) not null,
  fat_g            numeric(7, 2) not null,
  fiber_g          numeric(7, 2) not null,
  changed_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  constraint food_item_versions_unique unique (food_item_id, version)
);

create function private.bump_food_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := private.current_actor_id();
  if (new.name, new.serving_quantity, new.serving_unit, new.calories, new.protein_g,
      new.carbs_g, new.fat_g, new.fiber_g)
     is distinct from
     (old.name, old.serving_quantity, old.serving_unit, old.calories, old.protein_g,
      old.carbs_g, old.fat_g, old.fiber_g) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

create trigger food_items_bump_version
before update on public.food_items
for each row execute function private.bump_food_version();

create function private.record_food_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into public.food_item_versions (
      food_item_id, version, name, serving_quantity, serving_unit,
      calories, protein_g, carbs_g, fat_g, fiber_g, changed_by
    ) values (
      new.id, new.version, new.name, new.serving_quantity, new.serving_unit,
      new.calories, new.protein_g, new.carbs_g, new.fat_g, new.fiber_g, private.current_actor_id()
    );
  end if;
  return null;
end;
$$;

create trigger food_items_record_version
after insert or update on public.food_items
for each row execute function private.record_food_version();

-- Duplicate merges (spec §11). Historical meal snapshots are unaffected because
-- meal items store their own nutrition values.
create table public.food_merges (
  id             uuid primary key default gen_random_uuid(),
  source_food_id uuid not null unique references public.food_items (id),
  target_food_id uuid not null references public.food_items (id),
  merged_by      uuid default auth.uid() references public.profiles (id),
  reason         text,
  created_at     timestamptz not null default now(),
  constraint food_merges_distinct check (source_food_id <> target_food_id)
);

create index food_merges_target_idx on public.food_merges (target_food_id);

-- -----------------------------------------------------------------------------
-- meals (spec §56). Category is optional.
-- -----------------------------------------------------------------------------
create table public.meals (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id),
  meal_date           date not null,
  meal_name           text constraint meals_name_length check (char_length(btrim(meal_name)) between 1 and 100),
  meal_category       public.meal_category,
  -- Provenance only: a copied meal is an independent record (spec §10).
  copied_from_meal_id uuid,
  is_locked           boolean not null default false,
  locked_at           timestamptz,
  is_deleted          boolean not null default false,
  deleted_at          timestamptz,
  deleted_by          uuid references public.profiles (id),
  delete_reason       text,
  created_by          uuid default auth.uid() references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint meals_id_user_unique unique (id, user_id),
  constraint meals_copied_from_fk foreign key (copied_from_meal_id, user_id) references public.meals (id, user_id),
  constraint meals_locked_consistent check (is_locked = (locked_at is not null)),
  constraint meals_deleted_consistent check (is_deleted = (deleted_at is not null))
);

create index meals_user_date_idx on public.meals (user_id, meal_date);

create trigger meals_set_updated_at
before update on public.meals
for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- meal_items (spec §57) — snapshot_* hold the nutrition values that applied when
-- the item was logged. They never follow later food master changes.
-- A user may log an approved shared food or their own (pending) submission.
-- -----------------------------------------------------------------------------
create table public.meal_items (
  id                 uuid primary key default gen_random_uuid(),
  meal_id            uuid not null,
  user_id            uuid not null,
  food_item_id       uuid references public.food_items (id),
  food_submission_id uuid,
  food_name_snapshot text not null,
  quantity           numeric(8, 2) not null constraint meal_items_quantity_positive check (quantity > 0),
  unit               text not null,
  snapshot_calories  numeric(8, 2) not null constraint meal_items_calories_nn check (snapshot_calories >= 0),
  snapshot_protein_g numeric(7, 2) not null constraint meal_items_protein_nn check (snapshot_protein_g >= 0),
  snapshot_carbs_g   numeric(7, 2) not null constraint meal_items_carbs_nn check (snapshot_carbs_g >= 0),
  snapshot_fat_g     numeric(7, 2) not null constraint meal_items_fat_nn check (snapshot_fat_g >= 0),
  snapshot_fiber_g   numeric(7, 2) not null constraint meal_items_fiber_nn check (snapshot_fiber_g >= 0),
  is_deleted         boolean not null default false,
  deleted_at         timestamptz,
  deleted_by         uuid references public.profiles (id),
  delete_reason      text,
  created_by         uuid default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint meal_items_meal_fk foreign key (meal_id, user_id) references public.meals (id, user_id),
  -- Only the user's own submissions may be logged.
  constraint meal_items_submission_fk foreign key (food_submission_id, user_id)
    references public.food_submissions (id, submitted_by),
  constraint meal_items_one_food_source check (num_nonnulls(food_item_id, food_submission_id) = 1),
  constraint meal_items_deleted_consistent check (is_deleted = (deleted_at is not null))
);

create index meal_items_meal_idx on public.meal_items (meal_id);
create index meal_items_user_idx on public.meal_items (user_id);

create trigger meal_items_set_updated_at
before update on public.meal_items
for each row execute function private.set_updated_at();

-- Snapshot maintenance:
--   INSERT: snapshot computed from the food source (client values ignored).
--   UPDATE of quantity: snapshot rescaled from the existing snapshot, so the
--           originally captured per-unit values are preserved (spec §12).
--   Food source cannot be swapped on an existing item.
--   Only admins (corrections) may set snapshot values directly.
create function private.maintain_meal_item_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text; v_qty numeric; v_unit text;
  v_cal numeric; v_pro numeric; v_carb numeric; v_fat numeric; v_fib numeric;
  v_factor numeric;
  v_is_admin boolean := auth.uid() is null or private.is_admin();
begin
  if tg_op = 'INSERT' then
    if num_nonnulls(new.food_item_id, new.food_submission_id) <> 1 then
      raise exception 'A meal item needs exactly one food source' using errcode = '23514';
    end if;

    if new.food_item_id is not null then
      select f.name, f.serving_quantity, f.serving_unit, f.calories, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g
        into v_name, v_qty, v_unit, v_cal, v_pro, v_carb, v_fat, v_fib
      from public.food_items f
      where f.id = new.food_item_id and not f.is_deleted and f.merged_into_food_id is null;
    else
      select s.name, s.serving_quantity, s.serving_unit, s.calories, s.protein_g, s.carbs_g, s.fat_g, s.fiber_g
        into v_name, v_qty, v_unit, v_cal, v_pro, v_carb, v_fat, v_fib
      from public.food_submissions s
      where s.id = new.food_submission_id and s.status <> 'REJECTED';
    end if;

    if v_name is null then
      raise exception 'Food is not available for logging' using errcode = '23503';
    end if;

    v_factor := new.quantity / v_qty;
    new.food_name_snapshot := v_name;
    new.unit := v_unit;
    new.snapshot_calories := round(v_cal * v_factor, 2);
    new.snapshot_protein_g := round(v_pro * v_factor, 2);
    new.snapshot_carbs_g := round(v_carb * v_factor, 2);
    new.snapshot_fat_g := round(v_fat * v_factor, 2);
    new.snapshot_fiber_g := round(v_fib * v_factor, 2);
    return new;
  end if;

  -- UPDATE
  if new.food_item_id is distinct from old.food_item_id
     or new.food_submission_id is distinct from old.food_submission_id
     or new.unit is distinct from old.unit then
    raise exception 'The food of a meal item cannot be changed; add a new item instead' using errcode = '42501';
  end if;

  if not v_is_admin and (new.food_name_snapshot, new.snapshot_calories, new.snapshot_protein_g,
      new.snapshot_carbs_g, new.snapshot_fat_g, new.snapshot_fiber_g)
     is distinct from (old.food_name_snapshot, old.snapshot_calories, old.snapshot_protein_g,
      old.snapshot_carbs_g, old.snapshot_fat_g, old.snapshot_fiber_g) then
    raise exception 'Nutrition snapshots can only be corrected by an admin' using errcode = '42501';
  end if;

  if new.quantity <> old.quantity and (new.snapshot_calories, new.snapshot_protein_g, new.snapshot_carbs_g,
      new.snapshot_fat_g, new.snapshot_fiber_g) is not distinct from (old.snapshot_calories,
      old.snapshot_protein_g, old.snapshot_carbs_g, old.snapshot_fat_g, old.snapshot_fiber_g) then
    v_factor := new.quantity / old.quantity;
    new.snapshot_calories := round(old.snapshot_calories * v_factor, 2);
    new.snapshot_protein_g := round(old.snapshot_protein_g * v_factor, 2);
    new.snapshot_carbs_g := round(old.snapshot_carbs_g * v_factor, 2);
    new.snapshot_fat_g := round(old.snapshot_fat_g * v_factor, 2);
    new.snapshot_fiber_g := round(old.snapshot_fiber_g * v_factor, 2);
  end if;

  return new;
end;
$$;

create trigger meal_items_snapshot
before insert or update on public.meal_items
for each row execute function private.maintain_meal_item_snapshot();
