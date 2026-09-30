import { ArrowRight, Check, Copy, Users } from 'lucide-react'
import { useState, type SubmitEvent } from 'react'
import { Link } from 'react-router'

import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader } from '@/components/ui/dialog'
import { Input, Textarea } from '@/components/ui/input'
import { notify } from '@/lib/feedback'

import type { GroupPreview } from '../api/groups-data'
import { useGroupMutations, usePreviewGroup } from '../api/groups-queries'
import { formatGroupCode, friendlyGroupError, groupPath } from '../lib/groups-logic'
import { createGroupSchema, joinCodeSchema } from '../schemas'

interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
}

/** Copies the join code; the code stays visible if copying isn't allowed. */
export function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        navigator.clipboard
          .writeText(code)
          .then(() => {
            setCopied(true)
            notify.success('Code copied')
          })
          .catch(() => {
            notify.info('Copy the code shown on screen')
          })
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy code'}
    </Button>
  )
}

/** Create a group (spec §46): name + description; the code comes from the server. */
export function CreateGroupSheet({ open, onOpenChange, userId }: SheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open && (
        <SheetContent>
          <SheetHeader eyebrow="Groups" title="Create group" />
          <CreateGroupForm userId={userId} />
        </SheetContent>
      )}
    </Sheet>
  )
}

function CreateGroupForm({ userId }: { userId: string }) {
  const { create } = useGroupMutations(userId)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ id: string; code: string; name: string } | null>(null)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (create.isPending) return
    setSaveError(null)
    const parsed = createGroupSchema.safeParse({ name, description })
    if (!parsed.success) {
      const next: { name?: string; description?: string } = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (key === 'name' || key === 'description') next[key] ??= issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    try {
      const group = await create.mutateAsync(parsed.data)
      setCreated({ ...group, name: parsed.data.name })
    } catch (error) {
      setSaveError(friendlyGroupError(error, 'Couldn’t create the group. Please try again.'))
    }
  }

  if (created) {
    return (
      <div className="flex flex-col gap-5">
        <InlineAlert tone="info" title={`${created.name} is ready`}>
          Share this code with the people you want in the group. It stays the same.
        </InlineAlert>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-4 py-3">
          <div className="flex flex-col gap-1">
            <span className="label-mono text-muted-foreground">Join code</span>
            <span className="metric text-3xl text-foreground" data-testid="group-code">
              {formatGroupCode(created.code)}
            </span>
          </div>
          <CopyCodeButton code={created.code} />
        </div>
        <Button asChild size="lg">
          <Link to={groupPath(created.id)}>
            Open group
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <FormField id="group-name" label="Group name" error={errors.name}>
        {(control) => (
          <Input
            {...control}
            maxLength={60}
            autoComplete="off"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
            disabled={create.isPending}
          />
        )}
      </FormField>
      <FormField
        id="group-description"
        label="Description"
        hint="Optional. What the group is for."
        error={errors.description}
      >
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            maxLength={500}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value)
            }}
            disabled={create.isPending}
          />
        )}
      </FormField>
      {saveError && <InlineAlert>{saveError}</InlineAlert>}
      <Button type="submit" size="lg" disabled={create.isPending}>
        {create.isPending ? 'Creating…' : 'Create group'}
      </Button>
    </form>
  )
}

/** Join Group → Enter code → Confirm group → Join (spec §46). */
export function JoinGroupSheet({
  open,
  onOpenChange,
  userId,
  onJoined,
}: SheetProps & { onJoined: (groupId: string) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open && (
        <SheetContent>
          <SheetHeader eyebrow="Groups" title="Join group" />
          <JoinGroupForm userId={userId} onJoined={onJoined} />
        </SheetContent>
      )}
    </Sheet>
  )
}

const INVALID_CODE = 'That code doesn’t match a group. Check it and try again.'

function JoinGroupForm({ userId, onJoined }: { userId: string; onJoined: (id: string) => void }) {
  const preview = usePreviewGroup()
  const { join } = useGroupMutations(userId)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [found, setFound] = useState<{ code: string; group: GroupPreview } | null>(null)

  async function handleLookup(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (preview.isPending) return
    const parsed = joinCodeSchema.safeParse({ code })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    try {
      const group = await preview.mutateAsync(parsed.data.code)
      if (!group) setError(INVALID_CODE)
      else setFound({ code: parsed.data.code, group })
    } catch (caught) {
      setError(friendlyGroupError(caught, 'Couldn’t check the code. Please try again.'))
    }
  }

  async function handleJoin() {
    if (!found || join.isPending) return
    try {
      const groupId = await join.mutateAsync(found.code)
      notify.success(`Joined ${found.group.name}`)
      onJoined(groupId)
    } catch (caught) {
      setError(friendlyGroupError(caught, 'Couldn’t join the group. Please try again.'))
    }
  }

  if (found) {
    const { group } = found
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2 rounded-md border border-border px-4 py-3">
          <span className="label-mono text-muted-foreground">Confirm group</span>
          <span className="heading-block break-words text-foreground">{group.name}</span>
          {group.description && (
            <p className="text-sm break-words text-foreground-secondary">{group.description}</p>
          )}
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users aria-hidden="true" className="size-4" />
            {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
          </span>
        </div>
        <p className="text-sm text-foreground-secondary">
          Members see each other’s daily calories and protein against their own targets, steps and
          whether a workout was logged. Weight, body measurements and meals stay private.
        </p>
        {error && <InlineAlert>{error}</InlineAlert>}
        {group.alreadyMember ? (
          <Button
            size="lg"
            onClick={() => {
              onJoined(group.id)
            }}
          >
            You’re already a member · Open group
          </Button>
        ) : (
          <Button size="lg" disabled={join.isPending} onClick={() => void handleJoin()}>
            {join.isPending ? 'Joining…' : 'Join group'}
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            setFound(null)
            setError(undefined)
          }}
        >
          Use a different code
        </Button>
      </div>
    )
  }

  return (
    <form noValidate onSubmit={(event) => void handleLookup(event)} className="flex flex-col gap-5">
      <FormField id="group-code" label="Group code" error={error} hint="Ask a member for the code.">
        {(control) => (
          <Input
            {...control}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={16}
            className="font-mono tracking-widest uppercase"
            value={code}
            onChange={(event) => {
              setCode(event.target.value)
            }}
            disabled={preview.isPending}
          />
        )}
      </FormField>
      <Button type="submit" size="lg" disabled={preview.isPending}>
        {preview.isPending ? 'Checking…' : 'Continue'}
      </Button>
    </form>
  )
}
