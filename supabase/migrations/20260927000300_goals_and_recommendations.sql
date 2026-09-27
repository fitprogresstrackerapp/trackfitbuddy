-- =============================================================================
-- Goals, recommendation processing, recommendation cycles, feedback and
-- daily target snapshots.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- goals — versioned. One active row per user. A goal row used by a
-- recommendation cycle becomes immutable (spec §22 cycle locking); changing
-- goals means deactivating the row and inserting a new one, which only affects
-- the next cycle.
-- -----------------------------------------------------------------------------
create table public.goals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id),
  long_term_goal text not null constraint goals_long_term_goal_valid check (
                   long_term_goal in ('FAT_LOSS', 'MUSCLE_GAIN', 'GENERAL_FITNESS', 'PERFORMANCE')
                 ),
  -- Free-text objective (spec §22 "User may describe their objective").
  description    text constraint goals_description_length check (char_length(description) <= 2000),
  effective_from date not null,
  effective_to   date,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint goals_id_user_unique unique (id, user_id),
  constraint goals_effective_range check (effective_to is null or effective_to >= effective_from),
  constraint goals_active_open check (not is_active or effective_to is null)
);

create unique index goals_one_active_per_user on public.goals (user_id) where is_active;
create index goals_user_idx on public.goals (user_id, effective_from desc);

create trigger goals_set_updated_at
before update on public.goals
for each row execute function private.set_updated_at();

create table public.goal_focuses (
  id         uuid primary key default gen_random_uuid(),
  goal_id    uuid not null,
  user_id    uuid not null,
  focus_type text not null constraint goal_focuses_type_valid check (
               focus_type in (
                 'MUSCLE_BUILDING', 'RECOMPOSITION', 'CRICKET_PERFORMANCE', 'BADMINTON_PERFORMANCE',
                 'FLEXIBILITY', 'ENDURANCE', 'GENERAL_FITNESS'
               )
             ),
  priority   smallint not null constraint goal_focuses_priority_positive check (priority >= 1),
  created_at timestamptz not null default now(),
  constraint goal_focuses_goal_fk foreign key (goal_id, user_id) references public.goals (id, user_id),
  constraint goal_focuses_type_unique unique (goal_id, focus_type),
  constraint goal_focuses_priority_unique unique (goal_id, priority)
);

create index goal_focuses_user_idx on public.goal_focuses (user_id);

create function private.default_goal_effective_from()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.effective_from := coalesce(new.effective_from, private.user_local_date(new.user_id));
  return new;
end;
$$;

create trigger goals_default_effective_from
before insert on public.goals
for each row execute function private.default_goal_effective_from();

-- -----------------------------------------------------------------------------
-- Processing runs (spec §41–42) and per-user processing attempts (spec §43).
-- Raw AI input/output lives here (one copy); a successful attempt produces a
-- recommendation_cycles row that references it.
-- -----------------------------------------------------------------------------
create table public.recommendation_processing_runs (
  id               uuid primary key default gen_random_uuid(),
  processing_month date not null constraint processing_runs_month_first_day check (extract(day from processing_month) = 1),
  status           public.processing_run_status not null default 'CREATED',
  provider         text,
  model            text,
  prompt_version   text,
  batch_size       integer constraint processing_runs_batch_size check (batch_size between 1 and 100),
  budget_limit     numeric(12, 2) constraint processing_runs_budget_non_negative check (budget_limit >= 0),
  currency         text not null default 'INR' constraint processing_runs_currency check (currency ~ '^[A-Z]{3}$'),
  failure_reason   text,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint processing_runs_completion_order check (
    completed_at is null or (started_at is not null and completed_at >= started_at)
  )
);

create index processing_runs_month_idx on public.recommendation_processing_runs (processing_month, created_at desc);

create trigger processing_runs_set_updated_at
before update on public.recommendation_processing_runs
for each row execute function private.set_updated_at();

