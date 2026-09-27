import type { ReactNode } from 'react'
import { NavLink } from 'react-router'

import type { NavItem } from '@/constants/navigation'
import { ROUTES } from '@/constants/routes'

import { Brand } from './brand'
import { sidebarItemClass } from './nav-styles'

export function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === ROUTES.home || item.to === ROUTES.admin}
      className={({ isActive }) => sidebarItemClass(isActive)}
    >
      <Icon aria-hidden="true" className="size-4" />
      {item.label}
    </NavLink>
  )
}

interface SidebarProps {
  items: readonly NavItem[]
  /** Accessible name of the main navigation. */
  navLabel: string
  /** Mono tag next to the brand, e.g. "CONTROL" in the admin shell. */
  tag?: string
  /** Links below the divider (Profile, Admin entry, Back to app…). */
  secondary?: ReactNode
  footer?: ReactNode
}

/** Desktop navigation (≥ lg). Quiet: same ground as the page, one border. */
export function Sidebar({ items, navLabel, tag, secondary, footer }: SidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-sidebar flex-col border-r border-border bg-background lg:flex">
      <div className="flex h-top-bar shrink-0 items-center gap-3 px-5">
        <Brand />
        {tag && <span className="ml-auto label-mono text-primary">{tag}</span>}
      </div>
      <nav aria-label={navLabel} className="flex flex-1 flex-col overflow-y-auto px-3 pt-5">
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </div>
        {secondary && (
          <>
            <div className="mx-3 my-5 h-px bg-border" />
            <div className="flex flex-col gap-0.5">{secondary}</div>
          </>
        )}
      </nav>
      {footer && <div className="border-t border-border p-3">{footer}</div>}
    </aside>
  )
}
