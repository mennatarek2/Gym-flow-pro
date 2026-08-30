import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  fetchAuditLog,
  fetchChurnMetrics,
  fetchMrr,
  fetchMrrMovement,
  fetchRiskQueue,
  fetchTenantStatusCounts,
  fetchTenants,
  fetchUsageSummary,
} from '@/lib/api'
import { ApiClientError } from '@/lib/api/errors'
import { RiskBandBadge } from '@/components/Badges'
import { labelAuditAction } from '@/features/tenants/AuditTrailPanel'
import { groupByLimitTier, limitTier, LIMIT_TIER_BADGE, LIMIT_TIER_LABEL, type LimitTier } from '@/lib/usage-limits'
import {
  cairoDatePlusDays,
  cairoMonthStartYmd,
  cairoTodayYmd,
  formatCairoDate,
  formatCairoDateTime,
  formatEgp,
  formatPercent,
} from '@/lib/format'

/** Small per-widget shell — an independent query failing here never takes the rest of the dashboard down. */
function Widget({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-[var(--radius)] border border-gray-200 bg-white p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-gray-900">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  )
}

function WidgetState({
  isLoading,
  isError,
  error,
  onRetry,
  isEmpty,
  emptyLabel,
  children,
}: {
  isLoading: boolean
  isError: boolean
  error?: unknown
  onRetry: () => void
  isEmpty?: boolean
  emptyLabel?: string
  children: ReactNode
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-gray-200" />
        ))}
      </div>
    )
  }
  if (isError) {
    const msg = error instanceof ApiClientError ? error.message : 'Failed to load.'
    return (
      <p role="alert" className="text-sm text-red-600">
        {msg}{' '}
        <button type="button" className="underline" onClick={onRetry}>
          Retry
        </button>
      </p>
    )
  }
  if (isEmpty) {
    return <p className="text-sm text-gray-500">{emptyLabel ?? 'Nothing to show.'}</p>
  }
  return <>{children}</>
}

function KpiTile({ label, value, isLoading, isError }: { label: string; value: string; isLoading: boolean; isError: boolean }) {
  return (
    <div className="rounded-[var(--radius)] border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      {isLoading ? (
        <div className="mt-2 h-7 w-20 animate-pulse rounded bg-gray-200" />
      ) : isError ? (
        <div className="mt-1 text-lg text-gray-400">—</div>
      ) : (
        <div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{value}</div>
      )}
    </div>
  )
}