create table public.recommendation_processing_users (
  id                         uuid primary key default gen_random_uuid(),
  processing_run_id          uuid not null references public.recommendation_processing_runs (id),
  user_id                    uuid not null references public.profiles (id),
  -- Retries of the same user in the same run are new attempts; history is kept.
  attempt_number             smallint not null default 1 constraint processing_users_attempt_positive check (attempt_number >= 1),
  batch_number               integer constraint processing_users_batch_positive check (batch_number >= 1),
  status                     public.processing_user_status not null default 'PENDING',
  skip_reason                text,
  failure_reason             text,
  input_schema_version       text,
  raw_input_json             jsonb,
  raw_output_json            jsonb,
  parsed_recommendation_json jsonb,
  recommended_calories       integer constraint processing_users_calories_positive check (recommended_calories > 0),
  recommended_protein_g      numeric(6, 1) constraint processing_users_protein_nn check (recommended_protein_g >= 0),
  recommended_carbs_g        numeric(6, 1) constraint processing_users_carbs_nn check (recommended_carbs_g >= 0),
  recommended_fat_g          numeric(6, 1) constraint processing_users_fat_nn check (recommended_fat_g >= 0),
  recommended_fiber_g        numeric(6, 1) constraint processing_users_fiber_nn check (recommended_fiber_g >= 0),
  provider                   text,
  model                      text,
  prompt_version             text,
  input_tokens               integer constraint processing_users_input_tokens_nn check (input_tokens >= 0),
  output_tokens              integer constraint processing_users_output_tokens_nn check (output_tokens >= 0),
  total_tokens               integer generated always as (coalesce(input_tokens, 0) + coalesce(output_tokens, 0)) stored,
  estimated_cost             numeric(12, 6) constraint processing_users_estimated_cost_nn check (estimated_cost >= 0),
  actual_cost                numeric(12, 6) constraint processing_users_actual_cost_nn check (actual_cost >= 0),
  currency                   text not null default 'INR' constraint processing_users_currency check (currency ~ '^[A-Z]{3}$'),
  started_at                 timestamptz,
  generated_at               timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint processing_users_id_user_unique unique (id, user_id),
  constraint processing_users_attempt_unique unique (processing_run_id, user_id, attempt_number),
  constraint processing_users_success_complete check (
    status <> 'SUCCESS' or (
      parsed_recommendation_json is not null and generated_at is not null
      and recommended_calories is not null and recommended_protein_g is not null
      and recommended_carbs_g is not null and recommended_fat_g is not null
      and recommended_fiber_g is not null and provider is not null and model is not null
      and prompt_version is not null
    )
  ),
  constraint processing_users_failure_reason check (status <> 'FAILED' or failure_reason is not null),
  constraint processing_users_skip_reason check (status <> 'SKIPPED' or skip_reason is not null)
);

create index processing_users_run_status_idx on public.recommendation_processing_users (processing_run_id, status);
create index processing_users_user_idx on public.recommendation_processing_users (user_id, created_at desc);

create trigger processing_users_set_updated_at
before update on public.recommendation_processing_users
for each row execute function private.set_updated_at();

-- One row per AI provider request (spec §40). A request may cover a batch.
create table public.ai_usage_records (
  id                 uuid primary key default gen_random_uuid(),
  processing_run_id  uuid not null references public.recommendation_processing_runs (id),
  processing_user_id uuid references public.recommendation_processing_users (id),
  batch_number       integer constraint ai_usage_batch_positive check (batch_number >= 1),
  provider           text not null,
  model              text not null,
  prompt_version     text,
  input_tokens       integer not null default 0 constraint ai_usage_input_tokens_nn check (input_tokens >= 0),
  output_tokens      integer not null default 0 constraint ai_usage_output_tokens_nn check (output_tokens >= 0),
  total_tokens       integer generated always as (input_tokens + output_tokens) stored,
  estimated_cost     numeric(12, 6) constraint ai_usage_estimated_cost_nn check (estimated_cost >= 0),
  actual_cost        numeric(12, 6) constraint ai_usage_actual_cost_nn check (actual_cost >= 0),
  currency           text not null default 'INR' constraint ai_usage_currency check (currency ~ '^[A-Z]{3}$'),
  succeeded          boolean not null,
  error_message      text,
  created_at         timestamptz not null default now()
);

create index ai_usage_run_idx on public.ai_usage_records (processing_run_id);
create index ai_usage_created_idx on public.ai_usage_records (created_at);
create index ai_usage_model_idx on public.ai_usage_records (model, created_at);

