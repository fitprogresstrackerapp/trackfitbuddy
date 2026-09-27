-- Schema structure, grants and constraint tests. Run with: npm run db:test
begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
select tables_are('public', array[
  'profiles', 'user_roles', 'manager_user_assignments', 'system_settings',
  'goals', 'goal_focuses',
  'recommendation_processing_runs', 'recommendation_processing_users', 'ai_usage_records',
  'recommendation_cycles', 'recommendation_feedback', 'daily_target_snapshots',
  'food_items', 'food_item_versions', 'food_submissions', 'food_merges',
  'meals', 'meal_items',
  'workouts', 'activities', 'steps_entries', 'weight_measurements',
  'inbody_reports', 'inbody_metrics',
  'groups', 'group_memberships',
  'audit_logs'
], 'all Phase 1 tables exist and no unexpected tables');

-- ---------------------------------------------------------------------------
-- Security posture
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity),
  0::bigint,
  'RLS is enabled on every public table'
);

select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public'),
  0::bigint,
  'anon has no privileges on any public table or view'
);

select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'DELETE'
     and table_name not in ('user_roles', 'manager_user_assignments', 'goal_focuses')),
  0::bigint,
  'clients cannot hard-delete records (only roles, assignments and unlocked goal focuses)'
);

select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'authenticated' and table_name = 'audit_logs' and privilege_type <> 'SELECT'),
  0::bigint,
  'authenticated can only SELECT audit_logs'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')),
  0::bigint,
  'every SECURITY DEFINER function pins its search_path'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0::bigint,
  'anon cannot execute private helper functions'
);

select ok(
  not has_function_privilege('anon', 'public.get_group_member_day(uuid, date)', 'EXECUTE'),
  'anon cannot call the group data function'
);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and not coalesce(c.reloptions @> array['security_invoker=true'], false)),
  0::bigint,
  'all public views run with security_invoker (RLS of the caller applies)'
);

-- ---------------------------------------------------------------------------
-- Indexes required by spec §84 (and related)
-- ---------------------------------------------------------------------------
select has_index('public', 'meals', 'meals_user_date_idx', array['user_id', 'meal_date'], 'meals(user_id, meal_date)');
select has_index('public', 'meal_items', 'meal_items_meal_idx', array['meal_id'], 'meal_items(meal_id)');
select has_index('public', 'workouts', 'workouts_user_date_idx', array['user_id', 'workout_date'], 'workouts(user_id, workout_date)');
select has_index('public', 'activities', 'activities_user_date_idx', array['user_id', 'activity_date'], 'activities(user_id, activity_date)');
select has_index('public', 'steps_entries', 'steps_user_date_idx', array['user_id', 'entry_date'], 'steps_entries(user_id, entry_date)');
select has_index('public', 'weight_measurements', 'weight_user_date_idx', array['user_id', 'measurement_date'], 'weight_measurements(user_id, measurement_date)');
select has_index('public', 'recommendation_cycles', 'cycles_user_generated_idx', array['user_id', 'generated_at'], 'recommendation_cycles(user_id, generated_at)');
select has_index('public', 'daily_target_snapshots', 'targets_user_date_unique', array['user_id', 'target_date'], 'daily_target_snapshots(user_id, target_date)');
select has_index('public', 'group_memberships', 'group_memberships_group_user_idx', array['group_id', 'user_id'], 'group_memberships(group_id, user_id)');
select has_index('public', 'audit_logs', 'audit_logs_target_idx', array['target_user_id', 'created_at'], 'audit_logs(target_user_id, created_at)');
select has_index('public', 'audit_logs', 'audit_logs_actor_idx', array['actor_user_id', 'created_at'], 'audit_logs(actor_user_id, created_at)');
select has_index('public', 'recommendation_processing_users', 'processing_users_run_status_idx', array['processing_run_id', 'status'], 'recommendation_processing_users(processing_run_id, status)');
select has_index('public', 'manager_user_assignments', 'manager_user_assignments_user_idx', array['user_id'], 'manager_user_assignments(user_id)');
select has_index('public', 'food_items', 'food_items_name_trgm_idx', 'food name trigram search index');

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
select enum_has_labels(
  'public', 'gender', array['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'],
  'gender supports male, female, other and prefer not to say'
);

-- ---------------------------------------------------------------------------
-- Settings defaults
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select key, value_json from public.system_settings
     where key in ('nutrition_tolerance', 'calorie_lower_tolerance', 'calorie_upper_tolerance') order by key $$,
  $$ values ('calorie_lower_tolerance', '0.85'::jsonb), ('calorie_upper_tolerance', '1.10'::jsonb),
            ('nutrition_tolerance', '0.85'::jsonb) $$,
  'Phase 1 tolerance defaults: 85% nutrients, 85–110% calories'
);

