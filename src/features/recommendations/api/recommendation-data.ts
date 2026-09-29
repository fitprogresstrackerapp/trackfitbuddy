import type { AppSupabaseClient } from '@/lib/supabase/client'

/*
 * User-side recommendation data: this month's check-in (spec §31) and the
 * recommendation history. Runs as the signed-in user, so RLS and the feedback
 * guard trigger are the boundary: the window (the 1st of the month until
 * that month's recommendation is generated, in the user's timezone) and the
 * lock are enforced by the database, not the UI. Processing internals (AI
 * input, raw output, tokens) are never read here.
 */

export const FEEDBACK_MAX = 2000

export interface MonthlyFeedback {
  /** First day of the user's current month. */
  month: string
  feedback: string | null
  updatedAt: string | null
  /** Used for (and locked by) this month's recommendation. */
  locked: boolean
  /** This month's recommendation already exists. */
  processed: boolean
}

export const monthOf = (date: string) => `${date.slice(0, 7)}-01`

export async function fetchMonthlyFeedback(
  supabase: AppSupabaseClient,
  userId: string,
  today: string,
): Promise<MonthlyFeedback> {
  const month = monthOf(today)
  const [feedback, cycle] = await Promise.all([
    supabase
      .from('recommendation_feedback')
      .select('feedback, updated_at, locked_at')
      .eq('user_id', userId)
      .eq('feedback_month', month)
      .maybeSingle(),
    supabase
      .from('recommendation_cycles')
      .select('id')
      .eq('user_id', userId)
      .eq('processing_month', month)
      .neq('status', 'REPLACED')
      .limit(1)
      .maybeSingle(),
  ])
  if (feedback.error) throw feedback.error
  if (cycle.error) throw cycle.error
  return {
    month,
    feedback: feedback.data?.feedback ?? null,
    updatedAt: feedback.data?.updated_at ?? null,
    locked: Boolean(feedback.data?.locked_at),
    processed: cycle.data !== null,
  }
}

/** Creates or updates this month's check-in (one record per month). */
export async function saveMonthlyFeedback(
  supabase: AppSupabaseClient,
  userId: string,
  month: string,
  feedback: string,
): Promise<void> {
  const { error } = await supabase
    .from('recommendation_feedback')
    .upsert(
      { user_id: userId, feedback_month: month, feedback },
      { onConflict: 'user_id,feedback_month' },
    )
  if (error) throw error
}

export interface HistoryItem {
  id: string
  periodStart: string
  periodEnd: string | null
  reviewDeadline: string
  status: 'IN_REVIEW' | 'LOCKED'
}

/** Recommendations generated for the user, newest first (replaced ones are not shown). */
export async function fetchRecommendationHistory(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<HistoryItem[]> {
  const { data, error } = await supabase
    .from('recommendation_cycles')
    .select('id, period_start, period_end, review_deadline, status')
    .eq('user_id', userId)
    .neq('status', 'REPLACED')
    .order('period_start', { ascending: false })
    .limit(12)
  if (error) throw error
  return data.flatMap((row) =>
    row.status === 'REPLACED'
      ? []
      : [
          {
            id: row.id,
            periodStart: row.period_start,
            periodEnd: row.period_end,
            reviewDeadline: row.review_deadline,
            status: row.status,
          },
        ],
  )
}
