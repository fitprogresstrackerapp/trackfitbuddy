import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button, IconButton } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/input'
import { addDays, isValidIsoDate } from '@/lib/dates/local-date'

interface DayNavProps {
  date: string
  today: string
  onChange: (date: string) => void
}

/** Previous / date / next, never past today (food can't be logged ahead). */
export function DayNav({ date, today, onChange }: DayNavProps) {
  const isToday = date === today
  return (
    <nav aria-label="Day" className="flex flex-wrap items-center gap-2">
      <IconButton
        label="Previous day"
        icon={ChevronLeft}
        variant="secondary"
        onClick={() => {
          onChange(addDays(date, -1))
        }}
      />
      <label htmlFor="food-date" className="sr-only">
        Date
      </label>
      <DatePicker
        id="food-date"
        className="w-auto min-w-40"
        value={date}
        max={today}
        onChange={(event) => {
          const next = event.target.value
          if (isValidIsoDate(next) && next <= today) onChange(next)
        }}
      />
      <IconButton
        label="Next day"
        icon={ChevronRight}
        variant="secondary"
        disabled={isToday}
        onClick={() => {
          onChange(addDays(date, 1))
        }}
      />
      {!isToday && (
        <Button
          variant="ghost"
          onClick={() => {
            onChange(today)
          }}
        >
          Today
        </Button>
      )}
    </nav>
  )
}
