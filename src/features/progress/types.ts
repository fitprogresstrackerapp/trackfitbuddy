import type { TargetCycleRow, TargetSnapshotRow } from '@/features/nutrition/lib/targets'
import type { Database } from '@/types/database'

export type RangeKey = '7D' | '30D' | '3M' | '6M' | '1Y'

/** Inclusive ISO date range in the user's timezone. */
export interface Period {
  start: string
  end: string
}

/** One logged day's totals (from daily_nutrition). Unlogged days are absent. */
export interface DayNutrition {
  date: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
  itemCount: number
}

export type CycleStatus = Exclude<
  Database['public']['Enums']['recommendation_cycle_status'],
  'REPLACED'
>

export interface CycleInfo extends TargetCycleRow {
  id: string
  status: CycleStatus
  periodStart: string
  /** `null` = open-ended (the current cycle). */
  periodEnd: string | null
  reviewDeadline: string
  goalId: string | null
}

export interface SnapshotInfo extends TargetSnapshotRow {
  target_date: string
}

export interface NutritionPeriodData {
  days: DayNutrition[]
  snapshots: SnapshotInfo[]
  cycles: CycleInfo[]
}

export interface TrainingEntry {
  date: string
  durationMinutes: number
  /** Stored at log time (manual ?? estimated); never recalculated. */
  calories: number
}

export interface TrainingPeriodData {
  /** Covers whole Monday–Sunday weeks around the period, so weekly counts are complete. */
  fetched: Period
  workouts: TrainingEntry[]
  activities: TrainingEntry[]
  snapshots: SnapshotInfo[]
  cycles: CycleInfo[]
}

export type MeasurementSource = Database['public']['Enums']['measurement_source']

export interface WeightMeasurement {
  date: string
  weightKg: number
  source: MeasurementSource
  createdAt: string
}

export interface CompositionMeasurement {
  date: string
  bodyFatPercent: number | null
  muscleMassKg: number | null
}

export interface BodyPeriodData {
  weights: WeightMeasurement[]
  composition: CompositionMeasurement[]
}

export interface StepsDay {
  date: string
  steps: number
}

export interface GoalInfo {
  longTermGoal: string
  description: string | null
  effectiveFrom: string
  /** Short-term focus values, highest priority first. */
  focuses: string[]
}