-- ---------------------------------------------------------------------------
-- Constraints (run as the migration owner, so only constraints can stop them)
-- ---------------------------------------------------------------------------
insert into auth.users (id, phone, aud, role)
values ('00000000-0000-0000-0000-0000000000a1', '919000000001', 'authenticated', 'authenticated');
insert into public.profiles (id, phone, name)
values ('00000000-0000-0000-0000-0000000000a1', '+919000000001', 'Schema Test');

select ok(
  exists (select 1 from public.user_roles where user_id = '00000000-0000-0000-0000-0000000000a1' and role = 'USER'),
  'new profiles receive the USER role automatically'
);

select throws_ok(
  $$ insert into auth.users (id, phone, aud, role) values ('00000000-0000-0000-0000-0000000000a2', '919000000009', 'authenticated', 'authenticated');
     insert into public.profiles (id, phone) values ('00000000-0000-0000-0000-0000000000a2', '+919000000001') $$,
  '23505', null, 'phone numbers are unique'
);
select lives_ok(
  $$ update public.profiles set gender = 'PREFER_NOT_TO_SAY' where id = '00000000-0000-0000-0000-0000000000a1' $$,
  'a profile can store gender as prefer not to say'
);
select throws_ok(
  $$ update public.profiles set workout_days_per_week = 7 where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'workout capacity must be 2–6'
);
select throws_ok(
  $$ update public.profiles set workout_days_per_week = 1 where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'workout capacity lower bound'
);
select throws_ok(
  $$ update public.profiles set timezone = 'Mars/Olympus_Mons' where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '22023', null, 'timezone must be a valid IANA zone'
);
select throws_ok(
  $$ update public.system_settings set value_json = '0.75' where key = 'nutrition_tolerance' $$,
  '22023', null, 'nutrition tolerance limited to 80/85/90%'
);
select throws_ok(
  $$ insert into public.food_items (name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g)
     values ('Bad', 100, 'g', -1, 0, 0, 0, 0) $$,
  '23514', null, 'nutrition values cannot be negative'
);
select throws_ok(
  $$ insert into public.workouts (user_id, workout_date, workout_type, duration_minutes, estimated_calories)
     values ('00000000-0000-0000-0000-0000000000a1', current_date, 'YOGA', 30, 100) $$,
  '23514', null, 'workout type must be one of the spec categories'
);
select throws_ok(
  $$ insert into public.workouts (user_id, workout_date, workout_type, duration_minutes, estimated_calories)
     values ('00000000-0000-0000-0000-0000000000a1', current_date, 'CUSTOM', 30, 100) $$,
  '23514', null, 'CUSTOM workouts require a name'
);
select throws_ok(
  $$ insert into public.workouts (user_id, workout_date, workout_type, duration_minutes, estimated_calories)
     values ('00000000-0000-0000-0000-0000000000a1', current_date, 'LEGS', 0, 100) $$,
  '23514', null, 'duration must be positive'
);
select throws_ok(
  $$ insert into public.inbody_metrics (report_id, user_id, body_fat_percent) values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', 120) $$,
  '23514', null, 'body fat percentage must be 0–100'
);

-- Workouts: effective calories
insert into public.workouts (id, user_id, workout_date, workout_type, duration_minutes, estimated_calories, manual_calories)
values ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0000-0000000000a1', current_date, 'LEGS', 45, 300, 420);
select is(
  (select final_calories from public.workouts where id = '00000000-0000-0000-0003-000000000001'),
  420.0::numeric,
  'manual calories override the estimate'
);

-- Recommendation cycle fixtures
insert into public.recommendation_processing_runs (id, processing_month) values ('00000000-0000-0000-0006-000000000001', '2026-09-01');
insert into public.recommendation_processing_users (
  id, processing_run_id, user_id, attempt_number, status, parsed_recommendation_json, generated_at,
  recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
  provider, model, prompt_version
) values
  ('00000000-0000-0000-0007-000000000001', '00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0000-0000000000a1', 1,
   'SUCCESS', '{}', now(), 2000, 140, 250, 65, 30, 'test', 'test-model', 'v1'),
  ('00000000-0000-0000-0007-000000000002', '00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0000-0000000000a1', 2,
   'SUCCESS', '{}', now(), 2000, 140, 250, 65, 30, 'test', 'test-model', 'v1');

select throws_ok(
  $$ insert into public.recommendation_processing_users (processing_run_id, user_id, status)
     values ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0000-0000000000a1', 'FAILED') $$,
  '23514', null, 'a FAILED processing attempt requires a failure reason'
);

