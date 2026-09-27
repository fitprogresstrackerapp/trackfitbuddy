-- =============================================================================
-- Extensions, private helper schema, shared enums and generic trigger functions.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;    -- food name search / duplicate detection
create extension if not exists btree_gist with schema extensions; -- non-overlapping recommendation cycles

-- Helper functions used by RLS policies and triggers live in `private`, which is
-- NOT exposed through the Supabase Data API. `authenticated` needs USAGE so that
-- policies evaluated on its behalf can call the helpers.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enums — only for stable, spec-defined value sets.
-- Frequently evolving lists (goal types, workout/activity types, units) are
-- CHECK-constrained text instead, so they can change without enum surgery.
-- -----------------------------------------------------------------------------

create type public.app_role as enum ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'USER');                 -- spec §51
create type public.gender as enum ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');              -- product decision; see docs/database.md
create type public.activity_level as enum (                                                       -- spec §23
  'SEDENTARY', 'LIGHTLY_ACTIVE', 'MODERATELY_ACTIVE', 'VERY_ACTIVE', 'EXTREMELY_ACTIVE'
);
create type public.meal_category as enum ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS');             -- spec §10
create type public.food_review_status as enum ('PENDING_REVIEW', 'APPROVED', 'REJECTED');        -- spec §11
create type public.measurement_source as enum ('MANUAL', 'INBODY');                               -- spec §20
create type public.group_role as enum ('MEMBER', 'LEADER', 'ADMIN');                              -- spec §64
create type public.audit_action as enum (                                                         -- spec §63
  'CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'LOCK', 'UNLOCK', 'PIN_RESET', 'ROLE_CHANGE', 'ADMIN_CORRECTION'
);
create type public.processing_run_status as enum (                                                -- spec §41
  'CREATED', 'RUNNING', 'PARTIAL', 'COMPLETED', 'STOPPED_BUDGET', 'FAILED'
);
create type public.processing_user_status as enum (                                               -- spec §41
  'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'SKIPPED'
);
create type public.recommendation_cycle_status as enum ('IN_REVIEW', 'LOCKED', 'REPLACED');     -- spec §32, §22 (reprocess)
create type public.inbody_extraction_status as enum ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Normalised form used for search and duplicate detection:
-- lower-case, non-alphanumerics collapsed to single spaces, trimmed.
create function private.normalize_name(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(lower(p_value), '[^[:alnum:]]+', ' ', 'g')), '');
$$;

-- The user performing the current operation.
-- Authenticated requests: the JWT subject. Trusted server code running with the
-- service role (no JWT user) may identify the acting admin via the
-- transaction-local setting `app.actor_id`. A JWT user can never override it.
create function private.current_actor_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.uid(), nullif(current_setting('app.actor_id', true), '')::uuid);
$$;
