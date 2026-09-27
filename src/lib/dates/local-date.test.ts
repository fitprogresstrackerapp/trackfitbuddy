import { describe, expect, it } from 'vitest'

import { ageOn, isValidIsoDate, todayInTimeZone } from './local-date'

describe('todayInTimeZone', () => {
  it('uses the user timezone, not UTC', () => {
    // 20:00 UTC on 27 Sep is already 28 Sep in India (UTC+5:30).
    const instant = new Date('2026-09-27T20:00:00Z')
    expect(todayInTimeZone('Asia/Kolkata', instant)).toBe('2026-09-28')
    expect(todayInTimeZone('UTC', instant)).toBe('2026-09-27')
  })
})

describe('ageOn', () => {
  it('counts completed years', () => {
    expect(ageOn('1994-09-28', '2026-09-28')).toBe(32)
    expect(ageOn('1994-09-29', '2026-09-28')).toBe(31)
  })
})

describe('isValidIsoDate', () => {
  it('rejects impossible dates', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true)
    expect(isValidIsoDate('2026-02-29')).toBe(false)
    expect(isValidIsoDate('2026-13-01')).toBe(false)
    expect(isValidIsoDate('28/09/2026')).toBe(false)
  })
})
