const TIER_STYLES: Record<string, string> = {
  starter: 'bg-slate-700 text-slate-100',
  growth: 'bg-sky-900 text-sky-200',
  pro: 'bg-violet-900 text-violet-200',
  enterprise: 'bg-amber-900 text-amber-100',
}

const STATUS_STYLES: Record<string, string> = {
  trialing: 'bg-blue-900 text-blue-200',
  active: 'bg-emerald-900 text-emerald-200',
  past_due: 'bg-amber-900 text-amber-100',
  suspended: 'bg-red-900 text-red-200',
  cancelled: 'bg-slate-700 text-slate-300',
  issued: 'bg-blue-900 text-blue-200',
  paid: 'bg-emerald-900 text-emerald-200',
  overdue: 'bg-red-900 text-red-200',
  voided: 'bg-slate-700 text-slate-300',
}

const RISK_STYLES: Record<string, string> = {
  healthy: 'bg-emerald-900 text-emerald-200 ring-1 ring-emerald-700/60',
  watch: 'bg-slate-700 text-slate-100 ring-1 ring-slate-500/50',
  at_risk: 'bg-amber-900 text-amber-100 ring-1 ring-amber-700/60',
  critical: 'bg-red-900 text-red-100 ring-1 ring-red-700/70',
}

export function TierBadge({ tier }: { tier?: string | null }) {
  if (!tier) return <span className="text-slate-500">—</span>
  const style = TIER_STYLES[tier.toLowerCase()] ?? 'bg-slate-700 text-slate-200'
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${style}`}>
      {tier}
    </span>
  )
}

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="text-slate-500">—</span>
  const style = STATUS_STYLES[status.toLowerCase()] ?? 'bg-slate-700 text-slate-200'
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

export function RiskBandBadge({ band }: { band?: string | null }) {
  if (!band) return <span className="text-slate-500">—</span>
  const style = RISK_STYLES[band.toLowerCase()] ?? 'bg-slate-700 text-slate-200'
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${style}`}
    >
      {band.replace(/_/g, ' ')}
    </span>
  )
}
