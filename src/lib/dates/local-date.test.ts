import { describe, expect, it } from 'vitest'

import {
  ageOn,
  calendarWeekOf,
  formatDayLabel,
  formatShortDate,
  hourInTimeZone,
  isValidIsoDate,
  safeTimeZone,
  todayInTimeZone,
} from './local-date'

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

describe('calendarWeekOf (Monday → Sunday, spec §17)', () => {
  it.each([
    ['2026-09-21', '2026-09-21', '2026-09-27'], // Monday
    ['2026-09-24', '2026-09-21', '2026-09-27'], // Thursday
    ['2026-09-27', '2026-09-21', '2026-09-27'], // Sunday belongs to the week that started Monday
    ['2026-10-01', '2026-09-28', '2026-10-04'], // crosses a month boundary
  ])('%s → %s…%s', (day, start, end) => {
    expect(calendarWeekOf(day)).toEqual({ start, end })
  })
})

describe('labels and timezone', () => {
  it('formats the Home date label', () => {
    expect(formatDayLabel('2026-09-21')).toBe('MON 21 SEP')
    expect(formatShortDate('2026-10-05')).toBe('OCT 5')
  })

  it('reads the hour in the user timezone', () => {
    const instant = new Date('2026-09-27T20:00:00Z')
    expect(hourInTimeZone('Asia/Kolkata', instant)).toBe(1)
    expect(hourInTimeZone('UTC', instant)).toBe(20)
  })

  it('falls back to the project default for an unusable timezone', () => {
    expect(safeTimeZone('Europe/London')).toBe('Europe/London')
    expect(safeTimeZone('Mars/Olympus')).toBe('Asia/Kolkata')
    expect(safeTimeZone(null)).toBe('Asia/Kolkata')
  })
})
