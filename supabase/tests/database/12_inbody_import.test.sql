-- InBody CSV import: who may store results, report association, value ranges,
-- one result per report, completion status, weight sync and audit.
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

create schema tests;
create function tests.login(p_id uuid) returns void language sql
as $$ select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
create function tests.as_service() returns void language sql
as $$ select set_config('request.jwt.claims', '{"role": "service_role"}', true) $$;
create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
create function tests.affected(p_sql text) returns integer language plpgsql
as $$ declare n integer; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
-- A stored CSV in a user's folder, as the Edge Function uploads it.
create function tests.csv(p_user uuid, p_date date, p_n integer) returns text language plpgsql
as $$
declare v_path text := p_user::text || '/' || p_date::text || '-00000000-0000-0000-0000-' || lpad(p_n::text, 12, '0') || '.csv';
begin
  insert into storage.objects (bucket_id, name) values ('inbody-reports', v_path) on conflict do nothing;
  return v_path;
end $$;
grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;

insert into auth.users (id, phone, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', '919500000001', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', '919500000002', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c3', '919500000003', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d4', '919500000004', 'authenticated', 'authenticated');
insert into public.profiles (id, phone, name, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', '+919500000001', 'Alice', true),
  ('00000000-0000-0000-0000-0000000000b2', '+919500000002', 'Bob', true),
  ('00000000-0000-0000-0000-0000000000c3', '+919500000003', 'Manager', true),
  ('00000000-0000-0000-0000-0000000000d4', '+919500000004', 'Inactive', true);
update public.profiles set is_active = false, deleted_at = now() where id = '00000000-0000-0000-0000-0000000000d4';
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000c3', 'MANAGER');
insert into public.manager_user_assignments (manager_id, user_id)
values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a1');

-- Alice: an uploaded report 5 days ago, one 9 days ago, and one with results.
insert into public.inbody_reports (id, user_id, report_date, file_path, file_type) values
  ('00000000-0000-0000-0005-000000000001', '00000000-0000-0000-0000-0000000000a1', tests.today() - 5, '00000000-0000-0000-0000-0000000000a1/a.pdf', 'application/pdf'),
  ('00000000-0000-0000-0005-000000000002', '00000000-0000-0000-0000-0000000000a1', tests.today() - 9, '00000000-0000-0000-0000-0000000000a1/b.pdf', 'application/pdf'),
  ('00000000-0000-0000-0005-000000000003', '00000000-0000-0000-0000-0000000000a1', tests.today() - 20, '00000000-0000-0000-0000-0000000000a1/c.pdf', 'application/pdf'),
  ('00000000-0000-0000-0005-000000000004', '00000000-0000-0000-0000-0000000000b2', tests.today() - 5, '00000000-0000-0000-0000-0000000000b2/a.pdf', 'application/pdf');
insert into public.inbody_metrics (report_id, user_id, weight_kg, body_fat_percent)
values ('00000000-0000-0000-0005-000000000003', '00000000-0000-0000-0000-0000000000a1', 80, 22);

-- ---------------------------------------------------------------------------
-- Only trusted server code may store results.
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated',
  'public.import_inbody_metrics(uuid, date, jsonb, uuid, text, numeric, numeric, numeric, numeric, integer)', 'execute'),
  'a signed-in user cannot call the import function');
select ok(not has_function_privilege('anon',
  'public.import_inbody_metrics(uuid, date, jsonb, uuid, text, numeric, numeric, numeric, numeric, integer)', 'execute'),
  'an anonymous caller cannot call the import function');

set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 5, '{}',
       '00000000-0000-0000-0005-000000000001', null, 81.5) $$,
  '42501', null, 'the function is refused to a user even for their own report');
select throws_ok(
  $$ insert into public.inbody_metrics (report_id, user_id, weight_kg)
     values ('00000000-0000-0000-0005-000000000001', '00000000-0000-0000-0000-0000000000a1', 81.5) $$,
  '42501', null, 'a user still cannot insert metrics directly');
