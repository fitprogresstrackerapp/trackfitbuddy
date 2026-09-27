/** Display labels for activity types (spec §18; values match the database CHECK list). */
export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  WALKING: 'Walking',
  RUNNING: 'Running',
  CYCLING: 'Cycling',
  TREADMILL: 'Treadmill',
  CRICKET: 'Cricket',
  BADMINTON: 'Badminton',
  SWIMMING: 'Swimming',
  FOOTBALL: 'Football',
  BASKETBALL: 'Basketball',
  HIKING_TREKKING: 'Hiking / Trekking',
  CUSTOM: 'Custom',
}

/** The record's own name when it has one (always for CUSTOM), else its type. */
export function activityLabel(type: string, customName: string | null): string {
  const name = customName?.trim() ?? ''
  if (name.length > 0) return name
  return ACTIVITY_TYPE_LABELS[type] ?? type
}
