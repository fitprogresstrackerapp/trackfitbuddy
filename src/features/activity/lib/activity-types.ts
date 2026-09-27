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

export function activityLabel(type: string, customName: string | null): string {
  if (type === 'CUSTOM' && customName) return customName
  return ACTIVITY_TYPE_LABELS[type] ?? type
}
