import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlertTriangle,
  Building2,
  CreditCard,
  Hourglass,
  LayoutDashboard,
  LineChart,
  ScrollText,
  Tags,
  UserCog,
} from 'lucide-react'

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  /** UX-only: capability not backed by a real domain page yet. */
  proposed?: boolean
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/**
 * Approved Control Plane IA.
 * Plans & Pricing is Proposed (no dynamic pricing API).
 * Trials reuses tenant list API with status=trialing — no new backend.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', path: '/overview', icon: LayoutDashboard }],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Tenants', path: '/tenants', icon: Building2 },
      { label: 'Trials', path: '/trials', icon: Hourglass },
      { label: 'Subscriptions', path: '/subscriptions', icon: CreditCard },
      { label: 'Risk Queue', path: '/risk-queue', icon: AlertTriangle },
      { label: 'Usage', path: '/usage', icon: Activity },
    ],
  },
  {
    label: 'Business',
    items: [
      { label: 'Metrics', path: '/metrics', icon: LineChart },
      { label: 'Plans & Pricing', path: '/plans', icon: Tags },
    ],
  },
  {
    label: 'Governance',
    items: [
      { label: 'Audit Log', path: '/audit', icon: ScrollText },
      { label: 'Platform Users', path: '/platform-users', icon: UserCog },
    ],
  },
]