-- -----------------------------------------------------------------------------
-- recommendation_cycles — the analytical period (spec §29, §54).
-- period_start = actual generation date (user's calendar), period_end = the day
-- before the next generation (inclusive), null while current. Calendar month is
-- a UI concept only: processing_month is kept for labelling.
-- AI originals (recommended_*, parsed_output_json) are never overwritten; the
-- user's review edits go to final_* / workout_plan_json and are audited.
-- -----------------------------------------------------------------------------
create table public.recommendation_cycles (
  id                           uuid primary key default gen_random_uuid(),
  user_id                      uuid not null references public.profiles (id),
  processing_month             date not null constraint cycles_month_first_day check (extract(day from processing_month) = 1),
  previous_cycle_id            uuid,
  processing_user_id           uuid not null,
  -- Goals and capacity locked for this cycle (spec §22, §16).
  goal_id                      uuid,
  workout_days_per_week        smallint not null constraint cycles_workout_capacity check (workout_days_per_week between 2 and 6),
  period_start                 date not null,
  period_end                   date,
  generated_at                 timestamptz not null,
  -- Last day of the 2-calendar-day review window; auto-lock the day after (spec §32).
  review_deadline              date not null,
  locked_at                    timestamptz,
  locked_by                    uuid references public.profiles (id), -- null = auto-locked by system
  status                       public.recommendation_cycle_status not null default 'IN_REVIEW',
  parsed_output_json           jsonb not null,
  provider                     text not null,
  model                        text not null,
  prompt_version               text not null,
  recommended_calories         integer not null constraint cycles_rec_calories_positive check (recommended_calories > 0),
  recommended_protein_g        numeric(6, 1) not null constraint cycles_rec_protein_nn check (recommended_protein_g >= 0),
  recommended_carbs_g          numeric(6, 1) not null constraint cycles_rec_carbs_nn check (recommended_carbs_g >= 0),
  recommended_fat_g            numeric(6, 1) not null constraint cycles_rec_fat_nn check (recommended_fat_g >= 0),
  recommended_fiber_g          numeric(6, 1) not null constraint cycles_rec_fiber_nn check (recommended_fiber_g >= 0),
  final_calories               integer not null constraint cycles_final_calories_positive check (final_calories > 0),
  final_protein_g              numeric(6, 1) not null constraint cycles_final_protein_nn check (final_protein_g >= 0),
  final_carbs_g                numeric(6, 1) not null constraint cycles_final_carbs_nn check (final_carbs_g >= 0),
  final_fat_g                  numeric(6, 1) not null constraint cycles_final_fat_nn check (final_fat_g >= 0),
  final_fiber_g                numeric(6, 1) not null constraint cycles_final_fiber_nn check (final_fiber_g >= 0),
  workout_plan_json            jsonb not null, -- final (possibly user-edited) template; AI original stays in parsed_output_json
  activity_recommendation_json jsonb,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  constraint cycles_id_user_unique unique (id, user_id),
  constraint cycles_processing_user_unique unique (processing_user_id),
  constraint cycles_processing_user_fk foreign key (processing_user_id, user_id)
    references public.recommendation_processing_users (id, user_id),
  constraint cycles_previous_fk foreign key (previous_cycle_id, user_id)
    references public.recommendation_cycles (id, user_id),
  constraint cycles_goal_fk foreign key (goal_id, user_id) references public.goals (id, user_id),
  constraint cycles_period_order check (period_end is null or period_end >= period_start),
  constraint cycles_review_window check (review_deadline = period_start + 1),
  constraint cycles_locked_consistent check (
    (status = 'IN_REVIEW' and locked_at is null) or (status = 'LOCKED' and locked_at is not null) or status = 'REPLACED'
  ),
  -- Cycles of one user never overlap (replaced cycles excluded).
  constraint cycles_no_overlap exclude using gist (
    user_id with =,
    daterange(period_start, period_end, '[]') with &&
  ) where (status <> 'REPLACED')
);

create index cycles_user_generated_idx on public.recommendation_cycles (user_id, generated_at);
create unique index cycles_one_per_user_month on public.recommendation_cycles (user_id, processing_month)
  where status <> 'REPLACED';
create unique index cycles_one_open_per_user on public.recommendation_cycles (user_id)
  where period_end is null and status <> 'REPLACED';
create index cycles_status_idx on public.recommendation_cycles (status, review_deadline);

create trigger cycles_set_updated_at
before update on public.recommendation_cycles
for each row execute function private.set_updated_at();

-- AI originals are immutable once written.
create function private.protect_cycle_originals()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.recommended_calories, new.recommended_protein_g, new.recommended_carbs_g,
      new.recommended_fat_g, new.recommended_fiber_g, new.parsed_output_json,
      new.processing_user_id, new.user_id, new.provider, new.model, new.prompt_version,
      new.generated_at, new.period_start, new.goal_id, new.workout_days_per_week)
     is distinct from
     (old.recommended_calories, old.recommended_protein_g, old.recommended_carbs_g,
      old.recommended_fat_g, old.recommended_fiber_g, old.parsed_output_json,
      old.processing_user_id, old.user_id, old.provider, old.model, old.prompt_version,
      old.generated_at, old.period_start, old.goal_id, old.workout_days_per_week) then
    raise exception 'AI recommendation originals, locked goals and capacity cannot be modified'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger cycles_protect_originals
before update on public.recommendation_cycles
for each row execute function private.protect_cycle_originals();

