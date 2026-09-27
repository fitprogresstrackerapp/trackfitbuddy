/** Workouts and activities share one record shape; they are never mixed in counts. */
export type TrainingKind = 'workout' | 'activity'

export interface TrainingRecord {
  id: string
  kind: TrainingKind
  date: string
  /** Database type value, e.g. UPPER_BODY or CRICKET. */
  type: string
  /** Optional name; required for CUSTOM. */
  name: string | null
  durationMinutes: number
  /** Stored at log time by the database; never recalculated on read. */
  estimatedCalories: number
  manualCalories: number | null
  /** manual ?? estimated (generated column). */
  finalCalories: number
  isLocked: boolean
  createdAt: string
}

export interface TrainingWeek {
  start: string
  end: string
  /** Non-deleted records in the week (never after today), oldest first. */
  workouts: TrainingRecord[]
  activities: TrainingRecord[]
}

/** kcal per minute, per type, with a default (system_settings.training_calorie_rates). */
export type CalorieRates = Record<TrainingKind, Record<string, number>>

export interface GuidanceSession {
  name: string
  durationMinutes: number | null
  focus: string | null
}

/** Workout capacity and template in force for a date (from the recommendation cycle). */
export interface TrainingPlan {
  /** Workout days per week; `null` = no active recommendation. */
  capacity: number | null
  cycle: { periodStart: string; sessions: GuidanceSession[] } | null
}
