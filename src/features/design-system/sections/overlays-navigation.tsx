import { LogOut, MoreHorizontal, Pencil, Copy, Trash2 } from 'lucide-react'

import { FormField } from '@/components/common/form-field'
import { Breadcrumb } from '@/components/layout/breadcrumb'
import { Section } from '@/components/layout/page'
import { Button, IconButton } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AdornedInput } from '@/components/common/adorned-input'
import { PRIMARY_NAV, PROFILE_NAV } from '@/constants/navigation'
import { notify } from '@/lib/feedback'
import {
  bottomItemClass,
  railItemClass,
  sidebarItemClass,
} from '@/app/layouts/components/nav-styles'

export function OverlaysSection() {
  return (
    <Section title="Dialogs · sheets · menus · toasts">
      <div className="flex flex-wrap items-center gap-3">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader
              eyebrow="Recommendation · Cycle 03"
              title="Accept and lock targets?"
              description="Targets stay fixed for this cycle. Change them only if advised by your nutritionist or coach."
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button onClick={() => notify.success('Targets locked')}>Accept & lock</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary">Open sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader
              title="Log steps"
              description="The latest entry for today becomes the active value."
            />
            <FormField id="ds-steps" label="Steps">
              {(control) => <AdornedInput {...control} trailing="STEPS" inputMode="numeric" />}
            </FormField>
            <SheetFooter>
              <SheetClose asChild>
                <Button variant="ghost">Cancel</Button>
              </SheetClose>
              <SheetClose asChild>
                <Button onClick={() => notify.success('Steps saved')}>Save</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Meal actions" icon={MoreHorizontal} variant="secondary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem>
              <Pencil aria-hidden="true" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Copy aria-hidden="true" />
              Copy meal
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem tone="destructive">
              <Trash2 aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => notify.success('Meal saved')}>
          Success toast
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => notify.info('Recommendation generated', 'Review until Oct 5.')}
        >
          Info toast
        </Button>
        <Button size="sm" variant="ghost" onClick={() => notify.warning('AI budget nearly used')}>
          Warning toast
        </Button>
        <Button size="sm" variant="ghost" onClick={() => notify.error('Couldn’t save workout')}>
          Error toast
        </Button>
      </div>
    </Section>
  )
}

export function NavigationSection() {
  const [home, food] = PRIMARY_NAV
  return (
    <Section title="Navigation" meta="sidebar ≥1024 · rail 768–1023 · bottom <768">
      <div className="grid gap-8 md:grid-cols-3">
        <div className="space-y-2">
          <p className="label-mono text-muted-foreground">Sidebar</p>
          <div className="flex w-56 flex-col gap-0.5">
            {[home, food, PROFILE_NAV].map(
              (item, index) =>
                item && (
                  <span key={item.to} className={sidebarItemClass(index === 0)}>
                    <item.icon aria-hidden="true" className="size-4" />
                    {item.label}
                  </span>
                ),
            )}
            <span className={sidebarItemClass(false)}>
              <LogOut aria-hidden="true" className="size-4" />
              Log out
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <p className="label-mono text-muted-foreground">Rail</p>
          <div className="flex gap-1">
            {PRIMARY_NAV.slice(0, 3).map((item, index) => (
              <span key={item.to} className={railItemClass(index === 1)}>
                <item.icon aria-hidden="true" className="size-5" />
                {item.label}
              </span>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="label-mono text-muted-foreground">Bottom nav</p>
          <div className="grid h-bottom-nav grid-cols-5 border-t border-border">
            {PRIMARY_NAV.map((item, index) => (
              <span key={item.to} className={bottomItemClass(index === 2)}>
                <item.icon aria-hidden="true" className="size-5" />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <p className="label-mono text-muted-foreground">Breadcrumb</p>
        <Breadcrumb
          items={[{ label: 'Admin', to: '#' }, { label: 'Users', to: '#' }, { label: 'Asha' }]}
        />
      </div>
    </Section>
  )
}
