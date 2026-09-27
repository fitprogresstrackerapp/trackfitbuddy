/**
 * Number formatting for display. Indian grouping (en-IN) — identical to
 * Western grouping below 1,00,000, which covers almost every metric.
 */
const cache = new Map<number, Intl.NumberFormat>()

export function formatNumber(value: number, maximumFractionDigits = 0): string {
  let formatter = cache.get(maximumFractionDigits)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits })
    cache.set(maximumFractionDigits, formatter)
  }
  return formatter.format(value)
}

/** Placeholder for missing data. Missing is never shown as zero (spec §68). */
export const NO_VALUE = '—'
