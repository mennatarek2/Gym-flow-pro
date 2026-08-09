import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Building2, LineChart } from 'lucide-react'

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
}

/** Stage 2: Tenants + Risk Queue + Metrics. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Tenants', path: '/tenants', icon: Building2 },
  { label: 'Risk Queue', path: '/risk-queue', icon: AlertTriangle },
  { label: 'Metrics', path: '/metrics', icon: LineChart },
]