select is(
  tests.affected($$ update public.inbody_reports set extraction_status = 'COMPLETED' where id = '00000000-0000-0000-0005-000000000001' $$),
  0, 'a user still cannot mark a report completed');
select tests.login('00000000-0000-0000-0000-0000000000c3');
select throws_ok(
  $$ insert into public.inbody_metrics (report_id, user_id, weight_kg)
     values ('00000000-0000-0000-0005-000000000001', '00000000-0000-0000-0000-0000000000a1', 81.5) $$,
  '42501', null, 'a manager cannot create results for an assigned user');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 5, '{}',
       '00000000-0000-0000-0005-000000000001', null, 81.5) $$,
  '42501', null, 'a manager cannot call the import function');
reset role;

-- ---------------------------------------------------------------------------
-- Validation (as the Edge Function: service role, verified user id).
-- ---------------------------------------------------------------------------
set local role service_role;
select tests.as_service();

select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000d4', tests.today(), '{}', null, null, 81.5) $$,
  '42501', null, 'an inactive account cannot import');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() + 1, '{}',
       '00000000-0000-0000-0005-000000000001', null, 81.5) $$,
  '22023', null, 'a future measurement date is refused');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', null, '{}',
       '00000000-0000-0000-0005-000000000001', null, 81.5) $$,
  '22023', null, 'a missing measurement date is refused');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 5, '{}',
       '00000000-0000-0000-0005-000000000001') $$,
  '22023', null, 'a measurement without results is refused');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 5, '{}',
       '00000000-0000-0000-0005-000000000001', null, 401) $$,
  '22023', null, 'a weight outside the range is refused');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 5, '{}',
       '00000000-0000-0000-0005-000000000001', null, 81.5, 100.5) $$,
  '22023', null, 'a body fat percentage outside the range is refused');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 5, '{}',
       '00000000-0000-0000-0005-000000000001', null, 81.5, 21, 201) $$,
  '22023', null, 'a muscle mass outside the range is refused');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 5, '{}',
       '00000000-0000-0000-0005-000000000001', null, 81.5, 21, 36.4, 4) $$,
  '22023', null, 'a BMI outside the range is refused');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 5, '{}',
       '00000000-0000-0000-0005-000000000001', null, 81.5, 21, 36.4, 25.2, 5001) $$,
  '22023', null, 'a BMR outside the range is refused');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 5, '[1]',
       '00000000-0000-0000-0005-000000000001', null, 81.5) $$,
  '22023', null, 'additional metrics must be an object');

-- ---------------------------------------------------------------------------
-- Ownership and association.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 5, '{}',
       '00000000-0000-0000-0005-000000000004', null, 81.5) $$,
  'IB001', null, 'another user''s report is not found');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 5, '{}',
       gen_random_uuid(), null, 81.5) $$,
  'IB001', null, 'an unknown report is not found');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 20, '{}',
       '00000000-0000-0000-0005-000000000003', null, 81.5) $$,
  'IB002', null, 'a report that already has results is never overwritten');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 2, '{}',
       '00000000-0000-0000-0005-000000000001', null, 81.5) $$,
  'IB003', null, 'a measurement of another date does not match the report');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 5, '{}',
       null, tests.csv('00000000-0000-0000-0000-0000000000a1', tests.today() - 5, 1), 81.5) $$,
  'IB004', null, 'no second record while a report for that date awaits results');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 20, '{}',
       null, tests.csv('00000000-0000-0000-0000-0000000000a1', tests.today() - 20, 2), 81.5) $$,
  'IB005', null, 'no second result for a date that already has one');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 3, '{}',
       null, '00000000-0000-0000-0000-0000000000b2/' || (tests.today() - 3)::text || '-00000000-0000-0000-0000-000000000009.csv', 81.5) $$,
  '22023', null, 'a new record cannot point into another user''s folder');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 3, '{}',
       null, '00000000-0000-0000-0000-0000000000a1/' || (tests.today() - 3)::text || '-00000000-0000-0000-0000-000000000008.csv', 81.5) $$,
  '22023', null, 'a new record needs its stored CSV');
