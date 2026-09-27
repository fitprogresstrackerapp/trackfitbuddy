import { describe, expect, it, vi } from 'vitest'

import type { AppSupabaseClient } from '@/lib/supabase/client'

import { logTraining } from './training-data'

function fakeClient() {
  const rpc = vi.fn().mockResolvedValue({ data: 'id-1', error: null })
  return { client: { rpc } as unknown as AppSupabaseClient, rpc }
}

describe('logTraining', () => {
  it('sends type, name, duration and manual calories — never an estimate', async () => {
    const { client, rpc } = fakeClient()
    await logTraining(client, 'workout', {
      type: 'UPPER_BODY',
      name: 'Push Strength',
      durationMinutes: 45,
      manualCalories: 350,
      date: '2026-09-24',
    })
    expect(rpc).toHaveBeenCalledWith('log_workout', {
      p_date: '2026-09-24',
      p_type: 'UPPER_BODY',
      p_duration_minutes: 45,
      p_name: 'Push Strength',
      p_manual_calories: 350,
    })
  })

  it('omits optional fields and routes activities to log_activity', async () => {
    const { client, rpc } = fakeClient()
    await logTraining(client, 'activity', {
      type: 'CRICKET',
      name: null,
      durationMinutes: 90,
      manualCalories: null,
      date: '2026-09-24',
    })
    expect(rpc).toHaveBeenCalledWith('log_activity', {
      p_date: '2026-09-24',
      p_type: 'CRICKET',
      p_duration_minutes: 90,
    })
  })

  it('surfaces database errors to the caller', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '22023', message: 'x' } })
    await expect(
      logTraining({ rpc } as unknown as AppSupabaseClient, 'workout', {
        type: 'LEGS',
        name: null,
        durationMinutes: 30,
        manualCalories: null,
        date: '2026-09-25',
      }),
    ).rejects.toMatchObject({ code: '22023' })
  })
})
