-- =============================================================================
-- InBody uploads: let the uploader remove a file that never became a report.
--
-- The app stores the original file first and then records it in
-- public.inbody_reports. If the record is refused (for example a future date),
-- the file stayed behind in the private bucket with no record. Users had no
-- delete permission on storage at all, so nothing could remove it.
--
-- This policy allows exactly that cleanup and nothing more: a user may delete
-- a file only in their own folder and only while NO report row references it.
-- A file that belongs to a report (including a soft-deleted one) can never be
-- deleted by a user. The bucket stays private.
-- =============================================================================

-- Checked without RLS, so a soft-deleted or otherwise hidden report still
-- protects its file.
create function private.inbody_file_is_unreferenced(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.inbody_reports r where r.file_path = p_path);
$$;

revoke all on function private.inbody_file_is_unreferenced(text) from public, anon;
grant execute on function private.inbody_file_is_unreferenced(text) to authenticated, service_role;

create policy inbody_files_delete_unreferenced on storage.objects for delete to authenticated
using (
  bucket_id = 'inbody-reports'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select private.is_active_user())
  and private.inbody_file_is_unreferenced(name)
);
