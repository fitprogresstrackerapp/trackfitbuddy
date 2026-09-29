import { addDays, ageOn, calendarWeekOf, daysBetween } from '../../../lib/dates/local-date.ts'
import {
  change,
  compositionSeries,
  datesIn,
  entryTotals,
  nutritionSeries,
  stepsSummary,
  summarizeNutrition,
  targetsByDate,
  weeklyTraining,
  weightSeries,
  workoutAdherence,
  type NutrientSummary,
} from '../../progress/lib/progress-logic.ts'
import type {
  CompositionMeasurement,
  CycleInfo,
  DayNutrition,
  Period,
  SnapshotInfo,
  StepsDay,
  TrainingEntry,
  WeightMeasurement,
} from '../../progress/types.ts'
import { countWorkoutDays } from '../../training/lib/training.ts'
import { MAX_ANALYSIS_DAYS, RECENT_DAYS } from './config.ts'
import {
  INPUT_SCHEMA_VERSION,
  recommendationInputSchema,
  type PeriodSummary,
  type RecommendationInput,
} from './input.ts'

/*
 * Deterministic recommendation input builder (spec §35, Prompt 10 §15–26).
 *
 * Pure: the Edge Function loads the rows (supabase loader), and this module
 * turns them into RecommendationInput. Every metric reuses the Progress,
 * nutrition and training functions, so Progress and the AI always see the
 * same numbers:
 *   * nutrition adherence: days meeting that day's snapshot target / eligible
 *     tracked days; the processing day itself is never counted;
 *   * workouts: distinct days, Monday–Sunday weeks, full weeks only;
 *   * body: the current_weights precedence (InBody over manual on a date);
 *   * steps: active entries only (a missing day is not zero).
 */

export interface TypedEntry extends TrainingEntry {
  /** Workout or activity type, e.g. UPPER_BODY or CRICKET. */
  type: string
}

export interface SourceTargets {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
}

/** The latest non-replaced cycle before the new one, with what the user saw. */
export interface SourceCycle extends CycleInfo {
  recommended: SourceTargets
  parsedOutput: unknown
  workoutPlan: unknown
}

export interface InputSource {
  /** The user's local date on which processing happens (the new cycle start). */
  processingDate: string
  profile: {
    dateOfBirth: string | null
    gender: string | null
    heightCm: number | null
    activityLevel: string | null
    job: string | null
    hobbies: string | null
    /** Capacity preference that applies to the new cycle. */
    workoutDaysPerWeek: number | null
    /** From profile_readiness (spec §71). */
    missingFields: string[]
  }
  /** The active goal version: the one the new cycle will be locked to. */
  goal: { id: string; longTermGoal: string; description: string | null; focuses: string[] } | null
  previousCycle: SourceCycle | null
  /** Non-replaced cycles overlapping the fetched window (transition weeks, fallback targets). */
  cycles: CycleInfo[]
  snapshots: SnapshotInfo[]
  nutritionDays: DayNutrition[]
  workouts: TypedEntry[]
  activities: TypedEntry[]
  weights: WeightMeasurement[]
  composition: CompositionMeasurement[]
  steps: StepsDay[]
  /** current_weights row (latest date, InBody first). */
  currentWeight: { date: string; weightKg: number } | null
  /** Latest InBody report with metrics, dated on or before the processing date. */
  latestInbody: {
    date: string
    weightKg: number | null
    bodyFatPercent: number | null
    muscleMassKg: number | null
  } | null
  feedback: string | null
}

export interface AnalysisWindow {
  /** The summarised days (always completed days, ending the day before processing). */
  period: Period
  /** Widened to whole Monday–Sunday weeks for weekly workout counts. */
  fetched: Period
  kind: 'previous-cycle' | 'recent'
}

/**
 * What to summarise: the previous cycle from its start to the day before the
 * new cycle (at most MAX_ANALYSIS_DAYS), else the last RECENT_DAYS days.
 */
export function analysisWindow(
  processingDate: string,
  previousCycle: Pick<CycleInfo, 'periodStart' | 'periodEnd'> | null,
): AnalysisWindow {
  const yesterday = addDays(processingDate, -1)
  let period: Period
  let kind: AnalysisWindow['kind']
  if (previousCycle) {
    const earliest = addDays(processingDate, -MAX_ANALYSIS_DAYS)
    const end =
      previousCycle.periodEnd !== null && previousCycle.periodEnd < yesterday
        ? previousCycle.periodEnd
        : yesterday
    const start = previousCycle.periodStart > earliest ? previousCycle.periodStart : earliest
    period = { start: start > end ? end : start, end }
    kind = 'previous-cycle'
  } else {
    period = { start: addDays(processingDate, -RECENT_DAYS), end: yesterday }
    kind = 'recent'
  }
  return { period, fetched: { start: calendarWeekOf(period.start).start, end: yesterday }, kind }
}