export function OverviewPage() {
  const churnRange = { from: cairoMonthStartYmd(), to: cairoTodayYmd() }

  const countsQuery = useQuery({ queryKey: ['overview', 'tenant-status-counts'], queryFn: fetchTenantStatusCounts })
  const mrrQuery = useQuery({ queryKey: ['metrics', 'mrr', cairoTodayYmd()], queryFn: () => fetchMrr() })
  const churnQuery = useQuery({
    queryKey: ['metrics', 'churn', churnRange.from, churnRange.to],
    queryFn: () => fetchChurnMetrics(churnRange.from, churnRange.to),
  })
  const movementQuery = useQuery({
    queryKey: ['metrics', 'movement', churnRange.from, churnRange.to],
    queryFn: () => fetchMrrMovement(churnRange.from, churnRange.to),
  })

  const healthyQuery = useQuery({
    queryKey: ['overview', 'risk-count', 'healthy'],
    queryFn: () => fetchTenants({ riskBand: 'healthy', pageSize: 1 }),
  })
  const watchQuery = useQuery({
    queryKey: ['overview', 'risk-count', 'watch'],
    queryFn: () => fetchTenants({ riskBand: 'watch', pageSize: 1 }),
  })
  const atRiskQuery = useQuery({
    queryKey: ['overview', 'risk-count', 'at_risk,critical'],
    queryFn: () => fetchTenants({ riskBand: 'at_risk,critical', pageSize: 1 }),
  })

  const riskQueueQuery = useQuery({ queryKey: ['risk-queue', { band: '' }], queryFn: () => fetchRiskQueue() })

  const renewing7Query = useQuery({
    queryKey: ['overview', 'renewing', 7],
    queryFn: () => fetchTenants({ renewingBefore: cairoDatePlusDays(7), pageSize: 1 }),
  })
  const renewing30Query = useQuery({
    queryKey: ['overview', 'renewing', 30],
    queryFn: () => fetchTenants({ renewingBefore: cairoDatePlusDays(30), pageSize: 1 }),
  })

  const orphanedQuery = useQuery({
    queryKey: ['overview', 'orphaned-provisioning'],
    queryFn: () => fetchTenants({ hasSubscription: false, pageSize: 1 }),
  })

  const usageQuery = useQuery({ queryKey: ['usage-summary'], queryFn: fetchUsageSummary })
  const auditQuery = useQuery({
    queryKey: ['audit-log', { page: 1, pageSizeForDashboard: true }],
    queryFn: () => fetchAuditLog({ page: 1, pageSize: 6 }),
  })

  const usageGroups = usageQuery.data ? groupByLimitTier(usageQuery.data.tenantsNearLimit) : null
  const worstUsageRows = usageQuery.data
    ? [...usageQuery.data.tenantsNearLimit].sort((a, b) => b.percentOfCap - a.percentOfCap).slice(0, 5)
    : []

  const sortedRiskRows = riskQueueQuery.data ? [...riskQueueQuery.data].sort((a, b) => a.score - b.score) : []
  const highestRisk = sortedRiskRows.slice(0, 5)
  const unassignedCount = riskQueueQuery.data?.filter((r) => !r.assignedPlatformUserId).length ?? 0
  const assignedCount = (riskQueueQuery.data?.length ?? 0) - unassignedCount

  const pastDueCount = countsQuery.data?.byStatus.past_due ?? 0
  const trialCount = countsQuery.data?.byStatus.trialing ?? 0
  const atRiskCount = atRiskQuery.data?.totalCount ?? 0
  const renewing7 = renewing7Query.data?.totalCount ?? 0
  const usageAlertCount = usageQuery.data?.tenantsNearLimit.length ?? 0
  const orphanedCount = orphanedQuery.data?.totalCount ?? 0

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[22px] font-bold tracking-tight text-gray-900">Dashboard</h1>
        <p className="mt-1 text-[13.5px] text-gray-500">
          What needs attention today — risk, trials, renewals, usage, and past due — then commercial
          KPIs.
        </p>
      </header>

      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">
          What needs attention
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Link
            to="/risk-queue"
            className="rounded-[var(--radius-lg)] border border-gray-200 border-l-[3px] border-l-red-500 bg-white p-3.5 shadow-[var(--shadow-sm)] hover:border-blue-200"
          >
            <div className="text-xs font-semibold text-gray-500">Risk queue</div>
            <div className="mt-1 text-[26px] font-bold tabular-nums tracking-tight text-gray-900">
              {atRiskQuery.isLoading ? '…' : atRiskCount}
            </div>
            <div className="text-[11.5px] text-gray-400">at_risk + critical</div>
          </Link>
          <Link
            to="/trials"
            className="rounded-[var(--radius-lg)] border border-gray-200 border-l-[3px] border-l-amber-500 bg-white p-3.5 shadow-[var(--shadow-sm)] hover:border-blue-200"
          >
            <div className="text-xs font-semibold text-gray-500">Trials</div>
            <div className="mt-1 text-[26px] font-bold tabular-nums tracking-tight text-gray-900">
              {countsQuery.isLoading ? '…' : trialCount}
            </div>
            <div className="text-[11.5px] text-gray-400">status = trialing</div>
          </Link>
          <Link
            to={`/subscriptions?renewingBefore=${cairoDatePlusDays(7)}`}
            className="rounded-[var(--radius-lg)] border border-gray-200 border-l-[3px] border-l-amber-500 bg-white p-3.5 shadow-[var(--shadow-sm)] hover:border-blue-200"
          >
            <div className="text-xs font-semibold text-gray-500">Renewals (7d)</div>
            <div className="mt-1 text-[26px] font-bold tabular-nums tracking-tight text-gray-900">
              {renewing7Query.isLoading ? '…' : renewing7}
            </div>
            <div className="text-[11.5px] text-gray-400">period end within 7 days</div>
          </Link>
          <Link
            to="/usage"
            className="rounded-[var(--radius-lg)] border border-gray-200 border-l-[3px] border-l-blue-500 bg-white p-3.5 shadow-[var(--shadow-sm)] hover:border-blue-200"
          >
            <div className="text-xs font-semibold text-gray-500">Usage alerts</div>
            <div className="mt-1 text-[26px] font-bold tabular-nums tracking-tight text-gray-900">
              {usageQuery.isLoading ? '…' : usageAlertCount}
            </div>
            <div className="text-[11.5px] text-gray-400">near / over cap</div>
          </Link>
          <Link
            to="/tenants?status=past_due"
            className="rounded-[var(--radius-lg)] border border-gray-200 border-l-[3px] border-l-red-500 bg-white p-3.5 shadow-[var(--shadow-sm)] hover:border-blue-200"
          >
            <div className="text-xs font-semibold text-gray-500">Past due</div>
            <div className="mt-1 text-[26px] font-bold tabular-nums tracking-tight text-gray-900">
              {countsQuery.isLoading ? '…' : pastDueCount}
            </div>
            <div className="text-[11.5px] text-gray-400">subscription status</div>
          </Link>
          <Link
            to="/tenants?hasSubscription=false"
            className="rounded-[var(--radius-lg)] border border-gray-200 border-l-[3px] border-l-violet-500 bg-white p-3.5 shadow-[var(--shadow-sm)] hover:border-blue-200"
          >
            <div className="text-xs font-semibold text-gray-500">Orphaned provisioning</div>
            <div className="mt-1 text-[26px] font-bold tabular-nums tracking-tight text-gray-900">
              {orphanedQuery.isLoading ? '…' : orphanedCount}
            </div>
            <div className="text-[11.5px] text-gray-400">no subscription row</div>
          </Link>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile
          label="MRR"
          value={mrrQuery.data ? formatEgp(mrrQuery.data.mrrEgp) : '—'}
          isLoading={mrrQuery.isLoading}
          isError={mrrQuery.isError}
        />
        <KpiTile
          label="ARR"
          value={mrrQuery.data ? formatEgp(mrrQuery.data.arrEgp) : '—'}
          isLoading={mrrQuery.isLoading}
          isError={mrrQuery.isError}
        />
        <KpiTile
          label="Total Tenants"
          value={countsQuery.data ? String(countsQuery.data.total) : '—'}
          isLoading={countsQuery.isLoading}
          isError={countsQuery.isError}
        />
        <KpiTile
          label="Active"
          value={countsQuery.data ? String(countsQuery.data.byStatus.active) : '—'}
          isLoading={countsQuery.isLoading}
          isError={countsQuery.isError}
        />
        <KpiTile
          label="Trials"
          value={countsQuery.data ? String(countsQuery.data.byStatus.trialing) : '—'}
          isLoading={countsQuery.isLoading}
          isError={countsQuery.isError}
        />
        <KpiTile
          label="Gross Churn (MTD)"
          value={churnQuery.data ? formatPercent(churnQuery.data.grossChurnRate) : '—'}
          isLoading={churnQuery.isLoading}
          isError={churnQuery.isError}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Widget title="Revenue / MRR movement" action={<Link to="/metrics" className="text-sm text-blue-600 underline-offset-2 hover:underline">View Metrics →</Link>}>
          <WidgetState
            isLoading={movementQuery.isLoading}
            isError={movementQuery.isError}
            error={movementQuery.error}
            onRetry={() => movementQuery.refetch()}
          >
            {movementQuery.data ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <div className="text-xs text-gray-500">New</div>
                  <div className="text-lg font-semibold tabular-nums text-emerald-700">
                    {formatEgp(movementQuery.data.newMrrEgp)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Expansion</div>
                  <div className="text-lg font-semibold tabular-nums text-emerald-700">
                    {formatEgp(movementQuery.data.expansionMrrEgp)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Contraction</div>
                  <div className="text-lg font-semibold tabular-nums text-amber-800">
                    {formatEgp(movementQuery.data.contractionMrrEgp)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Churned</div>
                  <div className="text-lg font-semibold tabular-nums text-red-600">
                    {formatEgp(movementQuery.data.churnedMrrEgp)}
                  </div>
                </div>
              </div>
            ) : null}
          </WidgetState>
        </Widget>

        <Widget
          title="Customer Health"
          action={
            <Link to="/risk-queue" className="text-sm text-blue-600 underline-offset-2 hover:underline">
              View Risk Queue →
            </Link>
          }
        >
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Healthy', q: healthyQuery, tone: 'text-emerald-700' },
              { label: 'Needs Attention', q: watchQuery, tone: 'text-amber-800' },
              { label: 'At Risk', q: atRiskQuery, tone: 'text-red-600' },
            ].map(({ label, q, tone }) => (
              <Link
                key={label}
                to={
                  label === 'Healthy'
                    ? '/tenants?riskBand=healthy'
                    : label === 'Needs Attention'
                      ? '/tenants?riskBand=watch'
                      : '/risk-queue'
                }
                className="rounded-[var(--radius)] border border-gray-200 p-3 transition hover:border-gray-300"
              >
                <div className="text-xs text-gray-500">{label}</div>
                {q.isLoading ? (
                  <div className="mt-1 h-6 w-10 animate-pulse rounded bg-gray-200" />
                ) : q.isError ? (
                  <div className={`mt-1 text-lg text-gray-400`}>—</div>
                ) : (
                  <div className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{q.data?.totalCount ?? 0}</div>
                )}
              </Link>
            ))}
          </div>
        </Widget>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Widget
          title="Risk"
          action={
            <Link to="/risk-queue" className="text-sm text-blue-600 underline-offset-2 hover:underline">
              View Risk Queue →
            </Link>
          }
        >
          <WidgetState
            isLoading={riskQueueQuery.isLoading}
            isError={riskQueueQuery.isError}
            error={riskQueueQuery.error}
            onRetry={() => riskQueueQuery.refetch()}
            isEmpty={!riskQueueQuery.isLoading && highestRisk.length === 0}
            emptyLabel="No tenants in at_risk or critical right now."
          >
            <div className="mb-3 flex gap-4 text-sm text-gray-500">
              <span>
                Assigned <span className="font-semibold text-gray-800">{assignedCount}</span>
              </span>
              <span>
                Unassigned <span className="font-semibold text-amber-800">{unassignedCount}</span>
              </span>
            </div>
            <ul className="flex flex-col divide-y divide-gray-200">
              {highestRisk.map((r) => (
                <li key={r.tenantId} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link to={`/tenants/${r.tenantId}?returnTo=${encodeURIComponent('/overview')}`} className="text-blue-600 underline-offset-2 hover:underline">
                    {r.name}
                  </Link>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-gray-700">{r.score}</span>
                    <RiskBandBadge band={r.riskBand} />
                  </div>
                </li>
              ))}
            </ul>
          </WidgetState>
        </Widget>

        <Widget title="Renewals" action={<Link to="/subscriptions" className="text-sm text-blue-600 underline-offset-2 hover:underline">View Subscriptions →</Link>}>
          <div className="grid grid-cols-2 gap-3">
            <Link to={`/subscriptions?renewingBefore=${cairoDatePlusDays(7)}`} className="rounded-[var(--radius)] border border-gray-200 p-3 transition hover:border-gray-300">
              <div className="text-xs text-gray-500">Next 7 days</div>
              {renewing7Query.isLoading ? (
                <div className="mt-1 h-6 w-10 animate-pulse rounded bg-gray-200" />
              ) : renewing7Query.isError ? (
                <div className="mt-1 text-lg text-gray-400">—</div>
              ) : (
                <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900">
                  {renewing7Query.data?.totalCount ?? 0}
                </div>
              )}
            </Link>
            <Link to={`/subscriptions?renewingBefore=${cairoDatePlusDays(30)}`} className="rounded-[var(--radius)] border border-gray-200 p-3 transition hover:border-gray-300">
              <div className="text-xs text-gray-500">Next 30 days</div>
              {renewing30Query.isLoading ? (
                <div className="mt-1 h-6 w-10 animate-pulse rounded bg-gray-200" />
              ) : renewing30Query.isError ? (
                <div className="mt-1 text-lg text-gray-400">—</div>
              ) : (
                <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900">
                  {renewing30Query.data?.totalCount ?? 0}
                </div>
              )}
            </Link>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            "Recently cancelled" isn't shown — there's no date-bounded cancellation query on the
            tenant list today; the status filter alone can't tell "cancelled last week" from
            "cancelled 6 months ago."
          </p>
        </Widget>
      </div>

      <Widget
        title="Usage Alerts"
        action={<Link to="/usage" className="text-sm text-blue-600 underline-offset-2 hover:underline">View Usage →</Link>}
      >
        <WidgetState
          isLoading={usageQuery.isLoading}
          isError={usageQuery.isError}
          error={usageQuery.error}
          onRetry={() => usageQuery.refetch()}
          isEmpty={!usageQuery.isLoading && worstUsageRows.length === 0}
          emptyLabel="No tenants are approaching their usage limits."
        >
          <div className="mb-3 flex flex-wrap gap-3">
            {usageGroups
              ? (['approaching', 'critical', 'exceeded'] as LimitTier[]).map((tier) => (
                  <span key={tier} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${LIMIT_TIER_BADGE[tier]}`}>
                    {LIMIT_TIER_LABEL[tier]}: {usageGroups[tier].length}
                  </span>
                ))
              : null}
          </div>
          <ul className="flex flex-col divide-y divide-gray-200">
            {worstUsageRows.map((row, i) => (
              <li key={`${row.tenantId}-${row.metric}-${i}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                <Link to={`/tenants/${row.tenantId}?tab=usage`} className="text-blue-600 underline-offset-2 hover:underline">
                  {row.tenantName} <span className="text-xs text-gray-500">({row.metric.replace(/_/g, ' ')})</span>
                </Link>
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${LIMIT_TIER_BADGE[limitTier(row.percentOfCap)]}`}>
                  {row.percentOfCap}%
                </span>
              </li>
            ))}
          </ul>
        </WidgetState>
      </Widget>

      <Widget
        title="Recent Platform Activity"
        action={<Link to="/audit" className="text-sm text-blue-600 underline-offset-2 hover:underline">View Audit Log →</Link>}
      >
        <WidgetState
          isLoading={auditQuery.isLoading}
          isError={auditQuery.isError}
          error={auditQuery.error}
          onRetry={() => auditQuery.refetch()}
          isEmpty={!auditQuery.isLoading && (auditQuery.data?.items.length ?? 0) === 0}
          emptyLabel="No recent platform activity."
        >
          <ul className="flex flex-col divide-y divide-gray-200">
            {auditQuery.data?.items.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <div className="text-gray-800">{labelAuditAction(row.action)}</div>
                  <div className="text-xs text-gray-500">
                    {row.tenantName ?? row.gymCode ?? 'Platform-level'} · {row.actorName ?? 'Unknown actor'}
                  </div>
                </div>
                <span className="whitespace-nowrap text-xs text-gray-500">{formatCairoDateTime(row.createdAtUtc)}</span>
              </li>
            ))}
          </ul>
        </WidgetState>
      </Widget>

      <p className="text-xs text-gray-500">
        Snapshot as of {formatCairoDate(cairoTodayYmd())}. Churn is month-to-date; each section above
        loads and fails independently.
      </p>
    </div>
  )
}
