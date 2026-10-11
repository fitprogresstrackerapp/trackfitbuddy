import { describe, expect, it } from 'vitest'

import {
  addDays,
  addMonths,
  ageOn,
  calendarWeekOf,
  daysBetween,
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

describe('date boundaries', () => {
  it('the local day changes exactly at local midnight, not at UTC midnight', () => {
    // India is UTC+5:30: local midnight is 18:30 UTC.
    expect(todayInTimeZone('Asia/Kolkata', new Date('2026-09-30T18:29:59Z'))).toBe('2026-09-30')
    expect(todayInTimeZone('Asia/Kolkata', new Date('2026-09-30T18:30:00Z'))).toBe('2026-10-01')
    // UTC midnight is mid-morning in India: no change of day.
    expect(todayInTimeZone('Asia/Kolkata', new Date('2026-09-30T23:59:59Z'))).toBe('2026-10-01')
    expect(todayInTimeZone('Asia/Kolkata', new Date('2026-10-01T00:00:00Z'))).toBe('2026-10-01')
  })

  it('month and year turn over in the user’s timezone', () => {
    expect(todayInTimeZone('Asia/Kolkata', new Date('2026-12-31T18:29:59Z'))).toBe('2026-12-31')
    expect(todayInTimeZone('Asia/Kolkata', new Date('2026-12-31T18:30:00Z'))).toBe('2027-01-01')
    // The same instant is still the old year further west.
    expect(todayInTimeZone('America/New_York', new Date('2026-12-31T18:30:00Z'))).toBe('2026-12-31')
  })

  it('the same instant is a different calendar day in different timezones', () => {
    const instant = new Date('2026-10-04T10:30:00Z')
    expect(todayInTimeZone('Pacific/Kiritimati', instant)).toBe('2026-10-05')
    expect(todayInTimeZone('Asia/Kolkata', instant)).toBe('2026-10-04')
    expect(todayInTimeZone('Pacific/Pago_Pago', instant)).toBe('2026-10-03')
  })

  it('daylight-saving changes do not shift the date', () => {
    // US clocks go back on 1 Nov 2026 (a 25-hour day).
    expect(todayInTimeZone('America/New_York', new Date('2026-11-01T03:59:59Z'))).toBe('2026-10-31')
    expect(todayInTimeZone('America/New_York', new Date('2026-11-01T04:00:00Z'))).toBe('2026-11-01')
    expect(todayInTimeZone('America/New_York', new Date('2026-11-02T04:59:59Z'))).toBe('2026-11-01')
    expect(todayInTimeZone('America/New_York', new Date('2026-11-02T05:00:00Z'))).toBe('2026-11-02')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
  })

  it('day arithmetic crosses months, years and leap days', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(daysBetween('2026-12-25', '2027-01-04')).toBe(10)
    // The 90-day late-entry boundary.
    expect(addDays('2026-10-11', -90)).toBe('2026-07-13')
    expect(daysBetween(addDays('2026-10-11', -90), '2026-10-11')).toBe(90)
  })

  it('month arithmetic clamps to the end of shorter months', () => {
    expect(addMonths('2026-10-31', -1)).toBe('2026-09-30')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
  })

  it('weeks are Monday–Sunday across month and year boundaries', () => {
    // Sunday 4 Oct ends its week; Monday 5 Oct starts the next.
    expect(calendarWeekOf('2026-10-04')).toEqual({ start: '2026-09-28', end: '2026-10-04' })
    expect(calendarWeekOf('2026-10-05')).toEqual({ start: '2026-10-05', end: '2026-10-11' })
    // The week containing New Year: Mon 28 Dec 2026 – Sun 3 Jan 2027.
    expect(calendarWeekOf('2026-12-31')).toEqual({ start: '2026-12-28', end: '2027-01-03' })
    expect(calendarWeekOf('2027-01-03')).toEqual({ start: '2026-12-28', end: '2027-01-03' })
    expect(calendarWeekOf('2027-01-04')).toEqual({ start: '2027-01-04', end: '2027-01-10' })
  })

  it('the week of "today" follows the user’s timezone at the Sunday/Monday boundary', () => {
    // Sunday 23:59 in India vs Monday 00:00 in India.
    const sunday = todayInTimeZone('Asia/Kolkata', new Date('2026-10-04T18:29:59Z'))
    const monday = todayInTimeZone('Asia/Kolkata', new Date('2026-10-04T18:30:00Z'))
    expect(calendarWeekOf(sunday).start).toBe('2026-09-28')
    expect(calendarWeekOf(monday).start).toBe('2026-10-05')
  })
})
