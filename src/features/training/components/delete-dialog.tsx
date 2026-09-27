import { useState } from 'react'

import { InlineAlert } from '@/components/common/inline-alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'

import { KIND_NOUN, recordLabel } from '../lib/labels'
import { formatDuration } from '../lib/training'
import type { TrainingRecord } from '../types'

interface DeleteRecordDialogProps {
  record: TrainingRecord | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
}

/** Deleting always asks first; deletion is soft (spec §7). */
export function DeleteRecordDialog({ record, onOpenChange, onConfirm }: DeleteRecordDialogProps) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Dialog
      open={record !== null}
      onOpenChange={(open) => {
        if (!open) setError(null)
        onOpenChange(open)
      }}
    >
      {record && (
        <DialogContent role="alertdialog">
          <DialogHeader
            eyebrow={`Delete ${KIND_NOUN[record.kind]}`}
            title={`Delete ${recordLabel(record.kind, record.type, record.name)}?`}
            description={`This removes the ${formatDuration(record.durationMinutes)} ${KIND_NOUN[record.kind]} from your log.`}
          />
          {error && <InlineAlert>{error}</InlineAlert>}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={working}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={working}
              onClick={() => {
                setWorking(true)
                setError(null)
                onConfirm()
                  .catch((caught: unknown) => {
                    setError(caught instanceof Error ? caught.message : String(caught))
                  })
                  .finally(() => {
                    setWorking(false)
                  })
              }}
            >
              {working ? 'Deleting…' : `Delete ${KIND_NOUN[record.kind]}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