export const READINESS_REASONS = {
  profile: 'Profile incomplete',
  goal: 'No goals configured',
  capacity: 'No workout capacity configured',
} as const

/**
 * Minimum readiness (spec §71; Prompt 10 §56): the onboarding-required
 * profile fields, an active goal and a workout capacity. InBody, steps,
 * feedback and history are optional. `null` = ready.
 */
export function readinessIssue(source: Pick<InputSource, 'profile' | 'goal'>): string | null {
  if (source.profile.missingFields.length > 0) return READINESS_REASONS.profile
  if (!source.goal) return READINESS_REASONS.goal
  if (source.profile.workoutDaysPerWeek === null) return READINESS_REASONS.capacity
  return null
}

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
const roundOrNull = (value: number | null, decimals: number) =>
  value === null ? null : round(value, decimals)

function nutrient(summary: NutrientSummary, decimals: number) {
  return {
    average: roundOrNull(summary.averageActual, decimals),
    target: roundOrNull(summary.averageTarget, decimals),
    days_met: summary.adherence.met,
    eligible_days: summary.adherence.eligible,
    adherence: roundOrNull(summary.adherence.rate, 3),
  }
}

function typeCounts(entries: readonly TypedEntry[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of entries) counts[entry.type] = (counts[entry.type] ?? 0) + 1
  return counts
}

function changeOf(points: readonly { date: string; value: number | null }[]) {
  const result = change(points)
  return {
    start: result ? round(result.first.value, 2) : null,
    end: result ? round(result.last.value, 2) : null,
    change: result?.delta ?? null,
  }
}

const within = (period: Period) => (item: { date: string }) =>
  item.date >= period.start && item.date <= period.end

