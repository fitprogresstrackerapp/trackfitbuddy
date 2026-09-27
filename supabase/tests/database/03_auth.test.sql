-- PIN storage/verification and onboarding save. Run with: npm run db:test
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

create schema tests;
create function tests.login(p_id uuid) returns void language sql
as $$ select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

insert into auth.users (id, phone, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', '919000000001', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', '919000000002', 'authenticated', 'authenticated');
insert into public.profiles (id, phone) values
  ('00000000-0000-0000-0000-0000000000a1', '+919000000001'),
  ('00000000-0000-0000-0000-0000000000b2', '+919000000002');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'private.user_pins', 'SELECT'), 'authenticated cannot read PIN hashes');
select ok(not has_table_privilege('anon', 'private.user_pins', 'SELECT'), 'anon cannot read PIN hashes');
select ok(not has_table_privilege('authenticated', 'private.login_attempts', 'SELECT'), 'authenticated cannot read login attempts');
select ok(not has_function_privilege('anon', 'public.auth_verify_pin(text, text)', 'EXECUTE'), 'anon cannot verify PINs');
select ok(not has_function_privilege('authenticated', 'public.auth_verify_pin(text, text)', 'EXECUTE'), 'authenticated cannot verify PINs');
select ok(not has_function_privilege('authenticated', 'public.auth_set_pin(uuid, text, uuid)', 'EXECUTE'), 'authenticated cannot set PINs');
select ok(has_function_privilege('service_role', 'public.auth_verify_pin(text, text)', 'EXECUTE'), 'service role can verify PINs');
select ok(not has_function_privilege('anon', 'public.save_onboarding_measurements(numeric, numeric)', 'EXECUTE'), 'anon cannot save onboarding data');

-- ---------------------------------------------------------------------------
-- auth_set_pin
-- ---------------------------------------------------------------------------
select throws_ok($$ select public.auth_set_pin('00000000-0000-0000-0000-0000000000a1', '123') $$, '22023', null, 'PIN must have 4 digits');
select throws_ok($$ select public.auth_set_pin('00000000-0000-0000-0000-0000000000a1', '12a4') $$, '22023', null, 'PIN must be numeric');
select lives_ok($$ select public.auth_set_pin('00000000-0000-0000-0000-0000000000a1', '0000') $$, 'a 4-digit PIN can be set');
select ok(
  (select pin_hash <> '0000' and pin_hash like '$2a$10$%' from private.user_pins where user_id = '00000000-0000-0000-0000-0000000000a1'),
  'PIN stored as a bcrypt hash, not plaintext'
);
select is(
  (select count(*) from public.audit_logs
   where entity_type = 'user_pins' and target_user_id = '00000000-0000-0000-0000-0000000000a1'
     and old_values_json is null and new_values_json is null),
  1::bigint,
  'PIN changes are audited without PIN material'
);

-- ---------------------------------------------------------------------------
-- auth_verify_pin
-- ---------------------------------------------------------------------------
select results_eq($$ select * from public.auth_verify_pin('+919000000001', '0000') $$,
  $$ values ('OK'::text, '00000000-0000-0000-0000-0000000000a1'::uuid) $$, 'correct PIN verifies');
select results_eq($$ select status from public.auth_verify_pin('+919000000001', '1111') $$,
  $$ values ('INVALID'::text) $$, 'wrong PIN is invalid');
select results_eq($$ select status from public.auth_verify_pin('+919999999999', '0000') $$,
  $$ values ('INVALID'::text) $$, 'unknown phone is indistinguishable from a wrong PIN');
select results_eq($$ select status from public.auth_verify_pin('+919000000002', '0000') $$,
  $$ values ('INVALID'::text) $$, 'an account without a PIN cannot log in');
select results_eq($$ select status from public.auth_verify_pin('9000000001', '0000') $$,
  $$ values ('INVALID'::text) $$, 'non-canonical phone is rejected');

-- Lockout: 1 failure above + 4 more = 5 → locked, even for the correct PIN.
select public.auth_verify_pin('+919000000001', '1111') from generate_series(1, 4);
select results_eq($$ select status from public.auth_verify_pin('+919000000001', '0000') $$,
  $$ values ('LOCKED'::text) $$, 'five failures lock the phone');
select lives_ok($$ select public.auth_set_pin('00000000-0000-0000-0000-0000000000a1', '2468') $$, 'PIN reset');
select results_eq($$ select status from public.auth_verify_pin('+919000000001', '2468') $$,
  $$ values ('OK'::text) $$, 'a PIN reset clears the lockout');

-- Deactivated account
update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000a1';
select results_eq($$ select status from public.auth_verify_pin('+919000000001', '2468') $$,
  $$ values ('DISABLED'::text) $$, 'correct PIN on a deactivated account reports DISABLED');
update public.profiles set is_active = true where id = '00000000-0000-0000-0000-0000000000a1';

-- ---------------------------------------------------------------------------
-- save_onboarding_measurements (as the user, RLS applies)
-- ---------------------------------------------------------------------------
set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000b2');

select lives_ok($$ select public.save_onboarding_measurements(170.5, 68.2) $$, 'onboarding measurements saved');
select lives_ok($$ select public.save_onboarding_measurements(170.5, 68.4) $$, 'repeat submission accepted');
select results_eq(
  $$ select count(*), max(weight_kg) from public.weight_measurements $$,
  $$ values (1::bigint, 68.40::numeric) $$,
  'repeat submission updates the initial weight instead of duplicating it'
);
select throws_ok($$ select public.save_onboarding_measurements(20, 68) $$, '23514', null, 'impossible height rejected');
select is((select height_cm from public.profiles), 170.5::numeric, 'height kept from the successful save');

reset role;
select * from finish();
rollback;