select is((select count(*) from public.inbody_metrics where user_id = '00000000-0000-0000-0000-0000000000a1'), 1::bigint,
  'no refused import stored anything');

-- ---------------------------------------------------------------------------
-- Attaching to an uploaded report.
-- ---------------------------------------------------------------------------
select is(
  public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 5,
    '{"source": "inbody_csv", "metrics": {"protein_kg": {"label": "Protein", "value": 12.8, "unit": "kg"}}}',
    '00000000-0000-0000-0005-000000000001', null, 81.5, 21, 36.4, 25.2, 1761) ->> 'created_report',
  'false', 'results are attached to the user''s own report');
select results_eq(
  $$ select weight_kg, body_fat_percent, muscle_mass_kg, bmi, bmr_kcal, other_metrics_json -> 'metrics' -> 'protein_kg' ->> 'unit'
     from public.inbody_metrics where report_id = '00000000-0000-0000-0005-000000000001' $$,
  $$ values (81.50::numeric, 21.0::numeric, 36.40::numeric, 25.2::numeric, 1761, 'kg') $$,
  'the values are stored in the existing metrics model');
select is((select extraction_status::text from public.inbody_reports where id = '00000000-0000-0000-0005-000000000001'),
  'COMPLETED', 'the report is marked completed');
select results_eq(
  $$ select weight_kg, measurement_date, source::text from public.weight_measurements
     where inbody_report_id = '00000000-0000-0000-0005-000000000001' and not is_deleted $$,
  $$ values (81.50::numeric, tests.today() - 5, 'INBODY') $$,
  'the weight is added to the weight history');
select throws_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 5, '{}',
       '00000000-0000-0000-0005-000000000001', null, 90) $$,
  'IB002', null, 'a repeated submission is refused and changes nothing');
select is((select weight_kg from public.inbody_metrics where report_id = '00000000-0000-0000-0005-000000000001'),
  81.50::numeric, 'the first result is kept');

-- A report dated one day off takes the measurement's date.
select lives_ok(
  $$ select public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 8, '{}',
       '00000000-0000-0000-0005-000000000002', null, null, 20.5) $$,
  'a report dated one day off the measurement is accepted');
select results_eq(
  $$ select r.report_date, m.weight_kg, (select count(*) from public.weight_measurements w where w.inbody_report_id = r.id)
     from public.inbody_reports r join public.inbody_metrics m on m.report_id = r.id
     where r.id = '00000000-0000-0000-0005-000000000002' $$,
  $$ values (tests.today() - 8, null::numeric, 0::bigint) $$,
  'the report takes the measurement date; a missing weight stays null and adds no weight');

-- ---------------------------------------------------------------------------
-- A CSV without an uploaded report becomes its own record.
-- ---------------------------------------------------------------------------
select is(
  public.import_inbody_metrics('00000000-0000-0000-0000-0000000000a1', tests.today() - 2, '{}',
    null, tests.csv('00000000-0000-0000-0000-0000000000a1', tests.today() - 2, 3), 80.9, 20.4) ->> 'created_report',
  'true', 'a CSV without a matching report becomes a new record');
select results_eq(
  $$ select r.file_type, r.extraction_status::text, r.uploaded_by, m.weight_kg
     from public.inbody_reports r join public.inbody_metrics m on m.report_id = r.id
     where r.user_id = '00000000-0000-0000-0000-0000000000a1' and r.report_date = tests.today() - 2 $$,
  $$ values ('text/csv', 'COMPLETED', '00000000-0000-0000-0000-0000000000a1'::uuid, 80.90::numeric) $$,
  'the new record is completed, owned by the user and keeps the CSV as its file');
reset role;

-- The import is the user's own record, like a weight they log themselves.
select is(
  (select created_by from public.weight_measurements where inbody_report_id = '00000000-0000-0000-0005-000000000001'),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'the synced weight is attributed to the user');

select * from finish();
rollback;