insert into public.recommendation_cycles (
  id, user_id, processing_month, processing_user_id, workout_days_per_week, period_start, period_end,
  generated_at, review_deadline, parsed_output_json, provider, model, prompt_version,
  recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
  final_calories, final_protein_g, final_carbs_g, final_fat_g, final_fiber_g, workout_plan_json
) values (
  '00000000-0000-0000-0008-000000000001', '00000000-0000-0000-0000-0000000000a1', '2026-09-01',
  '00000000-0000-0000-0007-000000000001', 4, '2026-09-04', '2026-10-04', '2026-09-04T05:00:00Z', '2026-09-05',
  '{}', 'test', 'test-model', 'v1', 2000, 140, 250, 65, 30, 2000, 140, 250, 65, 30, '{}'
);

select throws_ok(
  $$ insert into public.recommendation_cycles (
       user_id, processing_month, processing_user_id, workout_days_per_week, period_start,
       generated_at, review_deadline, parsed_output_json, provider, model, prompt_version,
       recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
       final_calories, final_protein_g, final_carbs_g, final_fat_g, final_fiber_g, workout_plan_json
     ) values (
       '00000000-0000-0000-0000-0000000000a1', '2026-10-01', '00000000-0000-0000-0007-000000000002', 4, '2026-10-01',
       now(), '2026-10-02', '{}', 'test', 'test-model', 'v1', 2000, 140, 250, 65, 30, 2000, 140, 250, 65, 30, '{}'
     ) $$,
  '23P01', null, 'recommendation cycles of a user cannot overlap'
);
select throws_ok(
  $$ update public.recommendation_cycles set review_deadline = '2026-09-07' where id = '00000000-0000-0000-0008-000000000001' $$,
  '23514', null, 'review window is exactly two calendar days from generation'
);
select throws_ok(
  $$ update public.recommendation_cycles set recommended_calories = 1800 where id = '00000000-0000-0000-0008-000000000001' $$,
  '42501', null, 'AI recommended values are never overwritten'
);
select lives_ok(
  $$ update public.recommendation_cycles set final_calories = 1900 where id = '00000000-0000-0000-0008-000000000001' $$,
  'final (active) values can be changed'
);
select ok(
  exists (select 1 from public.audit_logs where entity_type = 'recommendation_cycles'
          and old_values_json = '{"final_calories": 2000}' and new_values_json = '{"final_calories": 1900}'),
  'target edits are audited with old and new value'
);

insert into public.daily_target_snapshots (
  user_id, recommendation_cycle_id, target_date, calories, protein_g, carbs_g, fat_g, fiber_g,
  workouts_per_week, nutrition_tolerance, calorie_lower_tolerance, calorie_upper_tolerance
) values (
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0008-000000000001', '2026-09-10',
  2000, 140, 250, 65, 30, 4, 0.85, 0.85, 1.10
);
select throws_ok(
  $$ insert into public.daily_target_snapshots (
       user_id, recommendation_cycle_id, target_date, calories, protein_g, carbs_g, fat_g, fiber_g,
       workouts_per_week, nutrition_tolerance, calorie_lower_tolerance, calorie_upper_tolerance
     ) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0008-000000000001', '2026-09-10',
               2100, 140, 250, 65, 30, 4, 0.85, 0.85, 1.10) $$,
  '23505', null, 'only one target snapshot per user and date'
);

-- Meal item must reference exactly one food source
insert into public.food_items (id, name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g)
values ('00000000-0000-0000-0004-000000000001', 'Schema Food', 100, 'g', 100, 10, 10, 1, 1);
insert into public.meals (id, user_id, meal_date) values ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-0000000000a1', current_date);
select throws_ok(
  $$ insert into public.meal_items (meal_id, user_id, quantity) values ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-0000000000a1', 100) $$,
  '23514', null, 'meal item requires a food source'
);
select throws_ok(
  $$ insert into public.meal_items (meal_id, user_id, food_item_id, quantity)
     values ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0004-000000000001', 100) $$,
  '23503', null, 'meal item owner must match the meal owner'
);

-- Food master versioning
update public.food_items set calories = 110 where id = '00000000-0000-0000-0004-000000000001';
select results_eq(
  $$ select version, calories from public.food_item_versions
     where food_item_id = '00000000-0000-0000-0004-000000000001' order by version $$,
  $$ values (1, 100.00::numeric), (2, 110.00::numeric) $$,
  'food master changes are versioned'
);

-- Audit log is append-only even for the database owner
select throws_ok(
  $$ update public.audit_logs set reason = 'tampered' $$,
  '42501', 'audit_logs is append-only', 'audit_logs rows cannot be updated'
);
select throws_ok(
  $$ delete from public.audit_logs $$,
  '42501', 'audit_logs is append-only', 'audit_logs rows cannot be deleted'
);

select * from finish();
rollback;
