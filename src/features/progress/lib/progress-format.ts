import { formatNumber, NO_VALUE } from '@/lib/format'

/** "68%" from a 0–1 rate; "—" without one. */
export function formatPercent(rate: number | null): string {
  return rate === null ? NO_VALUE : `${formatNumber(Math.round(rate * 100))}%`
}

/** "−0.9 kg", "+1.2 kg", "0 kg" — a real minus sign, always signed. */
export function formatSigned(value: number, fractionDigits: number, unit: string): string {
  const rounded = Number(value.toFixed(fractionDigits))
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
  return `${sign}${formatNumber(Math.abs(rounded), fractionDigits)} ${unit}`.trim()
}

/** "Sep 21 – 27" style label for a Monday–Sunday week. */
export function formatWeekLabel(start: string, end: string): string {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  })
  const [sy = 1970, sm = 1, sd = 1] = start.split('-').map(Number)
  const [ey = 1970, em = 1, ed = 1] = end.split('-').map(Number)
  const from = format.format(new Date(Date.UTC(sy, sm - 1, sd)))
  const to = sm === em ? String(ed) : format.format(new Date(Date.UTC(ey, em - 1, ed)))
  return `${from} – ${to}`
}
