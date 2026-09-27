-- =============================================================================
-- Workouts, activities, steps, weight history and InBody reports.
-- Weekly workout adherence is derived by query (workouts + daily target
-- snapshots, Monday–Sunday weeks), not stored.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- workouts (spec §14, §58) — Phase 1: type + duration + calories only.
-- -----------------------------------------------------------------------------
create table public.workouts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id),
  workout_date       date not null,
  workout_type       text not null constraint workouts_type_valid check (
                       workout_type in (
                         'CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', 'LEGS',
                         'CHEST_TRICEPS', 'BACK_BICEPS', 'SHOULDERS_ARMS',
                         'UPPER_BODY', 'LOWER_BODY', 'FULL_BODY',
                         'HIIT', 'CARDIO', 'ATHLETIC_PERFORMANCE', 'CUSTOM'
                       )
                     ),
  custom_name        text constraint workouts_custom_name_length check (char_length(btrim(custom_name)) between 1 and 60),
  duration_minutes   integer not null constraint workouts_duration_range check (duration_minutes between 1 and 1440),
  estimated_calories numeric(7, 1) not null constraint workouts_estimated_nn check (estimated_calories >= 0),
  manual_calories    numeric(7, 1) constraint workouts_manual_nn check (manual_calories >= 0),
  final_calories     numeric(7, 1) generated always as (coalesce(manual_calories, estimated_calories)) stored,
  is_locked          boolean not null default false,
  locked_at          timestamptz,
  is_deleted         boolean not null default false,
  deleted_at         timestamptz,
  deleted_by         uuid references public.profiles (id),
  delete_reason      text,
  created_by         uuid default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint workouts_custom_name_required check ((workout_type = 'CUSTOM') = (custom_name is not null)),
  constraint workouts_locked_consistent check (is_locked = (locked_at is not null)),
  constraint workouts_deleted_consistent check (is_deleted = (deleted_at is not null))
);

create index workouts_user_date_idx on public.workouts (user_id, workout_date);

create trigger workouts_set_updated_at
before update on public.workouts
for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- activities (spec §18, §59) — separate from workouts; no frequency target.
-- -----------------------------------------------------------------------------
create table public.activities (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id),
  activity_date      date not null,
  activity_type      text not null constraint activities_type_valid check (
                       activity_type in (
                         'WALKING', 'RUNNING', 'CYCLING', 'TREADMILL', 'CRICKET', 'BADMINTON',
                         'SWIMMING', 'FOOTBALL', 'BASKETBALL', 'HIKING_TREKKING', 'CUSTOM'
                       )
                     ),
  custom_name        text constraint activities_custom_name_length check (char_length(btrim(custom_name)) between 1 and 60),
  duration_minutes   integer not null constraint activities_duration_range check (duration_minutes between 1 and 1440),
  estimated_calories numeric(7, 1) not null constraint activities_estimated_nn check (estimated_calories >= 0),
  manual_calories    numeric(7, 1) constraint activities_manual_nn check (manual_calories >= 0),
  final_calories     numeric(7, 1) generated always as (coalesce(manual_calories, estimated_calories)) stored,
  is_locked          boolean not null default false,
  locked_at          timestamptz,
  is_deleted         boolean not null default false,
  deleted_at         timestamptz,
  deleted_by         uuid references public.profiles (id),
  delete_reason      text,
  created_by         uuid default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint activities_custom_name_required check ((activity_type = 'CUSTOM') = (custom_name is not null)),
  constraint activities_locked_consistent check (is_locked = (locked_at is not null)),
  constraint activities_deleted_consistent check (is_deleted = (deleted_at is not null))
);

create index activities_user_date_idx on public.activities (user_id, activity_date);

create trigger activities_set_updated_at
before update on public.activities
for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- steps_entries (spec §19, §60) — every entry kept; exactly one active entry per
-- user/date, which is always the latest valid (non-deleted) one.
-- A missing date means "no data", never zero steps.
-- -----------------------------------------------------------------------------
create table public.steps_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id),
  entry_date    date not null,
  steps         integer not null constraint steps_range check (steps between 0 and 200000),
  is_active     boolean not null default true,
  is_deleted    boolean not null default false,
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles (id),
  delete_reason text,
  created_by    uuid default auth.uid() references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint steps_deleted_inactive check (not (is_active and is_deleted)),
  constraint steps_deleted_consistent check (is_deleted = (deleted_at is not null))
);

create unique index steps_one_active_per_day on public.steps_entries (user_id, entry_date) where is_active;
create index steps_user_date_idx on public.steps_entries (user_id, entry_date);

create trigger steps_set_updated_at
before update on public.steps_entries
for each row execute function private.set_updated_at();

-- A new entry supersedes the current active entry for that date.
create function private.steps_supersede_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.is_active := true;
  update public.steps_entries
  set is_active = false
  where user_id = new.user_id and entry_date = new.entry_date and is_active;
  return new;
end;
$$;

create trigger steps_supersede
before insert on public.steps_entries
for each row execute function private.steps_supersede_active();