-- Goals referenced by a cycle are locked for that cycle (spec §22).
create function private.enforce_goal_cycle_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal_id uuid;
begin
  if tg_table_name = 'goals' then
    if exists (select 1 from public.recommendation_cycles c where c.goal_id = old.id) and (
      new.long_term_goal, new.description, new.effective_from, new.user_id
    ) is distinct from (
      old.long_term_goal, old.description, old.effective_from, old.user_id
    ) then
      raise exception 'Goal is locked by a recommendation cycle; create a new goal version instead'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- goal_focuses
  v_goal_id := case when tg_op = 'DELETE' then old.goal_id else new.goal_id end;
  if exists (select 1 from public.recommendation_cycles c where c.goal_id = v_goal_id)
     or (tg_op = 'UPDATE' and exists (select 1 from public.recommendation_cycles c where c.goal_id = old.goal_id)) then
    raise exception 'Goal focuses are locked by a recommendation cycle; create a new goal version instead'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger goals_cycle_lock
before update on public.goals
for each row execute function private.enforce_goal_cycle_lock();

create trigger goal_focuses_cycle_lock
before insert or update or delete on public.goal_focuses
for each row execute function private.enforce_goal_cycle_lock();

-- -----------------------------------------------------------------------------
-- recommendation_feedback — monthly user feedback (spec §31). One row per user
-- per processing month; locked once processing uses it. Never overwritten
-- across months.
-- -----------------------------------------------------------------------------
create table public.recommendation_feedback (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles (id),
  feedback_month           date not null constraint feedback_month_first_day check (extract(day from feedback_month) = 1),
  feedback                 text not null constraint feedback_length check (char_length(btrim(feedback)) between 1 and 2000),
  recommendation_cycle_id  uuid,
  locked_at                timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint feedback_user_month_unique unique (user_id, feedback_month),
  constraint feedback_cycle_fk foreign key (recommendation_cycle_id, user_id)
    references public.recommendation_cycles (id, user_id),
  constraint feedback_cycle_locked check (recommendation_cycle_id is null or locked_at is not null)
);

create trigger feedback_set_updated_at
before update on public.recommendation_feedback
for each row execute function private.set_updated_at();

-- Feedback window: from the 1st of the month until that month's recommendation
-- is generated (spec §31), evaluated in the user's timezone.
create function private.feedback_window_open(p_user_id uuid, p_month date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_month = date_trunc('month', private.user_local_date(p_user_id))::date
    and not exists (
      select 1 from public.recommendation_cycles c
      where c.user_id = p_user_id and c.processing_month = p_month and c.status <> 'REPLACED'
    );
$$;

revoke all on function private.feedback_window_open(uuid, date) from public;
grant execute on function private.feedback_window_open(uuid, date) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- daily_target_snapshots — the target that applied on each date (spec §26, §55).
-- Stores the tolerance in force too, so later setting changes never rewrite
-- historical adherence. Written only by trusted server code.
-- -----------------------------------------------------------------------------
create table public.daily_target_snapshots (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.profiles (id),
  recommendation_cycle_id uuid not null,
  target_date             date not null,
  calories                integer not null constraint targets_calories_positive check (calories > 0),
  protein_g               numeric(6, 1) not null constraint targets_protein_nn check (protein_g >= 0),
  carbs_g                 numeric(6, 1) not null constraint targets_carbs_nn check (carbs_g >= 0),
  fat_g                   numeric(6, 1) not null constraint targets_fat_nn check (fat_g >= 0),
  fiber_g                 numeric(6, 1) not null constraint targets_fiber_nn check (fiber_g >= 0),
  workouts_per_week       smallint not null constraint targets_workouts_per_week check (workouts_per_week between 2 and 6),
  nutrition_tolerance     numeric(3, 2) not null constraint targets_nutrition_tolerance check (nutrition_tolerance between 0.50 and 1.00),
  calorie_lower_tolerance numeric(3, 2) not null constraint targets_calorie_lower check (calorie_lower_tolerance between 0.50 and 1.00),
  calorie_upper_tolerance numeric(3, 2) not null constraint targets_calorie_upper check (calorie_upper_tolerance between 1.00 and 2.00),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint targets_user_date_unique unique (user_id, target_date),
  constraint targets_cycle_fk foreign key (recommendation_cycle_id, user_id)
    references public.recommendation_cycles (id, user_id)
);

create index targets_cycle_idx on public.daily_target_snapshots (recommendation_cycle_id);

create trigger targets_set_updated_at
before update on public.daily_target_snapshots
for each row execute function private.set_updated_at();