/** One analysed period, with exactly the Progress rules. */
export function summarizePeriod(
  window: AnalysisWindow,
  source: InputSource,
  today: string,
): PeriodSummary {
  const { period, fetched } = window
  const inPeriod = within(period)
  const targets = targetsByDate(
    datesIn({ start: fetched.start, end: today }),
    source.snapshots,
    source.cycles,
  )

  const points = nutritionSeries(period, source.nutritionDays.filter(inPeriod), targets)
  const nutrition = summarizeNutrition(points, targets, today)

  const workoutsInPeriod = source.workouts.filter(inPeriod)
  const weeks = weeklyTraining(period, source.workouts, targets, source.cycles, today)
  const adherence = workoutAdherence(weeks)
  const workoutTotals = entryTotals(workoutsInPeriod, period)

  const activitiesInPeriod = source.activities.filter(inPeriod)
  const activityTotals = entryTotals(activitiesInPeriod, period)

  const steps = stepsSummary(source.steps.filter(inPeriod))
  const weights = weightSeries(source.weights.filter(inPeriod))
  const composition = source.composition.filter(inPeriod)

  return {
    start: period.start,
    end: period.end,
    days: daysBetween(period.start, period.end) + 1,
    nutrition: {
      tracked_days: nutrition.trackedDays,
      calories: nutrient(nutrition.nutrients.calories, 0),
      protein_g: nutrient(nutrition.nutrients.proteinG, 1),
      carbs_g: nutrient(nutrition.nutrients.carbsG, 1),
      fat_g: nutrient(nutrition.nutrients.fatG, 1),
      fiber_g: nutrient(nutrition.nutrients.fiberG, 1),
    },
    workouts: {
      workout_days: countWorkoutDays(
        workoutsInPeriod.map((workout) => workout.date),
        today,
      ),
      sessions: workoutTotals?.sessions ?? 0,
      minutes: workoutTotals?.minutes ?? 0,
      calories: workoutTotals?.calories ?? 0,
      full_weeks: adherence.weeks,
      days_completed: adherence.done,
      days_expected: adherence.expected,
      adherence: roundOrNull(adherence.rate, 3),
      types: typeCounts(workoutsInPeriod),
    },
    activities: {
      sessions: activityTotals?.sessions ?? 0,
      days: activityTotals?.days ?? 0,
      minutes: activityTotals?.minutes ?? 0,
      calories: activityTotals?.calories ?? 0,
      types: typeCounts(activitiesInPeriod),
    },
    steps: { tracked_days: steps?.days ?? 0, average: steps?.average ?? null },
    body: {
      weight_kg: changeOf(weights.map((point) => ({ date: point.date, value: point.weightKg }))),
      body_fat_percent: changeOf(compositionSeries(composition, 'bodyFatPercent')),
      muscle_mass_kg: changeOf(compositionSeries(composition, 'muscleMassKg')),
    },
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function templateOf(plan: unknown): { name: string; type: string | null }[] {
  const sessions = record(plan)?.sessions
  if (!Array.isArray(sessions)) return []
  return sessions.flatMap((session: unknown) => {
    if (typeof session === 'string') return [{ name: session, type: null }]
    const item = record(session)
    const name = item?.name
    if (typeof name !== 'string') return []
    return [{ name, type: typeof item?.type === 'string' ? item.type : null }]
  })
}

function previousRecommendation(
  cycle: SourceCycle,
): RecommendationInput['previous_recommendation'] {
  const output = record(cycle.parsedOutput)
  const focus = output?.short_term_focus
  const summary = output?.summary
  const final = {
    calories: cycle.final_calories,
    protein_g: cycle.final_protein_g,
    carbs_g: cycle.final_carbs_g,
    fat_g: cycle.final_fat_g,
    fiber_g: cycle.final_fiber_g,
  }
  const recommended = cycle.recommended
  return {
    generated_on: cycle.periodStart,
    targets: final,
    edited_by_user:
      final.calories !== recommended.calories ||
      final.protein_g !== recommended.proteinG ||
      final.carbs_g !== recommended.carbsG ||
      final.fat_g !== recommended.fatG ||
      final.fiber_g !== recommended.fiberG,
    workout_template: templateOf(cycle.workoutPlan),
    focus: Array.isArray(focus)
      ? focus.filter((item): item is string => typeof item === 'string')
      : [],
    summary: typeof summary === 'string' ? summary : null,
  }
}

const lower = (value: string | null) => (value === null ? null : value.toLowerCase())

/** Trimmed text, or `null` when absent or blank. */
const textOrNull = (value: string | null) => {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

export class InputNotReadyError extends Error {}

/**
 * Builds and validates the input. Throws InputNotReadyError when the user
 * does not meet the readiness rule (they are skipped, never fabricated).
 */
export function buildRecommendationInput(source: InputSource): RecommendationInput {
  const issue = readinessIssue(source)
  const goal = source.goal
  const capacity = source.profile.workoutDaysPerWeek
  if (issue !== null || !goal || capacity === null) {
    throw new InputNotReadyError(issue ?? READINESS_REASONS.profile)
  }

  const today = source.processingDate
  const previous = source.previousCycle
  const window = analysisWindow(today, previous)
  const summary = summarizePeriod(window, source, today)
  const { dateOfBirth } = source.profile
  const inbody =
    source.latestInbody && source.latestInbody.date <= today ? source.latestInbody : null

  return recommendationInputSchema.parse({
    schema_version: INPUT_SCHEMA_VERSION,
    processing_date: today,
    first_recommendation: previous === null,
    user: {
      age: dateOfBirth ? ageOn(dateOfBirth, today) : null,
      gender: lower(source.profile.gender),
      height_cm: source.profile.heightCm,
      current_weight_kg: source.currentWeight?.weightKg ?? null,
      current_weight_date: source.currentWeight?.date ?? null,
      activity_level: lower(source.profile.activityLevel),
      job: textOrNull(source.profile.job),
      hobbies: textOrNull(source.profile.hobbies),
    },
    goals: {
      long_term: goal.longTermGoal.toLowerCase(),
      short_term: goal.focuses.map((focus) => focus.toLowerCase()),
      objective: textOrNull(goal.description),
    },
    workout: { days_per_week: capacity },
    previous_cycle: previous
      ? { workout_days_per_week: previous.workout_days_per_week, summary }
      : null,
    recent_data: previous ? null : summary,
    inbody: inbody
      ? {
          date: inbody.date,
          weight_kg: inbody.weightKg,
          body_fat_percent: inbody.bodyFatPercent,
          muscle_mass_kg: inbody.muscleMassKg,
        }
      : null,
    previous_recommendation: previous ? previousRecommendation(previous) : null,
    feedback: textOrNull(source.feedback),
  })
}
