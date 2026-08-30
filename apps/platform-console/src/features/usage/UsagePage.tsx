import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchUsageSummary } from '@/lib/api'
import { ApiClientError } from '@/lib/api/errors'
import { metricLabel, formatUsagePeriodLabel } from '@/features/tenants/UsagePanel'
import type { PlatformUsageSummaryDto } from '@/lib/api/types'
import { formatCairoDateTime } from '@/lib/format'
import { groupByLimitTier, limitTier, LIMIT_TIER_BADGE, LIMIT_TIER_LABEL, type LimitTier } from '@/lib/usage-limits'

const TIER_LABEL = LIMIT_TIER_LABEL
const TIER_BADGE = LIMIT_TIER_BADGE
const groupByTier = groupByLimitTier

export function UsagePage() {
  const query = useQuery({
    queryKey: ['usage-summary'],
    queryFn: fetchUsageSummary,
  })

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Usage</h1>
        <p className="text-sm text-gray-500">
          Monitor platform-wide resource consumption and tenants approaching their limits.
        </p>
      </header>

      {query.isLoading ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-[var(--radius)] bg-gray-200" />
            ))}
          </div>
          <div className="h-40 animate-pulse rounded-[var(--radius)] bg-gray-200" />
        </div>
      ) : query.isError ? (
        <p role="alert" className="rounded-[var(--radius)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {query.error instanceof ApiClientError ? query.error.message : 'Failed to load usage summary.'}{' '}
          <button type="button" className="underline" onClick={() => query.refetch()}>
            Retry
          </button>
        </p>
      ) : query.data ? (
        <UsageSummaryContent data={query.data} />
      ) : null}
    </div>
  )
}

function UsageSummaryContent({ data }: { data: PlatformUsageSummaryDto }) {
  const groups = groupByTier(data.tenantsNearLimit)
  const hasNearLimit = data.tenantsNearLimit.length > 0

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium text-gray-900">
            Totals — {formatUsagePeriodLabel(data.period)}
          </h2>
          <p className="text-xs text-gray-500">{formatCairoDateTime(data.computedAtUtc)}</p>
        </div>
        {data.totals.length === 0 ? (
          <p className="text-sm text-gray-500">No usage counters recorded for this period yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.totals.map((t) => (
              <div key={t.metric} className="rounded-[var(--radius)] border border-gray-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">{metricLabel(t.metric)}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
                  {t.totalCount.toLocaleString('en-US')}
                </div>
                <div className="mt-1 text-xs text-gray-500">across {t.tenantCount} tenants</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium text-gray-900">Approaching Limits</h2>
        {!hasNearLimit ? (
          <p className="rounded-[var(--radius)] border border-dashed border-gray-200 bg-white/40 px-4 py-6 text-center text-sm text-gray-500">
            No tenants are approaching their usage limits right now.
          </p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row">
            {(['approaching', 'critical', 'exceeded'] as LimitTier[]).map((tier) => (
              <div key={tier} className="flex-1 rounded-[var(--radius)] border border-gray-200 bg-white p-4">
                <div className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TIER_BADGE[tier]}`}>
                  {TIER_LABEL[tier]}
                </div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-gray-900">
                  {groups[tier].length}
                </div>
                <div className="text-xs text-gray-500">tenant × metric pairs</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium text-gray-900">Tenants Near Limit</h2>
        {!hasNearLimit ? (
          <p className="text-sm text-gray-500">Nothing to show — no tenant is at or above 80% of any cap.</p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius)] border border-gray-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Tenant</th>
                  <th className="px-3 py-2 font-medium">Metric</th>
                  <th className="px-3 py-2 font-medium">Count</th>
                  <th className="px-3 py-2 font-medium">Cap</th>
                  <th className="px-3 py-2 font-medium">% of Cap</th>
                </tr>
              </thead>
              <tbody>
                {data.tenantsNearLimit.map((row, i) => {
                  const tier = limitTier(row.percentOfCap)
                  return (
                    <tr key={`${row.tenantId}-${row.metric}-${i}`} className="border-t border-gray-200">
                      <td className="px-3 py-2">
                        <Link
                          to={`/tenants/${row.tenantId}`}
                          className="font-medium text-blue-600 underline-offset-2 hover:underline"
                        >
                          {row.tenantName}
                        </Link>
                        <span className="ml-2 font-[var(--mono)] text-xs text-gray-500">{row.gymCode}</span>
                      </td>
                      <td className="px-3 py-2 font-[var(--mono)] text-gray-700">{metricLabel(row.metric)}</td>
                      <td className="px-3 py-2 tabular-nums">{row.count.toLocaleString('en-US')}</td>
                      <td className="px-3 py-2 tabular-nums">{row.cap.toLocaleString('en-US')}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TIER_BADGE[tier]}`}>
                          {row.percentOfCap}%
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
