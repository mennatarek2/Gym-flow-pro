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
  /** Catalog key under nav.* */
  labelKey: string
  path: string
  icon: LucideIcon
  /** UX-only: capability not backed by a real domain page yet. */
  proposed?: boolean
}

export interface NavGroup {
  labelKey: string
  items: NavItem[]
}

/**
 * Approved Control Plane IA.
 * Plans & Pricing is Proposed (no dynamic pricing API).
 * Trials reuses tenant list API with status=trialing — no new backend.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.overview',
    items: [{ labelKey: 'nav.dashboard', path: '/overview', icon: LayoutDashboard }],
  },
  {
    labelKey: 'nav.operations',
    items: [
      { labelKey: 'nav.tenants', path: '/tenants', icon: Building2 },
      { labelKey: 'nav.trials', path: '/trials', icon: Hourglass },
      { labelKey: 'nav.subscriptions', path: '/subscriptions', icon: CreditCard },
      { labelKey: 'nav.riskQueue', path: '/risk-queue', icon: AlertTriangle },
      { labelKey: 'nav.usage', path: '/usage', icon: Activity },
    ],
  },
  {
    labelKey: 'nav.business',
    items: [
      { labelKey: 'nav.metrics', path: '/metrics', icon: LineChart },
      { labelKey: 'nav.plansPricing', path: '/plans', icon: Tags },
    ],
  },
  {
    labelKey: 'nav.governance',
    items: [
      { labelKey: 'nav.auditLog', path: '/audit', icon: ScrollText },
      { labelKey: 'nav.platformUsers', path: '/platform-users', icon: UserCog },
    ],
  },
]
