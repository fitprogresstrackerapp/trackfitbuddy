-- Progress: daily_nutrition() aggregation — snapshots only, soft deletion,
-- locked history included, missing days absent, range bounds, isolation.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

create schema tests;
create function tests.login(p_id uuid) returns void language sql
as $$ select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

insert into auth.users (id, phone, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', '919300000001', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', '919300000002', 'authenticated', 'authenticated');
insert into public.profiles (id, phone, name) values
  ('00000000-0000-0000-0000-0000000000a1', '+919300000001', 'Alice'),
  ('00000000-0000-0000-0000-0000000000b2', '+919300000002', 'Bob');

insert into public.food_items (id, name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g) values
  ('00000000-0000-0000-0f00-000000000061', 'Progress rice', 100, 'g', 130, 2.7, 28, 0.3, 0.4),
  ('00000000-0000-0000-0f00-000000000062', 'Progress dal', 1, 'bowl', 200, 12, 30, 4, 8);

-- Service role writes history (users cannot back-date): a locked meal 3 days
-- ago, a meal today with one deleted item, a deleted meal today, Bob's meal.
insert into public.meals (id, user_id, meal_date, is_locked) values
  ('00000000-0000-0000-0e00-000000000061', '00000000-0000-0000-0000-0000000000a1', tests.today() - 3, true);
insert into public.meals (id, user_id, meal_date) values
  ('00000000-0000-0000-0e00-000000000062', '00000000-0000-0000-0000-0000000000a1', tests.today()),
  ('00000000-0000-0000-0e00-000000000063', '00000000-0000-0000-0000-0000000000a1', tests.today()),
  ('00000000-0000-0000-0e00-000000000064', '00000000-0000-0000-0000-0000000000b2', tests.today());
insert into public.meal_items (id, meal_id, user_id, food_item_id, quantity) values
  ('00000000-0000-0000-0d00-000000000061', '00000000-0000-0000-0e00-000000000061', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0f00-000000000061', 200),
  ('00000000-0000-0000-0d00-000000000062', '00000000-0000-0000-0e00-000000000062', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0f00-000000000062', 1),
  ('00000000-0000-0000-0d00-000000000063', '00000000-0000-0000-0e00-000000000062', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0f00-000000000061', 100),
  ('00000000-0000-0000-0d00-000000000064', '00000000-0000-0000-0e00-000000000063', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0f00-000000000062', 2),
  ('00000000-0000-0000-0d00-000000000065', '00000000-0000-0000-0e00-000000000064', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0f00-000000000062', 3);
update public.meal_items set is_deleted = true where id = '00000000-0000-0000-0d00-000000000063';
update public.meals set is_deleted = true where id = '00000000-0000-0000-0e00-000000000063';

-- A master change after logging must not affect history.
update public.food_items set calories = 999 where id = '00000000-0000-0000-0f00-000000000061';

set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000a1');

select results_eq(
  $$ select nutrition_date, calories, protein_g, item_count
     from public.daily_nutrition(tests.today() - 6, tests.today()) $$,
  $$ values (tests.today() - 3, 260.00::numeric, 5.40::numeric, 1),
            (tests.today(),     200.00::numeric, 12.00::numeric, 1) $$,
  'per-day totals of logged snapshots; deleted items/meals excluded; locked history included'
);
select is(
  (select count(*) from public.daily_nutrition(tests.today() - 6, tests.today())
   where nutrition_date between tests.today() - 2 and tests.today() - 1),
  0::bigint, 'days with nothing logged are absent, not zero');
select is(
  (select count(*) from public.daily_nutrition(tests.today() - 1, tests.today() - 1)),
  0::bigint, 'an empty range returns no rows');
select is(
  (select calories from public.daily_nutrition(tests.today() - 3, tests.today() - 3)),
  260.00::numeric, 'history uses the stored snapshot, not the changed food master');
select throws_ok(
  $$ select * from public.daily_nutrition(tests.today(), tests.today() - 1) $$,
  '22023', null, 'reversed ranges are rejected');
select throws_ok(
  $$ select * from public.daily_nutrition(tests.today() - 401, tests.today()) $$,
  '22023', null, 'ranges are bounded');
select lives_ok(
  $$ select * from public.daily_nutrition(tests.today() - 400, tests.today()) $$,
  'a one-year range (plus margin) is allowed');

select tests.login('00000000-0000-0000-0000-0000000000b2');
select results_eq(
  $$ select nutrition_date, calories from public.daily_nutrition(tests.today() - 6, tests.today()) $$,
  $$ values (tests.today(), 600.00::numeric) $$,
  'each user only ever sees their own totals');

reset role;
set local role anon;
select throws_ok(
  $$ select * from public.daily_nutrition(current_date - 1, current_date) $$,
  '42501', null, 'anonymous callers cannot use daily_nutrition');
reset role;
select is(
  (select prosecdef from pg_proc where proname = 'daily_nutrition'),
  false, 'daily_nutrition runs as the caller (RLS applies)');

select * from finish();
rollback;
