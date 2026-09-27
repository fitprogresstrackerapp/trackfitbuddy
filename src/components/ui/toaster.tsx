import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { Toaster as SonnerToaster } from 'sonner'

/**
 * Global toast outlet (mounted once in AppProviders). Use `notify` from
 * `@/lib/feedback` — toasts are for transient outcomes ("Meal saved"), never
 * for validation errors, which stay next to their field.
 */
export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-center"
      offset={{ bottom: 24 }}
      mobileOffset={{
        bottom: 'calc(var(--spacing-bottom-nav) + env(safe-area-inset-bottom) + 12px)',
      }}
      visibleToasts={3}
      icons={{
        success: <CircleCheck className="size-4 text-primary" />,
        error: <CircleAlert className="size-4 text-destructive" />,
        warning: <TriangleAlert className="size-4 text-warning" />,
        info: <Info className="size-4 text-foreground-secondary" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-[min(24rem,calc(100vw-2rem))] items-start gap-2.5 rounded-sm border border-border bg-surface-2 px-3.5 py-3 text-sm text-foreground shadow-lg shadow-black/40',
          title: 'font-medium',
          description: 'mt-0.5 text-foreground-secondary',
          icon: 'mt-0.5',
          actionButton:
            'label-mono ml-auto cursor-pointer rounded-xs px-2 py-1 text-primary hover:bg-primary-surface',
        },
      }}
    />
  )
}
