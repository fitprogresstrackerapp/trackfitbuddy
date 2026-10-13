-- =============================================================================
-- Groups weekly view (spec §46–48; docs/groups.md): one Monday–Sunday week of
-- the same group-visible information the daily cards already show.
--
-- No ranking, no leaderboard, no score (spec §47). Nothing is stored: every
-- value is read from source data on request. No table or policy changes.
--
-- get_group_member_week() returns, for each day of the week that the caller
-- may see, exactly what get_group_member_day() returns for that day. It calls
-- that function for each day, so membership, the history rule, each member's
-- own join day, former members, the target in force and the steps / workout
-- rules are the existing ones, not a second copy. Two things are added per
-- member and day, because the existing adherence rules need them:
--   * the tolerance in force on that day (the day's target snapshot; the
--     configurable system rule, spec §27). No snapshot → null, and the day is
--     not eligible for adherence, as in Progress;
--   * the weekly workout capacity in force (the snapshot, else the covering
--     cycle) and that cycle's start date, for the existing workout-week rule
--     (a cycle starting mid-week makes it a transition week, spec §17).
-- Future days are never returned: the week ends at the caller's today.
-- =============================================================================

create function public.get_group_member_week(p_group_id uuid, p_week_start date)
returns table (
  day                     date,
  user_id                 uuid,
  name                    text,
  group_role              public.group_role,
  calories                numeric,
  calories_target         integer,
  protein_g               numeric,
  protein_target_g        numeric,
  steps                   integer,
  workout_logged          boolean,
  nutrition_tolerance     numeric,
  calorie_lower_tolerance numeric,
  calorie_upper_tolerance numeric,
  workouts_per_week       integer,
  cycle_start             date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_history_from date := private.group_history_from(p_group_id);
  v_today        date := private.user_local_date(auth.uid());
begin
  if v_history_from is null then
    raise exception 'Not a member of this group' using errcode = '42501';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'A week starts on a Monday' using errcode = '22023';
  end if;
  if p_week_start > v_today then
    raise exception 'Choose this week or an earlier week' using errcode = '22023';
  end if;

  return query
  select d.day, g.user_id, g.name, g.group_role, g.calories, g.calories_target, g.protein_g,
         g.protein_target_g, g.steps, g.workout_logged,
         t.nutrition_tolerance, t.calorie_lower_tolerance, t.calorie_upper_tolerance,
         coalesce(t.workouts_per_week, c.workout_days_per_week)::integer,
         c.period_start
  from (
    select generate_series(
             greatest(p_week_start, v_history_from),
             least(p_week_start + 6, v_today),
             interval '1 day'
           )::date as day
  ) d
  cross join lateral public.get_group_member_day(p_group_id, d.day) g
  left join public.daily_target_snapshots t on t.user_id = g.user_id and t.target_date = d.day
  left join lateral (
    select cy.workout_days_per_week, cy.period_start
    from public.recommendation_cycles cy
    where cy.user_id = g.user_id and cy.status <> 'REPLACED'
      and cy.period_start <= d.day and (cy.period_end is null or cy.period_end >= d.day)
    order by cy.period_start desc
    limit 1
  ) c on true
  order by d.day, g.name nulls last, g.user_id;
end;
$$;

revoke all on function public.get_group_member_week(uuid, date) from public, anon;
grant execute on function public.get_group_member_week(uuid, date) to authenticated;
