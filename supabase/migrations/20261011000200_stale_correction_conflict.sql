-- =============================================================================
-- Stale admin corrections: answer with a conflict instead of hanging.
--
-- private.assert_current_version() rejected a correction made against an old
-- version of a record with SQLSTATE 40001 (serialization_failure). The API
-- layer (PostgREST) treats class-40 errors as transient and retries the whole
-- transaction itself. The version never matches on a retry, so the request
-- did not return until the caller gave up: the second of two admins correcting
-- the same record saw a hanging save instead of "This record changed since you
-- opened it".
--
-- The rule is unchanged (nothing is written unless the version matches); only
-- the error code is. PT409 is a PostgREST custom status: it is returned at
-- once as HTTP 409 Conflict and is never retried.
-- =============================================================================
create or replace function private.assert_current_version(p_current timestamptz, p_expected timestamptz)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_expected is null or p_current is distinct from p_expected then
    raise exception 'This record changed since you opened it. Refresh and try again.' using errcode = 'PT409';
  end if;
end;
$$;