-- Deleting the active entry re-activates the latest remaining valid entry.
create function private.steps_reactivate_latest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_deleted and not old.is_deleted and old.is_active then
    update public.steps_entries
    set is_active = true
    where id = (
      select s.id from public.steps_entries s
      where s.user_id = new.user_id and s.entry_date = new.entry_date
        and not s.is_deleted and s.id <> new.id
      order by s.created_at desc, s.id desc
      limit 1
    );
  end if;
  return null;
end;
$$;

create trigger steps_reactivate
after update of is_deleted on public.steps_entries
for each row execute function private.steps_reactivate_latest();

-- -----------------------------------------------------------------------------
-- InBody (spec §21, §62). File storage (Supabase Storage bucket + policies) is
-- added with the InBody feature; OCR/extraction is not implemented yet.
-- -----------------------------------------------------------------------------
create table public.inbody_reports (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id),
  report_date        date not null,
  file_path          text not null unique constraint inbody_reports_path_length check (char_length(file_path) between 1 and 500),
  file_type          text not null constraint inbody_reports_file_type check (
                       file_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')
                     ),
  extraction_status  public.inbody_extraction_status not null default 'PENDING',
  extraction_error   text,
  raw_extracted_text text,
  uploaded_by        uuid default auth.uid() references public.profiles (id),
  is_deleted         boolean not null default false,
  deleted_at         timestamptz,
  deleted_by         uuid references public.profiles (id),
  delete_reason      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint inbody_reports_id_user_unique unique (id, user_id),
  constraint inbody_reports_deleted_consistent check (is_deleted = (deleted_at is not null))
);

create index inbody_reports_user_date_idx on public.inbody_reports (user_id, report_date);

create trigger inbody_reports_set_updated_at
before update on public.inbody_reports
for each row execute function private.set_updated_at();

create table public.inbody_metrics (
  id                 uuid primary key default gen_random_uuid(),
  report_id          uuid not null unique,
  user_id            uuid not null,
  weight_kg          numeric(5, 2) constraint inbody_metrics_weight_range check (weight_kg between 20 and 400),
  body_fat_percent   numeric(4, 1) constraint inbody_metrics_body_fat_range check (body_fat_percent between 0 and 100),
  muscle_mass_kg     numeric(5, 2) constraint inbody_metrics_muscle_range check (muscle_mass_kg between 0 and 200),
  bmi                numeric(4, 1) constraint inbody_metrics_bmi_range check (bmi between 5 and 100),
  bmr_kcal           integer constraint inbody_metrics_bmr_range check (bmr_kcal between 500 and 5000),
  -- Any further metrics on the report (segmental analysis, visceral fat, …).
  other_metrics_json jsonb not null default '{}' constraint inbody_metrics_other_object check (jsonb_typeof(other_metrics_json) = 'object'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint inbody_metrics_report_fk foreign key (report_id, user_id) references public.inbody_reports (id, user_id)
);

create index inbody_metrics_user_idx on public.inbody_metrics (user_id);

create trigger inbody_metrics_set_updated_at
before update on public.inbody_metrics
for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- weight_measurements (spec §20, §61) — the single weight history. InBody
-- weights are mirrored in automatically (source = INBODY).
-- -----------------------------------------------------------------------------
create table public.weight_measurements (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id),
  measurement_date date not null,
  weight_kg        numeric(5, 2) not null constraint weight_range check (weight_kg between 20 and 400),
  source           public.measurement_source not null default 'MANUAL',
  inbody_report_id uuid unique,
  is_deleted       boolean not null default false,
  deleted_at       timestamptz,
  deleted_by       uuid references public.profiles (id),
  delete_reason    text,
  created_by       uuid default auth.uid() references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint weight_inbody_fk foreign key (inbody_report_id, user_id) references public.inbody_reports (id, user_id),
  constraint weight_source_consistent check ((source = 'INBODY') = (inbody_report_id is not null)),
  constraint weight_deleted_consistent check (is_deleted = (deleted_at is not null))
);

create index weight_user_date_idx on public.weight_measurements (user_id, measurement_date);

create trigger weight_set_updated_at
before update on public.weight_measurements
for each row execute function private.set_updated_at();

create function private.sync_inbody_weight()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report_date date;
begin
  select r.report_date into v_report_date from public.inbody_reports r where r.id = new.report_id;

  if new.weight_kg is null then
    update public.weight_measurements
    set is_deleted = true, delete_reason = 'InBody weight removed'
    where inbody_report_id = new.report_id and not is_deleted;
    return null;
  end if;

  insert into public.weight_measurements (user_id, measurement_date, weight_kg, source, inbody_report_id)
  values (new.user_id, v_report_date, new.weight_kg, 'INBODY', new.report_id)
  on conflict (inbody_report_id) do update
    set weight_kg = excluded.weight_kg, measurement_date = excluded.measurement_date,
        is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null;
  return null;
end;
$$;

create trigger inbody_metrics_sync_weight
after insert or update of weight_kg on public.inbody_metrics
for each row execute function private.sync_inbody_weight();
