import type { LucideIcon } from 'lucide-react'
import { Building2, Inbox, Settings } from 'lucide-react'

export interface NavItem {
  labelKey: string
  path: string
  icon: LucideIcon
  visible?: (role: string | null | undefined) => boolean
}

export const PRIMARY_NAV: NavItem[] = [
  { labelKey: 'nav.gyms', path: '/gyms', icon: Building2 },
  { labelKey: 'nav.inbox', path: '/oc/support', icon: Inbox },
  { labelKey: 'nav.platformAdmin', path: '/settings', icon: Settings },
]

export function visibleNavItems(role: string | null | undefined): NavItem[] {
  return PRIMARY_NAV.filter((item) => (item.visible ? item.visible(role) : true))
}
