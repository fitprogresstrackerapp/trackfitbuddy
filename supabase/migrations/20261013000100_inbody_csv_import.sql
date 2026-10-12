-- =============================================================================
-- InBody CSV import (spec §21): a user imports the CSV exported by the InBody
-- app and, after reviewing the values, saves them as the report's results.
--
-- The CSV is parsed by the inbody-import Edge Function, never by the browser
-- and never by an AI model. The function below is the only way those results
-- are stored, and only trusted server code may call it: a browser cannot write
-- inbody_metrics rows (the RLS policies are unchanged: admin only).
--
-- Nothing new is stored: results go to public.inbody_metrics (one per report),
-- the report becomes COMPLETED and the existing weight sync trigger adds the
-- weight to the weight history.
--
-- A CSV imported without an uploaded report becomes its own report record,
-- with the CSV kept as that report's original file in the private bucket.
-- That is the only case in which the CSV is stored, so 'text/csv' is allowed
-- as a report file type.
-- =============================================================================

alter table public.inbody_reports drop constraint inbody_reports_file_type;
alter table public.inbody_reports add constraint inbody_reports_file_type check (
  file_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'text/csv')
);

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'text/csv']
where id = 'inbody-reports';

-- -----------------------------------------------------------------------------
-- Stores one parsed InBody measurement for p_user_id (the verified caller of
-- the Edge Function, never a request field).
--
--   p_report_id given  attach to that report: it must belong to the user, have
--                      no results yet and be dated within one day of the
--                      measurement. The report takes the measurement's date.
--   p_report_id null   create a report for the stored CSV (p_file_path, in the
--                      user's own folder). Refused while a report without
--                      results exists for that date (attach to it instead) or
--                      when results for that date already exist.
--
-- Existing results are never overwritten; corrections stay with admins
-- (admin_correct_inbody_metrics). Refusals, by SQLSTATE:
--   IB001 report not found        IB002 report already has results
--   IB003 date does not match     IB004 a report for this date awaits results
--   IB005 results for this date already exist
--   22023 invalid values or date  42501 account not active
-- -----------------------------------------------------------------------------
create function public.import_inbody_metrics(
  p_user_id          uuid,
  p_measurement_date date,
  p_other            jsonb,
  p_report_id        uuid default null,
  p_file_path        text default null,
  p_weight_kg        numeric default null,
  p_body_fat_percent numeric default null,
  p_muscle_mass_kg   numeric default null,
  p_bmi              numeric default null,
  p_bmr_kcal         integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_report public.inbody_reports%rowtype;
  v_other  jsonb := coalesce(p_other, '{}'::jsonb);
begin
  if p_user_id is null
     or not exists (select 1 from public.profiles p where p.id = p_user_id and p.is_active) then
    raise exception 'The account is not active' using errcode = '42501';
  end if;
  if p_measurement_date is null or p_measurement_date > private.user_local_date(p_user_id) then
    raise exception 'The measurement date is missing or in the future' using errcode = '22023';
  end if;
  if p_weight_kg is null and p_body_fat_percent is null and p_muscle_mass_kg is null then
    raise exception 'The measurement has no results' using errcode = '22023';
  end if;
  if coalesce(p_weight_kg not between 20 and 400, false)
     or coalesce(p_body_fat_percent not between 0 and 100, false)
     or coalesce(p_muscle_mass_kg not between 0 and 200, false)
     or coalesce(p_bmi not between 5 and 100, false)
     or coalesce(p_bmr_kcal not between 500 and 5000, false)
     or jsonb_typeof(v_other) <> 'object'
     or pg_column_size(v_other) > 8000 then
    raise exception 'One or more values are invalid' using errcode = '22023';
  end if;

  -- One import at a time per user: a repeated submission waits here and is
  -- then refused by the checks below instead of creating a second result.
  perform pg_advisory_xact_lock(hashtextextended('inbody_import:' || p_user_id::text, 0));
  -- The user is the actor in the audit log.
  perform set_config('app.actor_id', p_user_id::text, true);

  if p_report_id is not null then
    select r.* into v_report from public.inbody_reports r
    where r.id = p_report_id and r.user_id = p_user_id and not r.is_deleted
    for update;
    if not found then
      raise exception 'InBody report not found' using errcode = 'IB001';
    end if;
    if exists (select 1 from public.inbody_metrics m where m.report_id = v_report.id) then
      raise exception 'This report already has results' using errcode = 'IB002';
    end if;
    if abs(v_report.report_date - p_measurement_date) > 1 then
      raise exception 'The measurement does not match the selected report' using errcode = 'IB003';
    end if;
  else
    if p_file_path is null
       or p_file_path !~ ('^' || p_user_id::text || '/[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f-]{36}\.csv$')
       or not exists (
         select 1 from storage.objects o where o.bucket_id = 'inbody-reports' and o.name = p_file_path
       ) then
      raise exception 'The CSV file is missing' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.inbody_reports r
      join public.inbody_metrics m on m.report_id = r.id
      where r.user_id = p_user_id and not r.is_deleted and r.report_date = p_measurement_date
    ) then
      raise exception 'Results for this date already exist' using errcode = 'IB005';
    end if;
    if exists (
      select 1 from public.inbody_reports r
      where r.user_id = p_user_id and not r.is_deleted and r.report_date = p_measurement_date
        and not exists (select 1 from public.inbody_metrics m where m.report_id = r.id)
    ) then
      raise exception 'A report for this date is awaiting results' using errcode = 'IB004';
    end if;
    insert into public.inbody_reports (user_id, report_date, file_path, file_type, uploaded_by)
    values (p_user_id, p_measurement_date, p_file_path, 'text/csv', p_user_id)
    returning * into v_report;
  end if;

  -- The report is settled first: the weight sync trigger reads its date.
  update public.inbody_reports
  set extraction_status = 'COMPLETED', extraction_error = null, report_date = p_measurement_date
  where id = v_report.id;

  begin
    insert into public.inbody_metrics (
      report_id, user_id, weight_kg, body_fat_percent, muscle_mass_kg, bmi, bmr_kcal, other_metrics_json
    ) values (
      v_report.id, p_user_id, p_weight_kg, p_body_fat_percent, p_muscle_mass_kg, p_bmi, p_bmr_kcal, v_other
    );
  exception when unique_violation then
    raise exception 'This report already has results' using errcode = 'IB002';
  end;

  return jsonb_build_object(
    'report_id', v_report.id,
    'report_date', p_measurement_date,
    'created_report', p_report_id is null,
    'weight_kg', p_weight_kg,
    'body_fat_percent', p_body_fat_percent,
    'muscle_mass_kg', p_muscle_mass_kg,
    'bmi', p_bmi,
    'bmr_kcal', p_bmr_kcal
  );
end;
$$;

revoke all on function
  public.import_inbody_metrics(uuid, date, jsonb, uuid, text, numeric, numeric, numeric, numeric, integer)
  from public, anon, authenticated;
grant execute on function
  public.import_inbody_metrics(uuid, date, jsonb, uuid, text, numeric, numeric, numeric, numeric, integer)
  to service_role;
