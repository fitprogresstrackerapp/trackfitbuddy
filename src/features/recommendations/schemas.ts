import { z } from 'zod'

import { FEEDBACK_MAX } from './api/recommendation-data'

/** Monthly check-in (spec §31): one optional free-text field, 1–2,000 characters. */
export const feedbackSchema = z.object({
  feedback: z
    .string()
    .trim()
    .min(1, { error: 'Write a few words, or leave the check-in empty' })
    .max(FEEDBACK_MAX, { error: `Use at most ${String(FEEDBACK_MAX)} characters` }),
})

export type FeedbackInput = z.output<typeof feedbackSchema>
