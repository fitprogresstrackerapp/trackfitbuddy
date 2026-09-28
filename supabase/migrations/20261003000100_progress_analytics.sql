-- =============================================================================
-- Progress analytics (spec §44, §67 "reusable aggregation functions for daily
-- nutrition"):
--   * daily_nutrition() — the caller's per-day totals of logged meal-item
--     snapshots for a bounded date range, so Progress never downloads a year
--     of individual meal items.
--
-- Runs as the caller (SECURITY INVOKER): RLS on meals / meal_items decides
-- visibility, and it only ever aggregates auth.uid()'s own records. Days with
-- nothing logged are absent (missing data is never returned as zero).
-- =============================================================================

create function public.daily_nutrition(p_start date, p_end date)
returns table (
  nutrition_date date,
  calories       numeric,
  protein_g      numeric,
  carbs_g        numeric,
  fat_g          numeric,
  fiber_g        numeric,
  item_count     integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'A valid date range is required' using errcode = '22023';
  end if;
  if p_end - p_start > 400 then
    raise exception 'The date range can cover at most 400 days' using errcode = '22023';
  end if;

  return query
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
  where m.user_id = auth.uid()
    and m.meal_date between p_start and p_end
    and not m.is_deleted
    and not mi.is_deleted
  group by m.meal_date
  order by m.meal_date;
end;
$$;

revoke all on function public.daily_nutrition(date, date) from public, anon;
grant execute on function public.daily_nutrition(date, date) to authenticated;
