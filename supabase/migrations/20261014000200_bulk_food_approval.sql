-- =============================================================================
-- Bulk approval of user-created foods (Admin → Food Database → review queue).
--
-- Approves several pending submissions in one call, each exactly as the user
-- entered it, through the same admin_approve_food_submission() a single
-- approval uses: same role check, version check, validation, duplicate-name
-- rule, provenance and audit. Values are never edited here; a food that needs
-- correcting is reviewed on its own.
--
-- One food that cannot be approved (changed since the list was loaded, already
-- reviewed, a name already used by an active food, values outside the limits)
-- does not stop the others: it is skipped and reported with the reason. Each
-- food is approved in its own savepoint, so a skipped food leaves nothing
-- behind.
-- =============================================================================

create function public.admin_approve_food_submissions(p_items jsonb, p_notes text default null)
returns table (
  id           uuid,
  food_item_id uuid,
  outcome      text,
  message      text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  c_max_items constant integer := 50;
  v_item jsonb;
  v_id   uuid;
  v_row  public.food_submissions%rowtype;
begin
  perform private.begin_food_admin(p_notes);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one food' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > c_max_items then
    raise exception 'Approve at most % foods at once', c_max_items using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_id := null;
    begin
      v_id := (v_item ->> 'id')::uuid;
      select s.* into v_row from public.food_submissions s where s.id = v_id;
      if not found then
        raise exception 'Submission not found' using errcode = 'P0002';
      end if;
      food_item_id := public.admin_approve_food_submission(
        v_id, (v_item ->> 'expected_updated_at')::timestamptz,
        v_row.name, v_row.serving_quantity, v_row.serving_unit, v_row.calories,
        v_row.protein_g, v_row.carbs_g, v_row.fat_g, v_row.fiber_g, true, p_notes
      );
      id := v_id;
      outcome := 'APPROVED';
      message := null;
      return next;
    exception when others then
      id := v_id;
      food_item_id := null;
      outcome := 'SKIPPED';
      message := case
        when sqlstate = 'PT409' then 'Changed since the list was loaded'
        when sqlstate = 'P0002' then 'No longer available'
        when sqlstate = '22023' then sqlerrm
        else 'Could not be approved'
      end;
      return next;
    end;
  end loop;
end;
$$;

revoke all on function public.admin_approve_food_submissions(jsonb, text) from public, anon;
grant execute on function public.admin_approve_food_submissions(jsonb, text) to authenticated;
