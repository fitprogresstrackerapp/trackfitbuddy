-- =============================================================================
-- Monthly AI recommendation engine (spec §29–43, §71–73). Prompt 10.
--
-- Extends the existing processing tables. It adds no parallel structures.
--   * Runs record the admin action (mode) that created them.
--   * Attempts record the goal version, capacity and pricing version used,
--     their own processing month, and a budget reservation while PROCESSING.
--   * At most one open attempt (PENDING/PROCESSING) per user: this blocks
--     double processing.
--   * Operational AI configuration lives in system_settings. Secrets
--     (provider API keys) stay in Edge Function environment variables.
--
-- Monthly feedback (spec §31) is closed while the user's recommendation is
-- being generated. A guard trigger closes the race with the processing claim.
--
-- Processing functions are callable only by the service role. The
-- process-recommendations Edge Function verifies the admin, then calls them.
-- Admins read through recommendation_overview() and ai_usage_summary().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema extensions
-- -----------------------------------------------------------------------------
alter table public.recommendation_processing_runs
  add column mode text not null default 'PROCESS'
    constraint processing_runs_mode_valid check (mode in ('PROCESS', 'RETRY', 'REPROCESS'));

alter table public.recommendation_processing_users
  -- The user's own calendar month when the attempt was queued (their cycle month).
  add column processing_month      date constraint processing_users_month_first_day check (extract(day from processing_month) = 1),
  -- Budget held while the provider call runs; released when the attempt ends.
  add column reserved_cost         numeric(12, 6) constraint processing_users_reserved_nn check (reserved_cost >= 0),
  add column pricing_version       text,
  -- The goal version and capacity the input was built from (become the cycle's).
  add column goal_id               uuid,
  add column workout_days_per_week smallint constraint processing_users_capacity check (workout_days_per_week between 2 and 6),
  add constraint processing_users_goal_fk foreign key (goal_id, user_id) references public.goals (id, user_id),
  add constraint processing_users_reservation_open check (reserved_cost is null or status = 'PROCESSING');

-- Duplicate prevention (spec §39, §68): one queued or running attempt per user.
create unique index processing_users_one_open_per_user on public.recommendation_processing_users (user_id)
  where status in ('PENDING', 'PROCESSING');
create index processing_users_month_idx on public.recommendation_processing_users (processing_month, user_id);

alter table public.ai_usage_records add column pricing_version text;

-- -----------------------------------------------------------------------------
-- Operational AI configuration (spec §77). Same as the latest version
-- (20261002000100, incl. training_calorie_rates), plus the new AI keys.
-- -----------------------------------------------------------------------------
create or replace function private.validate_system_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v jsonb := new.value_json;
  v_model record;
  v_min integer;
  v_max integer;
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
    when 'training_calorie_rates' then
      if not coalesce(private.training_rates_valid(v), false) then
        raise exception 'training_calorie_rates needs workout and activity objects with a numeric default; rates are kcal/min between 0 and 30'
          using errcode = '22023';
      end if;
    when 'ai_enabled' then
      if jsonb_typeof(v) <> 'boolean' then
        raise exception 'ai_enabled must be true or false' using errcode = '22023';
      end if;
    when 'ai_prompt_version' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^recommendation-v[0-9]+$' then
        raise exception 'ai_prompt_version must look like recommendation-v1' using errcode = '22023';
      end if;
    when 'ai_max_output_tokens', 'ai_request_timeout_seconds', 'ai_max_retries', 'ai_stale_processing_minutes' then
      v_min := case new.key when 'ai_max_output_tokens' then 256 when 'ai_request_timeout_seconds' then 5
                            when 'ai_max_retries' then 0 else 5 end;
      v_max := case new.key when 'ai_max_output_tokens' then 16000 when 'ai_request_timeout_seconds' then 300
                            when 'ai_max_retries' then 3 else 1440 end;
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric <> trunc((v::text)::numeric)
         or (v::text)::numeric not between v_min and v_max then
        raise exception '% must be an integer between % and %', new.key, v_min, v_max using errcode = '22023';
      end if;
    when 'ai_pricing' then
      -- Versioned price list (per million tokens, in the pricing currency).
      if jsonb_typeof(v) <> 'object'
         or coalesce(jsonb_typeof(v -> 'version'), '') <> 'string'
         or char_length(v ->> 'version') not between 1 and 40
         or coalesce(jsonb_typeof(v -> 'currency'), '') <> 'string' or (v ->> 'currency') !~ '^[A-Z]{3}$'
         or coalesce(jsonb_typeof(v -> 'models'), '') <> 'object' then
        raise exception 'ai_pricing must be {version, currency, models}' using errcode = '22023';
      end if;
      for v_model in select key, value from jsonb_each(v -> 'models') loop
        if coalesce(jsonb_typeof(v_model.value -> 'input_per_million'), '') <> 'number'
           or coalesce(jsonb_typeof(v_model.value -> 'output_per_million'), '') <> 'number'
           or (v_model.value ->> 'input_per_million')::numeric < 0
           or (v_model.value ->> 'output_per_million')::numeric < 0 then
          raise exception 'ai_pricing model % needs non-negative input_per_million and output_per_million', v_model.key
            using errcode = '22023';
        end if;
      end loop;
    else
      null; -- unknown keys are allowed but unvalidated
  end case;

  new.updated_at := now();
  new.updated_by := private.current_actor_id();
  return new;
end;
$$;

-- Defaults. The provider/model are only filled where still unset. Local
-- development overrides the provider with AI_PROVIDER=mock (Edge Function env).
-- Opus pricing: Anthropic list price (USD 5 / 25 per million input / output
-- tokens) at an assumed 84 INR/USD. It is an estimate; admins update it
-- (with a new version) when prices or rates change.
insert into public.system_settings (key, value_json, description) values
  ('ai_enabled',                  'true',                  'Master switch for AI recommendation processing.'),
  ('ai_prompt_version',           '"recommendation-v1"',   'Prompt version used for new recommendation attempts.'),
  ('ai_max_output_tokens',        '4000',                  'Output token limit per provider request.'),
  ('ai_request_timeout_seconds',  '90',                    'Provider request timeout.'),
  ('ai_max_retries',              '1',                     'Extra provider attempts for retryable failures (timeouts, rate limits, malformed output).'),
  ('ai_stale_processing_minutes', '15',                    'A PROCESSING attempt older than this is treated as interrupted and marked FAILED.'),
  ('ai_pricing',
   '{"version": "2026-09-29", "currency": "INR", "models": {
      "claude-opus-5":      {"input_per_million": 420, "output_per_million": 2100},
      "claude-opus-4-8":    {"input_per_million": 420, "output_per_million": 2100},
      "mock-recommender-1": {"input_per_million": 100, "output_per_million": 400}}}',
   'Estimated model pricing per million tokens (versioned). Currency must match ai_budget_currency.')
