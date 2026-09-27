import * as MenuPrimitive from '@radix-ui/react-dropdown-menu'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

const DropdownMenu = MenuPrimitive.Root
const DropdownMenuTrigger = MenuPrimitive.Trigger
const DropdownMenuGroup = MenuPrimitive.Group

function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-48 overflow-hidden rounded-sm border border-border bg-surface-1 p-1 text-foreground shadow-lg shadow-black/40 data-[state=open]:animate-menu-in',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  )
}

interface ItemProps extends ComponentProps<typeof MenuPrimitive.Item> {
  tone?: 'default' | 'destructive'
}

function DropdownMenuItem({ className, tone = 'default', ...props }: ItemProps) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        'flex h-9 cursor-pointer items-center gap-2.5 rounded-xs px-2.5 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
        tone === 'destructive'
          ? 'text-destructive data-highlighted:bg-destructive/12'
          : 'text-foreground-secondary data-highlighted:bg-surface-2 data-highlighted:text-foreground [&_svg]:text-muted-foreground data-highlighted:[&_svg]:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn('px-2.5 pt-2 pb-1.5 text-sm text-foreground', className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
  )
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
}
