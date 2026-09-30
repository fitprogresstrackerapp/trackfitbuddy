import { describe, expect, it } from 'vitest'

import { EnvConfigError } from '@/lib/env'

import { describeUnexpectedError } from './unexpected-error'

describe('describeUnexpectedError', () => {
  it('production never shows raw messages', () => {
    const view = describeUnexpectedError(
      new Error('relation "public.meals" does not exist at /var/task/index.ts:12'),
      false,
    )
    expect(view.description).not.toMatch(/relation|meals|var\/task/)
    expect(view.reload).toBe(true)
  })

  it('development shows the message', () => {
    expect(describeUnexpectedError(new Error('boom'), true).description).toBe('boom')
  })

  it('a chunk lost to a new deployment asks for a reload', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://app/assets/food-page-abc.js',
      'Importing a module script failed.',
      'error loading dynamically imported module',
    ]) {
      expect(describeUnexpectedError(new TypeError(message), false)).toEqual({
        title: 'New version available',
        description: 'TrackFitBuddy was updated. Reload to continue.',
        reload: true,
      })
    }
  })

  it('missing configuration tells the deployer what to set', () => {
    const view = describeUnexpectedError(
      new EnvConfigError(['VITE_SUPABASE_URL must be a valid URL']),
      false,
    )
    expect(view.title).toBe('App not configured')
    expect(view.description).toContain('VITE_SUPABASE_URL')
  })
})
