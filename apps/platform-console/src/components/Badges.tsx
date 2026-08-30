const TIER_STYLES: Record<string, string> = {
  starter: 'bg-gray-100 text-gray-800 ring-1 ring-gray-200',
  growth: 'bg-blue-50 text-blue-800 ring-1 ring-blue-200',
  pro: 'bg-violet-50 text-violet-800 ring-1 ring-violet-200',
  enterprise: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
}

const STATUS_STYLES: Record<string, string> = {
  trialing: 'bg-blue-50 text-blue-800 ring-1 ring-blue-200',
  active: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
  past_due: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
  suspended: 'bg-red-50 text-red-800 ring-1 ring-red-200',
  cancelled: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
  issued: 'bg-blue-50 text-blue-800 ring-1 ring-blue-200',
  paid: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
  overdue: 'bg-red-50 text-red-800 ring-1 ring-red-200',
  voided: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
}

const RISK_STYLES: Record<string, string> = {
  healthy: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
  watch: 'bg-gray-100 text-gray-800 ring-1 ring-gray-200',
  at_risk: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
  critical: 'bg-red-50 text-red-800 ring-1 ring-red-200',
}

export function TierBadge({ tier }: { tier?: string | null }) {
  if (!tier) return <span className="text-gray-500">—</span>
  const style = TIER_STYLES[tier.toLowerCase()] ?? 'bg-gray-100 text-gray-800 ring-1 ring-gray-200'
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${style}`}>
      {tier}
    </span>
  )
}

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="text-gray-500">—</span>
  const style = STATUS_STYLES[status.toLowerCase()] ?? 'bg-gray-100 text-gray-800 ring-1 ring-gray-200'
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

export function RiskBandBadge({ band }: { band?: string | null }) {
  if (!band) return <span className="text-gray-500">—</span>
  const style = RISK_STYLES[band.toLowerCase()] ?? 'bg-gray-100 text-gray-800 ring-1 ring-gray-200'
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${style}`}
    >
      {band.replace(/_/g, ' ')}
    </span>
  )
}