on conflict (key) do nothing;

update public.system_settings set value_json = '"anthropic"' where key = 'ai_provider' and value_json = 'null';
update public.system_settings set value_json = '"claude-opus-5"' where key = 'ai_model' and value_json = 'null';

-- -----------------------------------------------------------------------------
-- Readiness and per-user monthly state (spec §5, §56, §71)
-- -----------------------------------------------------------------------------

-- One row per active user: readiness reasons and this month's processing
-- state. Precedence: PENDING, PROCESSING, SUCCESS (this month's cycle exists),
-- FAILED (latest attempt this month), SKIPPED (latest attempt this month,
-- still not ready), INCOMPLETE, READY.
create function private.recommendation_states()
returns table (
  user_id                uuid,
  name                   text,
  local_date             date,
  processing_month       date,
  missing_fields         text[],
  has_goal               boolean,
  workout_days_per_week  smallint,
  month_cycle_id         uuid,
  month_cycle_status     public.recommendation_cycle_status,
  last_cycle_start       date,
  latest_attempt_id      uuid,
  latest_attempt_status  public.processing_user_status,
  latest_attempt_at      timestamptz,
  latest_failure_reason  text,
  latest_skip_reason     text,
  open_attempt_status    public.processing_user_status,
  state                  text
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      p.id,
      p.name,
      (now() at time zone p.timezone)::date as local_date,
      date_trunc('month', (now() at time zone p.timezone)::date)::date as month,
      r.missing_fields,
      exists (select 1 from public.goals g where g.user_id = p.id and g.is_active) as has_goal,
      p.workout_days_per_week
    from public.profiles p
    join public.profile_readiness r on r.user_id = p.id
    where p.is_active
  )
  select
    b.id,
    b.name,
    b.local_date,
    b.month,
    b.missing_fields,
    b.has_goal,
    b.workout_days_per_week,
    mc.id,
    mc.status,
    lc.period_start,
    la.id,
    la.status,
    la.created_at,
    la.failure_reason,
    la.skip_reason,
    oa.status,
    case
      when oa.status is not null then oa.status::text
      when mc.id is not null then 'SUCCESS'
      when la.status = 'FAILED' then 'FAILED'
      when la.status = 'SKIPPED' and not (cardinality(b.missing_fields) = 0 and b.has_goal and b.workout_days_per_week is not null)
        then 'SKIPPED'
      when not (cardinality(b.missing_fields) = 0 and b.has_goal and b.workout_days_per_week is not null)
        then 'INCOMPLETE'
      else 'READY'
    end
  from base b
  left join lateral (
    select c.id, c.status from public.recommendation_cycles c
    where c.user_id = b.id and c.processing_month = b.month and c.status <> 'REPLACED'
    limit 1
  ) mc on true
  left join lateral (
    select c.period_start from public.recommendation_cycles c
    where c.user_id = b.id and c.status <> 'REPLACED'
    order by c.period_start desc
    limit 1
  ) lc on true
  left join lateral (
    select a.id, a.status, a.created_at, a.failure_reason, a.skip_reason
    from public.recommendation_processing_users a
    where a.user_id = b.id and a.processing_month = b.month
    order by a.created_at desc, a.attempt_number desc
    limit 1
  ) la on true
  left join lateral (
    select a.status from public.recommendation_processing_users a
    where a.user_id = b.id and a.status in ('PENDING', 'PROCESSING')
    limit 1
  ) oa on true;
$$;

revoke all on function private.recommendation_states() from public, anon, authenticated;
grant execute on function private.recommendation_states() to service_role;

-- Admin view of the processing screen (spec §42). No body metrics.
create function public.recommendation_overview()
returns table (
  user_id                uuid,
  name                   text,
  local_date             date,
  processing_month       date,
  missing_fields         text[],
  has_goal               boolean,
  workout_days_per_week  smallint,
  month_cycle_status     public.recommendation_cycle_status,
  last_cycle_start       date,
  latest_attempt_status  public.processing_user_status,
  latest_attempt_at      timestamptz,
  latest_failure_reason  text,
  latest_skip_reason     text,
  state                  text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Only admins can view recommendation processing' using errcode = '42501';
  end if;
  return query
  select s.user_id, s.name, s.local_date, s.processing_month, s.missing_fields, s.has_goal,
         s.workout_days_per_week, s.month_cycle_status, s.last_cycle_start, s.latest_attempt_status,
         s.latest_attempt_at, s.latest_failure_reason, s.latest_skip_reason, s.state
  from private.recommendation_states() s
  order by s.name nulls last, s.user_id;
end;
$$;

revoke all on function public.recommendation_overview() from public, anon;
grant execute on function public.recommendation_overview() to authenticated, service_role;

-- Budget period usage (spec §39–40): spend recorded for the month plus
-- reservations of attempts still running.
create function private.ai_month_spend(p_month date)
returns table (spent numeric, reserved numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select sum(coalesce(u.actual_cost, u.estimated_cost, 0))
      from public.ai_usage_records u
      join public.recommendation_processing_runs r on r.id = u.processing_run_id
      where r.processing_month = p_month
    ), 0),
    coalesce((
      select sum(a.reserved_cost)
      from public.recommendation_processing_users a
      join public.recommendation_processing_runs r on r.id = a.processing_run_id
      where r.processing_month = p_month and a.status = 'PROCESSING'
    ), 0);
$$;

revoke all on function private.ai_month_spend(date) from public, anon, authenticated;
grant execute on function private.ai_month_spend(date) to service_role;

create function public.ai_usage_summary(p_month date)
returns table (
  processing_month date,
  budget           numeric,
  currency         text,
  estimated_spend  numeric,
  actual_spend     numeric,
  reserved         numeric,
  remaining        numeric,
  requests         bigint,
  input_tokens     bigint,
  output_tokens    bigint,
  total_tokens     bigint,
  users_processed  bigint,
  models           text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_budget numeric;
  v_spend record;
begin
  if not private.is_admin() then
    raise exception 'Only admins can view AI usage' using errcode = '42501';
  end if;
  select case when jsonb_typeof(value_json) = 'number' then (value_json::text)::numeric end
    into v_budget from public.system_settings where key = 'ai_monthly_budget';
  select * into v_spend from private.ai_month_spend(v_month);

  return query
  select
    v_month,
    v_budget,
    coalesce((select value_json #>> '{}' from public.system_settings where key = 'ai_budget_currency'), 'INR'),
    coalesce(sum(u.estimated_cost), 0),
    sum(u.actual_cost),
    v_spend.reserved,
    case when v_budget is null then null else greatest(v_budget - v_spend.spent - v_spend.reserved, 0) end,
    count(u.id),
    coalesce(sum(u.input_tokens), 0)::bigint,
    coalesce(sum(u.output_tokens), 0)::bigint,
    coalesce(sum(u.total_tokens), 0)::bigint,
    (select count(distinct a.user_id)
     from public.recommendation_processing_users a
     join public.recommendation_processing_runs r2 on r2.id = a.processing_run_id
     where r2.processing_month = v_month and a.status = 'SUCCESS'),
    coalesce(array_agg(distinct u.model) filter (where u.model is not null), '{}')
  from public.ai_usage_records u
  join public.recommendation_processing_runs r on r.id = u.processing_run_id
  where r.processing_month = v_month;
end;
$$;

revoke all on function public.ai_usage_summary(date) from public, anon;
grant execute on function public.ai_usage_summary(date) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Monthly feedback (spec §31): open from the 1st of the month until that
-- month's recommendation is generated. It is also closed while the user's
-- generation is running, so what the AI receives is exactly what gets locked.
-- -----------------------------------------------------------------------------
create or replace function private.feedback_window_open(p_user_id uuid, p_month date)
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
    )
    and not exists (
      select 1 from public.recommendation_processing_users a
      where a.user_id = p_user_id and a.status = 'PROCESSING'
    );
$$;

-- Serialises a user's feedback writes with the processing claim (same
-- advisory lock), then re-checks the window with fresh data. Applies to the
-- user's own writes; trusted server code (no end-user JWT) is not restricted.
create function private.guard_feedback_write()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('recommendation_feedback:' || new.user_id::text, 0));
  if new.user_id <> auth.uid()
     or new.locked_at is not null or new.recommendation_cycle_id is not null
     or (tg_op = 'UPDATE' and (old.locked_at is not null or old.feedback_month <> new.feedback_month))
     or not private.feedback_window_open(new.user_id, new.feedback_month) then
    raise exception 'The feedback window for this month has closed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger recommendation_feedback_guard
before insert or update on public.recommendation_feedback
for each row execute function private.guard_feedback_write();

-- -----------------------------------------------------------------------------
-- Processing (service role only). The Edge Function authorises the admin and
-- builds the input; these functions make every state change atomic.
-- -----------------------------------------------------------------------------

-- Server-side daily totals for one user: the same aggregation as
-- public.daily_nutrition() (logged meal-item snapshots, deleted rows
-- excluded, unlogged days absent).
create function public.recommendation_daily_nutrition(p_user_id uuid, p_start date, p_end date)
returns table (
  nutrition_date date,
  calories       numeric,
  protein_g      numeric,
  carbs_g        numeric,
  fat_g          numeric,
  fiber_g        numeric,
  item_count     integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.meal_date,
    sum(mi.snapshot_calories),
    sum(mi.snapshot_protein_g),
    sum(mi.snapshot_carbs_g),
    sum(mi.snapshot_fat_g),
    sum(mi.snapshot_fiber_g),
    count(*)::integer
  from public.meals m
  join public.meal_items mi on mi.meal_id = m.id
  where m.user_id = p_user_id
    and m.meal_date between p_start and p_end
    and p_end - p_start <= 400
    and not m.is_deleted
    and not mi.is_deleted
  group by m.meal_date
  order by m.meal_date;
$$;

-- Marks attempts stuck in PROCESSING (a crashed function) as FAILED so an
-- admin can retry them. Never retries automatically.
create function public.recover_stale_recommendation_attempts(p_stale_minutes integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.recommendation_processing_users
  set status = 'FAILED',
      failure_reason = 'Processing interrupted',
      reserved_cost = null
  where status = 'PROCESSING'
    and started_at < now() - make_interval(mins => greatest(p_stale_minutes, 1));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Creates a run and its attempts (spec §41–42). Only READY users (or, for
-- PROCESS, FAILED users) are queued as PENDING. Other selected users get a
-- SKIPPED attempt with the reason; users already queued are left alone.
create function public.enqueue_recommendation_run(
  p_mode           text,
  p_user_ids       uuid[],
  p_all_ready      boolean,
  p_created_by     uuid,
  p_provider       text,
  p_model          text,
  p_prompt_version text,
  p_batch_size     integer,
  p_budget_limit   numeric,
  p_currency       text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_state record;
  v_month date;
  v_queued integer := 0;
  v_skipped integer := 0;
  v_ignored integer := 0;
  v_reason text;
  v_allowed boolean;
begin
  if p_mode not in ('PROCESS', 'RETRY', 'REPROCESS') then
    raise exception 'Unknown processing mode' using errcode = '22023';
  end if;
  if coalesce(p_all_ready, false) = (p_user_ids is not null) then
    raise exception 'Give either user ids or process_all_ready' using errcode = '22023';
  end if;
  if p_all_ready and p_mode <> 'PROCESS' then
    raise exception 'process_all_ready only queues ready users' using errcode = '22023';
  end if;
  if p_user_ids is not null and cardinality(p_user_ids) not between 1 and 500 then
    raise exception 'Select between 1 and 500 users' using errcode = '22023';
  end if;
  if p_batch_size is null or p_batch_size not between 1 and 100 then
    raise exception 'Invalid batch size' using errcode = '22023';
  end if;

  perform set_config('app.actor_id', coalesce(p_created_by::text, ''), true);
  -- Serialise queueing so two admins cannot enqueue the same user twice.
  perform pg_advisory_xact_lock(hashtextextended('recommendation_enqueue', 0));

  v_month := date_trunc('month', coalesce(private.user_local_date(p_created_by), current_date))::date;
  insert into public.recommendation_processing_runs (
    processing_month, status, provider, model, prompt_version, batch_size, budget_limit, currency,
    started_at, created_by, mode
  ) values (
    v_month, 'RUNNING', p_provider, p_model, p_prompt_version, p_batch_size, p_budget_limit,
    coalesce(p_currency, 'INR'), now(), p_created_by, p_mode
  ) returning id into v_run_id;

  for v_state in
    select s.* from private.recommendation_states() s
    where (p_all_ready and s.state = 'READY')
       or (p_user_ids is not null and s.user_id = any (p_user_ids))
    order by s.name nulls last, s.user_id
  loop
    if v_state.open_attempt_status is not null then
      v_ignored := v_ignored + 1; -- already queued or running
      continue;
    end if;

    v_allowed := case p_mode
      when 'PROCESS' then v_state.state in ('READY', 'FAILED')
      when 'RETRY' then v_state.state = 'FAILED'
      else v_state.state = 'SUCCESS'
        and cardinality(v_state.missing_fields) = 0 and v_state.has_goal
        and v_state.workout_days_per_week is not null
    end;

    if v_allowed then
      insert into public.recommendation_processing_users (
        processing_run_id, user_id, attempt_number, batch_number, status, processing_month, currency
      ) values (
        v_run_id, v_state.user_id,
        1 + (select count(*) from public.recommendation_processing_users a
             where a.user_id = v_state.user_id and a.processing_month = v_state.processing_month),
        v_queued / p_batch_size + 1, 'PENDING', v_state.processing_month, coalesce(p_currency, 'INR')
      );
      v_queued := v_queued + 1;
    else
      v_reason := case
        when cardinality(v_state.missing_fields) > 0 then 'Profile incomplete'
        when not v_state.has_goal then 'No goals configured'
        when v_state.workout_days_per_week is null then 'No workout capacity configured'
        when v_state.state = 'SUCCESS' then 'Already has a recommendation this month'
        when p_mode = 'RETRY' then 'Nothing to retry: the last attempt did not fail'
        when p_mode = 'REPROCESS' then 'Nothing to reprocess: no recommendation this month'
        else 'Not ready for processing'
      end;
      insert into public.recommendation_processing_users (
        processing_run_id, user_id, attempt_number, status, skip_reason, processing_month, currency
      ) values (
        v_run_id, v_state.user_id,
        1 + (select count(*) from public.recommendation_processing_users a
             where a.user_id = v_state.user_id and a.processing_month = v_state.processing_month),
        'SKIPPED', v_reason, v_state.processing_month, coalesce(p_currency, 'INR')
      );
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  if p_user_ids is not null then
    v_ignored := v_ignored + cardinality(p_user_ids) - v_queued - v_skipped - v_ignored;
  end if;
  if v_queued = 0 then
    update public.recommendation_processing_runs
    set status = 'COMPLETED', completed_at = now() where id = v_run_id;
  end if;

  return jsonb_build_object('run_id', v_run_id, 'queued', v_queued, 'skipped', v_skipped, 'ignored', v_ignored);
end;
$$;

-- Claims one PENDING attempt (spec §39, §67). Under a global budget lock it
-- checks: month spend + running reservations + this estimate ≤ budget. If
-- within, the attempt becomes PROCESSING and holds the reservation. The
-- user's feedback is read under the feedback lock and frozen into the
-- stored input.
create function public.claim_recommendation_attempt(
  p_attempt_id           uuid,
  p_input                jsonb,
  p_estimated_cost       numeric,
  p_provider             text,
  p_model                text,
  p_prompt_version       text,
  p_pricing_version      text,
  p_input_schema_version text,
  p_goal_id              uuid,
  p_capacity             smallint
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_attempt public.recommendation_processing_users%rowtype;
  v_run public.recommendation_processing_runs%rowtype;
  v_budget jsonb;
  v_spend record;
  v_feedback text;
  v_input jsonb;
begin
  if p_estimated_cost is null or p_estimated_cost < 0 then
    raise exception 'A non-negative cost estimate is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_budget', 0));

  select * into v_attempt from public.recommendation_processing_users where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'PENDING' then
    return jsonb_build_object('result', 'NOT_PENDING');
  end if;
  select * into v_run from public.recommendation_processing_runs where id = v_attempt.processing_run_id;
  perform set_config('app.actor_id', coalesce(v_run.created_by::text, ''), true);

  select value_json into v_budget from public.system_settings where key = 'ai_monthly_budget';
  if v_budget is null or jsonb_typeof(v_budget) <> 'number' then
    return jsonb_build_object('result', 'BUDGET_NOT_CONFIGURED');
  end if;
  select * into v_spend from private.ai_month_spend(v_run.processing_month);
  if v_spend.spent + v_spend.reserved + p_estimated_cost > (v_budget::text)::numeric then
    return jsonb_build_object('result', 'BUDGET_EXCEEDED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('recommendation_feedback:' || v_attempt.user_id::text, 0));
  select f.feedback into v_feedback from public.recommendation_feedback f
  where f.user_id = v_attempt.user_id and f.feedback_month = v_attempt.processing_month;
  v_input := jsonb_set(p_input, '{feedback}', coalesce(to_jsonb(v_feedback), 'null'::jsonb), true);

  update public.recommendation_processing_users
  set status = 'PROCESSING',
      started_at = now(),
      reserved_cost = p_estimated_cost,
      raw_input_json = v_input,
      input_schema_version = p_input_schema_version,
      provider = p_provider,
      model = p_model,
      prompt_version = p_prompt_version,
      pricing_version = p_pricing_version,
      goal_id = p_goal_id,
      workout_days_per_week = p_capacity
  where id = p_attempt_id;

  return jsonb_build_object('result', 'CLAIMED', 'input', v_input);
end;
$$;

-- A PENDING attempt that turned out not to be processable.
create function public.skip_recommendation_attempt(p_attempt_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.recommendation_processing_users
  set status = 'SKIPPED', skip_reason = coalesce(nullif(btrim(p_reason), ''), 'Not ready for processing')
  where id = p_attempt_id and status = 'PENDING';
end;
$$;

-- One row per provider request (spec §40), including failed requests.
create function private.insert_ai_usage(p_attempt public.recommendation_processing_users, p_usage jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  if p_usage is null or jsonb_typeof(p_usage) <> 'array' then
    return;
  end if;
  for v_item in select value from jsonb_array_elements(p_usage) loop
    insert into public.ai_usage_records (
      processing_run_id, processing_user_id, batch_number, provider, model, prompt_version,
      input_tokens, output_tokens, estimated_cost, actual_cost, currency, succeeded, error_message,
      pricing_version
    ) values (
      p_attempt.processing_run_id, p_attempt.id, p_attempt.batch_number,
      coalesce(v_item ->> 'provider', p_attempt.provider, 'unknown'),
      coalesce(v_item ->> 'model', p_attempt.model, 'unknown'),
      p_attempt.prompt_version,
      coalesce((v_item ->> 'input_tokens')::integer, 0),
      coalesce((v_item ->> 'output_tokens')::integer, 0),
      (v_item ->> 'estimated_cost')::numeric,
      (v_item ->> 'actual_cost')::numeric,
      p_attempt.currency,
      coalesce((v_item ->> 'succeeded')::boolean, false),
      left(v_item ->> 'error_message', 200),
      p_attempt.pricing_version
    );
  end loop;
end;
$$;

revoke all on function private.insert_ai_usage(public.recommendation_processing_users, jsonb) from public, anon, authenticated;
grant execute on function private.insert_ai_usage(public.recommendation_processing_users, jsonb) to service_role;

-- Totals of the attempt's provider requests.
create function private.usage_totals(p_usage jsonb)
returns table (input_tokens integer, output_tokens integer, estimated_cost numeric, actual_cost numeric)
language sql
immutable
set search_path = ''
as $$
  select
    coalesce(sum((u ->> 'input_tokens')::integer), 0)::integer,
    coalesce(sum((u ->> 'output_tokens')::integer), 0)::integer,
    coalesce(sum((u ->> 'estimated_cost')::numeric), 0),
    sum((u ->> 'actual_cost')::numeric)
  from jsonb_array_elements(case when jsonb_typeof(p_usage) = 'array' then p_usage else '[]'::jsonb end) u;
$$;

-- Records a failed generation. The raw provider output is preserved (spec §71).
-- No recommendation is created, so the previous one stays in force (spec §72).
create function public.fail_recommendation_attempt(
  p_attempt_id     uuid,
  p_failure_reason text,
  p_raw_output     jsonb,
  p_usage          jsonb
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_attempt public.recommendation_processing_users%rowtype;
  v_totals record;
begin
  select * into v_attempt from public.recommendation_processing_users where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'PROCESSING' then
    raise exception 'Attempt is not processing' using errcode = '55000';
  end if;
  select * into v_totals from private.usage_totals(p_usage);

  update public.recommendation_processing_users
  set status = 'FAILED',
      failure_reason = left(coalesce(nullif(btrim(p_failure_reason), ''), 'Generation failed'), 200),
      raw_output_json = p_raw_output,
      input_tokens = v_totals.input_tokens,
      output_tokens = v_totals.output_tokens,
      estimated_cost = v_totals.estimated_cost,
      actual_cost = v_totals.actual_cost,
      reserved_cost = null
  where id = p_attempt_id;

  perform private.insert_ai_usage(v_attempt, p_usage);
end;
$$;

-- Stores a validated recommendation atomically (spec §43, §50, §53, §71–72):
--   * a new IN_REVIEW cycle from the user's local processing date, with the
--     goal version and capacity the input was built from, final = AI values;
--   * the previous open cycle ends the day before (and is locked if it was
--     still marked IN_REVIEW);
--   * REPROCESS only: this month's cycle becomes REPLACED (kept, never deleted);
--   * target snapshots from the new start date are (re)written with the new
--     targets; earlier snapshots are never touched;
--   * this month's feedback is locked and linked to the new cycle.
create function public.complete_recommendation_attempt(
  p_attempt_id uuid,
  p_raw_output jsonb,
  p_parsed     jsonb,
  p_usage      jsonb
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Snapshots are written for this many days from the new start; the next
  -- cycle overwrites its own dates, so a normal monthly cadence is covered.
  c_snapshot_days constant integer := 62;
  v_attempt public.recommendation_processing_users%rowtype;
  v_run public.recommendation_processing_runs%rowtype;
  v_today date;
  v_month date;
  v_month_cycle public.recommendation_cycles%rowtype;
  v_previous public.recommendation_cycles%rowtype;
  v_cycle_id uuid;
  v_totals record;
  v_targets jsonb := p_parsed -> 'targets';
  v_calories integer;
  v_protein numeric;
  v_carbs numeric;
  v_fat numeric;
  v_fiber numeric;
  v_sessions jsonb := p_parsed #> '{workout_plan,sessions}';
  v_tolerance numeric;
  v_lower numeric;
  v_upper numeric;
begin
  select * into v_attempt from public.recommendation_processing_users where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'PROCESSING' then
    raise exception 'Attempt is not processing' using errcode = '55000';
  end if;
  select * into v_run from public.recommendation_processing_runs where id = v_attempt.processing_run_id;
  perform set_config('app.actor_id', coalesce(v_run.created_by::text, ''), true);

  -- Defence in depth: the Edge Function already validated all of this.
  v_calories := (v_targets ->> 'calories')::integer;
  v_protein := (v_targets ->> 'protein_g')::numeric;
  v_carbs := (v_targets ->> 'carbs_g')::numeric;
  v_fat := (v_targets ->> 'fat_g')::numeric;
  v_fiber := (v_targets ->> 'fiber_g')::numeric;
  if v_calories is null or v_calories not between 800 and 6000
     or v_protein is null or v_protein not between 0 and 500
     or v_carbs is null or v_carbs not between 0 and 1000
     or v_fat is null or v_fat not between 0 and 400
     or v_fiber is null or v_fiber not between 0 and 150 then
    raise exception 'Recommended targets are out of range' using errcode = '22023';
  end if;
  if v_attempt.workout_days_per_week is null or v_attempt.goal_id is null
     or jsonb_typeof(v_sessions) <> 'array' or jsonb_array_length(v_sessions) <> v_attempt.workout_days_per_week then
    raise exception 'The workout template must match the workout capacity' using errcode = '22023';
  end if;

  -- One writer per user.
  perform pg_advisory_xact_lock(hashtextextended('recommendation_cycles:' || v_attempt.user_id::text, 0));
  v_today := private.user_local_date(v_attempt.user_id);
  v_month := date_trunc('month', v_today)::date;

  select * into v_month_cycle from public.recommendation_cycles
  where user_id = v_attempt.user_id and processing_month = v_month and status <> 'REPLACED'
  for update;
  if found then
    if v_run.mode <> 'REPROCESS' then
      raise exception 'Already has a recommendation this month' using errcode = '23505';
    end if;
    update public.recommendation_cycles
    set status = 'REPLACED',
        period_end = case when v_today > v_month_cycle.period_start then v_today - 1 else period_end end
    where id = v_month_cycle.id;
  end if;

  select * into v_previous from public.recommendation_cycles
  where user_id = v_attempt.user_id and status <> 'REPLACED'
  order by period_start desc
  limit 1
  for update;
  if found then
    if v_previous.period_start >= v_today or (v_previous.period_end is not null and v_previous.period_end >= v_today) then
      raise exception 'A recommendation already covers today' using errcode = '23505';
    end if;
    if v_previous.period_end is null then
      update public.recommendation_cycles
      set period_end = v_today - 1,
          status = case when status = 'IN_REVIEW' then 'LOCKED'::public.recommendation_cycle_status else status end,
          locked_at = case when status = 'IN_REVIEW' then now() else locked_at end
      where id = v_previous.id;
    end if;
  end if;

  insert into public.recommendation_cycles (
    user_id, processing_month, previous_cycle_id, processing_user_id, goal_id, workout_days_per_week,
    period_start, generated_at, review_deadline, status, parsed_output_json, provider, model, prompt_version,
    recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
    final_calories, final_protein_g, final_carbs_g, final_fat_g, final_fiber_g,
    workout_plan_json, activity_recommendation_json
  ) values (
    v_attempt.user_id, v_month, v_previous.id, v_attempt.id, v_attempt.goal_id, v_attempt.workout_days_per_week,
    v_today, now(), v_today + 1, 'IN_REVIEW', p_parsed, v_attempt.provider, v_attempt.model, v_attempt.prompt_version,
    v_calories, v_protein, v_carbs, v_fat, v_fiber,
    v_calories, v_protein, v_carbs, v_fat, v_fiber,
    jsonb_build_object(
      'days_per_week', v_attempt.workout_days_per_week,
      'sessions', (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', s ->> 'name', 'type', s ->> 'type', 'focus', s ->> 'focus')) order by n)
        from jsonb_array_elements(v_sessions) with ordinality as t(s, n)
      )
    ),
    case when p_parsed ? 'activity_recommendation' and jsonb_typeof(p_parsed -> 'activity_recommendation') = 'string'
         then jsonb_build_object('text', p_parsed ->> 'activity_recommendation') end
  ) returning id into v_cycle_id;

  select (value_json::text)::numeric into v_tolerance from public.system_settings where key = 'nutrition_tolerance';
  select (value_json::text)::numeric into v_lower from public.system_settings where key = 'calorie_lower_tolerance';
  select (value_json::text)::numeric into v_upper from public.system_settings where key = 'calorie_upper_tolerance';

  insert into public.daily_target_snapshots (
    user_id, recommendation_cycle_id, target_date, calories, protein_g, carbs_g, fat_g, fiber_g,
    workouts_per_week, nutrition_tolerance, calorie_lower_tolerance, calorie_upper_tolerance
  )
  select v_attempt.user_id, v_cycle_id, d::date, v_calories, v_protein, v_carbs, v_fat, v_fiber,
         v_attempt.workout_days_per_week, coalesce(v_tolerance, 0.85), coalesce(v_lower, 0.85), coalesce(v_upper, 1.10)
  from generate_series(v_today, v_today + (c_snapshot_days - 1), interval '1 day') d
  on conflict (user_id, target_date) do update
  set recommendation_cycle_id = excluded.recommendation_cycle_id,
      calories = excluded.calories,
      protein_g = excluded.protein_g,
      carbs_g = excluded.carbs_g,
      fat_g = excluded.fat_g,
      fiber_g = excluded.fiber_g,
      workouts_per_week = excluded.workouts_per_week,
      nutrition_tolerance = excluded.nutrition_tolerance,
      calorie_lower_tolerance = excluded.calorie_lower_tolerance,
      calorie_upper_tolerance = excluded.calorie_upper_tolerance;

  update public.recommendation_feedback
  set recommendation_cycle_id = v_cycle_id, locked_at = coalesce(locked_at, now())
  where user_id = v_attempt.user_id and feedback_month = v_month;

  select * into v_totals from private.usage_totals(p_usage);
  update public.recommendation_processing_users
  set status = 'SUCCESS',
      raw_output_json = p_raw_output,
      parsed_recommendation_json = p_parsed,
      recommended_calories = v_calories,
      recommended_protein_g = v_protein,
      recommended_carbs_g = v_carbs,
      recommended_fat_g = v_fat,
      recommended_fiber_g = v_fiber,
      input_tokens = v_totals.input_tokens,
      output_tokens = v_totals.output_tokens,
      estimated_cost = v_totals.estimated_cost,
      actual_cost = v_totals.actual_cost,
      reserved_cost = null,
      generated_at = now()
  where id = p_attempt_id;

  perform private.insert_ai_usage(v_attempt, p_usage);
  return v_cycle_id;
end;
$$;

-- Run status (spec §41) from its attempts. STOPPED_BUDGET while budget-held
-- users remain PENDING; otherwise RUNNING, or terminal once none are open.
create function public.refresh_recommendation_run(p_run_id uuid, p_stopped_by_budget boolean default false)
returns public.processing_run_status
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_counts record;
  v_status public.processing_run_status;
begin
  select
    count(*) filter (where status = 'PENDING') as pending,
    count(*) filter (where status = 'PROCESSING') as processing,
    count(*) filter (where status = 'SUCCESS') as success,
    count(*) filter (where status = 'FAILED') as failed
  into v_counts
  from public.recommendation_processing_users where processing_run_id = p_run_id;

  v_status := case
    when v_counts.pending > 0 and p_stopped_by_budget then 'STOPPED_BUDGET'
    when v_counts.pending > 0 or v_counts.processing > 0 then 'RUNNING'
    when v_counts.failed > 0 and v_counts.success = 0 then 'FAILED'
    when v_counts.failed > 0 then 'PARTIAL'
    else 'COMPLETED'
  end::public.processing_run_status;

  update public.recommendation_processing_runs
  set status = v_status,
      failure_reason = case
        when v_status = 'STOPPED_BUDGET' then 'Monthly AI budget reached'
        when v_status = 'FAILED' then 'Every attempt failed'
        else null end,
      completed_at = case when v_status in ('COMPLETED', 'PARTIAL', 'FAILED') then coalesce(completed_at, now()) else null end
  where id = p_run_id;
  return v_status;
end;
$$;

-- Service-role only.
revoke all on function
  public.recommendation_daily_nutrition(uuid, date, date),
  public.recover_stale_recommendation_attempts(integer),
  public.enqueue_recommendation_run(text, uuid[], boolean, uuid, text, text, text, integer, numeric, text),
  public.claim_recommendation_attempt(uuid, jsonb, numeric, text, text, text, text, text, uuid, smallint),
  public.skip_recommendation_attempt(uuid, text),
  public.fail_recommendation_attempt(uuid, text, jsonb, jsonb),
  public.complete_recommendation_attempt(uuid, jsonb, jsonb, jsonb),
  public.refresh_recommendation_run(uuid, boolean),
  private.usage_totals(jsonb)
from public, anon, authenticated;
grant execute on function
  public.recommendation_daily_nutrition(uuid, date, date),
  public.recover_stale_recommendation_attempts(integer),
  public.enqueue_recommendation_run(text, uuid[], boolean, uuid, text, text, text, integer, numeric, text),
  public.claim_recommendation_attempt(uuid, jsonb, numeric, text, text, text, text, text, uuid, smallint),
  public.skip_recommendation_attempt(uuid, text),
  public.fail_recommendation_attempt(uuid, text, jsonb, jsonb),
  public.complete_recommendation_attempt(uuid, jsonb, jsonb, jsonb),
  public.refresh_recommendation_run(uuid, boolean),
  private.usage_totals(jsonb)
to service_role;

revoke all on function private.guard_feedback_write() from public, anon;
