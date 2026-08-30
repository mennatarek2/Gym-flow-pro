import type { TenantNearLimitDto } from '@/lib/api/types'

export type LimitTier = 'approaching' | 'critical' | 'exceeded'

export function limitTier(percentOfCap: number): LimitTier {
  if (percentOfCap >= 100) return 'exceeded'
  if (percentOfCap >= 90) return 'critical'
  return 'approaching'
}

export const LIMIT_TIER_LABEL: Record<LimitTier, string> = {
  approaching: '≥ 80%',
  critical: '≥ 90%',
  exceeded: '≥ 100%',
}

export const LIMIT_TIER_BADGE: Record<LimitTier, string> = {
  approaching: 'bg-amber-900 text-amber-100',
  critical: 'bg-red-900 text-red-200',
  exceeded: 'bg-red-950 text-red-100 ring-1 ring-red-700',
}

export function groupByLimitTier(rows: TenantNearLimitDto[]): Record<LimitTier, TenantNearLimitDto[]> {
  const groups: Record<LimitTier, TenantNearLimitDto[]> = { exceeded: [], critical: [], approaching: [] }
  for (const row of rows) {
    groups[limitTier(row.percentOfCap)].push(row)
  }
  return groups
}
