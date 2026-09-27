import { Pencil, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { EmptyState } from '@/components/common/empty-state'
import { StatusBadge } from '@/components/data/status-badge'
import { IconButton } from '@/components/ui/button'
import { formatDayLabel } from '@/lib/dates/local-date'
import { formatNumber } from '@/lib/format'

import { KIND_ICONS, recordLabel, typeLabel } from '../lib/labels'
import { formatDuration, groupByDate, isEditable } from '../lib/training'
import type { TrainingKind, TrainingRecord } from '../types'

interface RecordListProps {
  kind: TrainingKind
  records: readonly TrainingRecord[]
  today: string
  busyIds: ReadonlySet<string>
  empty: { title: string; description: string; action?: ReactNode }
  onEdit: (record: TrainingRecord) => void
  onDelete: (record: TrainingRecord) => void
}

/** A week's records grouped by day, newest first. Locked records stay readable. */
export function RecordList({
  kind,
  records,
  today,
  busyIds,
  empty,
  onEdit,
  onDelete,
}: RecordListProps) {
  if (records.length === 0) {
    return (
      <EmptyState
        icon={KIND_ICONS[kind]}
        title={empty.title}
        description={empty.description}
        {...(empty.action ? { action: empty.action } : {})}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {groupByDate(records).map(([date, entries]) => (
        <div key={date} className="flex flex-col gap-2">
          <h3 className="label-mono text-muted-foreground">
            {date === today ? `Today · ${formatDayLabel(date)}` : formatDayLabel(date)}
          </h3>
          <ul className="divide-y divide-border rounded-md border border-border bg-surface-1">
            {entries.map((record) => (
              <RecordRow
                key={record.id}
                record={record}
                today={today}
                busy={busyIds.has(record.id)}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function RecordRow({
  record,
  today,
  busy,
  onEdit,
  onDelete,
}: {
  record: TrainingRecord
  today: string
  busy: boolean
  onEdit: (record: TrainingRecord) => void
  onDelete: (record: TrainingRecord) => void
}) {
  const Icon = KIND_ICONS[record.kind]
  const label = recordLabel(record.kind, record.type, record.name)
  const type = typeLabel(record.kind, record.type)
  const editable = isEditable(record, today)
  const manual = record.manualCalories !== null

  return (
    <li className="flex items-start gap-3 px-4 py-3" aria-busy={busy || undefined}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium break-words text-foreground">{label}</span>
          {label !== type && <span className="label-mono text-muted-foreground">{type}</span>}
          {!editable && <StatusBadge status="locked" />}
        </div>
        <p className="flex flex-wrap gap-x-3 label-mono text-muted-foreground">
          <span>{formatDuration(record.durationMinutes)}</span>
          <span className="text-foreground-secondary">
            {manual ? '' : '≈ '}
            {formatNumber(record.finalCalories)} kcal
          </span>
          <span>{manual ? 'Manual' : 'Estimated'}</span>
        </p>
      </div>
      {editable && (
        <div className="-mr-1.5 flex shrink-0 items-center">
          <IconButton
            label={`Edit ${label}`}
            icon={Pencil}
            size="sm"
            disabled={busy}
            onClick={() => {
              onEdit(record)
            }}
          />
          <IconButton
            label={`Delete ${label}`}
            icon={Trash2}
            size="sm"
            disabled={busy}
            onClick={() => {
              onDelete(record)
            }}
          />
        </div>
      )}
    </li>
  )
}
