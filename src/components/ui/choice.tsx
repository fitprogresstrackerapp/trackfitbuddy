import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { Check } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

/** Square checkbox. Pair with a <Label htmlFor>. */
function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-4.5 shrink-0 cursor-pointer rounded-xs border border-foreground-secondary/50 bg-surface-1 transition-colors disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-destructive data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        focusRing,
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-2.5', className)}
      {...props}
    />
  )
}

function RadioGroupItem({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-item"
      className={cn(
        'peer flex size-4.5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-foreground-secondary/50 bg-surface-1 transition-colors disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:border-primary',
        focusRing,
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-primary" />
    </RadioGroupPrimitive.Item>
  )
}

/** On/off toggle. Rectangular track to match the block language. */
function Toggle({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="toggle"
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-sm border border-border bg-surface-2 p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:border-primary data-[state=checked]:bg-primary-surface',
        focusRing,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3.5 rounded-xs bg-foreground-secondary transition-transform duration-150 data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary" />
    </SwitchPrimitive.Root>
  )
}

export { Checkbox, RadioGroup, RadioGroupItem, Toggle }
