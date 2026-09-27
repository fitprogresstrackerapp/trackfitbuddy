import { EmptyState } from '@/components/common/empty-state'
import { StatusBadge } from '@/components/data/status-badge'
import { ICONS } from '@/constants/icons'
import { cn } from '@/lib/utils'

import type { Guidance } from '../lib/training'
import type { GuidanceSession, TrainingPlan } from '../types'

function sessionMeta(session: GuidanceSession): string {
  return [session.focus, session.durationMinutes ? `~${String(session.durationMinutes)} min` : null]
    .filter(Boolean)
    .join(' · ')
}

interface GuidanceBlockProps {
  plan: TrainingPlan
  guidance: Guidance
  isCurrentWeek: boolean
}

/**
 * The recommended weekly template as guidance (spec §16). It never decides
 * adherence: any workout counts toward capacity, whatever its type.
 */
export function GuidanceBlock({ plan, guidance, isCurrentWeek }: GuidanceBlockProps) {
  if (guidance.kind === 'none' || !plan.cycle) {
    return (
      <EmptyState
        icon={ICONS.goals}
        title="No workout guidance"
        description="Complete your profile and recommendation setup to receive guidance."
      />
    )
  }

  const sessions = plan.cycle.sessions
  const nextIndex = isCurrentWeek && guidance.kind === 'next' ? guidance.index : null

  return (
    <div className="flex flex-col gap-4">
      {isCurrentWeek && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="label-section text-foreground-secondary">
              {guidance.kind === 'next' ? 'Next guidance' : 'This week'}
            </h3>
            <span className="label-mono text-muted-foreground">· Guidance</span>
          </div>
          {guidance.kind === 'next' && (
            <>
              <p className="heading-block text-foreground">{guidance.session.name}</p>
              <p className="label-mono text-muted-foreground">
                Session {guidance.index + 1} of {guidance.total}
                {sessionMeta(guidance.session) ? ` · ${sessionMeta(guidance.session)}` : ''}
              </p>
            </>
          )}
          {guidance.kind === 'capacity-met' && (
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status="completed" label="Weekly capacity met" />
              <span className="text-sm text-foreground-secondary">
                Additional activity is optional.
              </span>
            </div>
          )}
          {guidance.kind === 'template-done' && (
            <p className="text-sm text-foreground-secondary">
              Every session in this week’s template has a logged workout.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Suggestions only. Any workout you log counts toward your weekly capacity.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="label-mono text-muted-foreground">Weekly template</h3>
        <ol className="divide-y divide-border border-y border-border">
          {sessions.map((session, index) => (
            <li
              key={`${String(index)}-${session.name}`}
              aria-current={index === nextIndex ? 'step' : undefined}
              className={cn(
                'flex items-baseline gap-3 py-2 text-sm',
                index === nextIndex ? 'text-foreground' : 'text-foreground-secondary',
              )}
            >
              <span className="w-5 shrink-0 label-mono text-muted-foreground">{index + 1}</span>
              <span className="min-w-0 flex-1 break-words">{session.name}</span>
              {sessionMeta(session) && (
                <span className="shrink-0 label-mono text-muted-foreground">
                  {sessionMeta(session)}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
