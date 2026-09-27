import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { LucideIcon } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/**
 * Button hierarchy — one primary action per screen:
 *   primary      filled muted green
 *   secondary    surface + border
 *   ghost        text only until hovered
 *   destructive  muted error treatment
 *   link         inline text action
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-sm font-semibold tracking-[0.06em] whitespace-nowrap uppercase transition-[color,background-color,border-color] duration-150 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80',
        secondary:
          'border border-border bg-surface-2 text-foreground hover:border-foreground-secondary/40 active:bg-surface-1',
        ghost: 'text-foreground-secondary hover:bg-surface-2 hover:text-foreground',
        destructive:
          'border border-destructive/40 bg-destructive/12 text-destructive hover:bg-destructive/20',
        link: 'text-primary normal-case underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-[0.6875rem]',
        md: 'h-9 px-4 text-xs',
        lg: 'h-11 px-5 text-sm',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    // Links are inline text: no box height or padding, whatever the size.
    compoundVariants: [{ variant: 'link', class: 'h-auto px-0' }],
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

type IconButtonProps = Omit<ButtonProps, 'size' | 'children' | 'aria-label' | 'asChild'> & {
  /** Accessible name — required because the button has no visible text. */
  label: string
  icon: LucideIcon
  size?: 'sm' | 'md'
}

/** Compact icon-only button with a mandatory accessible label. */
function IconButton({
  label,
  icon: Icon,
  size = 'md',
  variant = 'ghost',
  ...props
}: IconButtonProps) {
  return (
    <Button
      size={size === 'sm' ? 'icon-sm' : 'icon'}
      variant={variant}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon aria-hidden="true" />
    </Button>
  )
}

export { Button, buttonVariants, IconButton }
export type { ButtonProps }
