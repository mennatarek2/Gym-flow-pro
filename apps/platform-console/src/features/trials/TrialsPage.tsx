import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchTenants } from '@/lib/api'
import { RiskBandBadge, TierBadge } from '@/components/Badges'
import { RenewalFilter } from '@/components/RenewalFilter'
import { capTone } from '@/features/tenants/UsagePanel'
import { formatCairoDate, formatCairoDateTime, formatEgp, cairoTodayYmd, cairoDatePlusDays } from '@/lib/format'
import { PLATFORM_TRIAL_DAYS } from '@/lib/platform-plans'

/**
 * Trials operational view — reuses GET tenants with status=trialing.
 * No dedicated trials API; filters beyond what the tenant list supports are not invented.
 */
export function TrialsPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()

  const search = params.get('search') ?? ''
  const tier = params.get('tier') ?? ''
  const riskBand = params.get('riskBand') ?? ''
  const renewingBefore = params.get('renewingBefore') ?? ''
  const page = Number(params.get('page') ?? '1') || 1
  const pageSize = 20

  const queryKey = useMemo(
    () => ['tenants', 'trials', { search, tier, riskBand, renewingBefore, page, pageSize }] as const,
    [search, tier, riskBand, renewingBefore, page, pageSize],
  )

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      fetchTenants({
        search: search || undefined,
        status: 'trialing',
        tier: tier || undefined,
        riskBand: riskBand || undefined,
        renewingBefore: renewingBefore || undefined,
        page,
        pageSize,
      }),
  })

  function patchParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => {
      if (!v) next.delete(k)
      else next.set(k, v)
    })
    setParams(next, { replace: true })
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-gray-900">Trials</h1>
          <p className="mt-1 max-w-3xl text-[13.5px] text-gray-500">
            Operational view of tenants in <span className="font-semibold text-gray-700">trialing</span>.
            Default trial length is {PLATFORM_TRIAL_DAYS} days when not specified at provision (custom 1–90 days supported).
          </p>
        </div>
        <Link to="/tenants?status=trialing" className="cp-btn cp-btn-secondary">
          Open in Tenants
        </Link>
      </header>

      <div className="trial-rail cp-card px-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Created
          <div className="mt-0.5 text-[11px] font-normal normal-case text-gray-400">Start</div>
        </div>
        <div>
          <div className="rail" aria-hidden />
          <div className="mt-1 text-center text-[11px] font-semibold uppercase tracking-wide text-blue-700">
            Trial window
          </div>
        </div>
        <div className="text-right text-xs font-semibold uppercase tracking-wide text-amber-700">
          Ends
          <div className="mt-0.5 text-[11px] font-normal normal-case text-gray-400">
            Renewal / action
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { label: 'All', patch: { renewingBefore: null, riskBand: null } },
          { label: 'Ending today', patch: { renewingBefore: cairoTodayYmd(), riskBand: null } },
          { label: 'Ending in 3 days', patch: { renewingBefore: cairoDatePlusDays(3), riskBand: null } },
          { label: 'Ending in 7 days', patch: { renewingBefore: cairoDatePlusDays(7), riskBand: null } },
          { label: 'Ending in 14 days', patch: { renewingBefore: cairoDatePlusDays(14), riskBand: null } },
          { label: 'Healthy', patch: { renewingBefore: null, riskBand: 'healthy' } },
          { label: 'At risk', patch: { renewingBefore: null, riskBand: 'at_risk' } },
        ].map((chip) => (
          <button
            key={chip.label}
            type="button"
            className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:border-blue-300 hover:text-blue-700"
            onClick={() => patchParams({ ...chip.patch, page: '1' })}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 rounded-[var(--radius-lg)] border border-gray-200 bg-white p-3 shadow-[var(--shadow-sm)]">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
          <span className="text-gray-500">Search</span>
          <input
            className="cp-input"
            value={search}
            onChange={(e) => patchParams({ search: e.target.value || null, page: '1' })}
            placeholder="Gym name / code"
          />
        </label>
        <div>
          <div className="mb-1 text-sm text-gray-500">Ending before (trial / period end)</div>
          <RenewalFilter
            value={renewingBefore}
            onChange={(v) => patchParams({ renewingBefore: v || null, page: '1' })}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-gray-200 bg-white shadow-[var(--shadow-sm)]">
        <table className="cp-table min-w-[960px]">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Owner</th>
              <th>Plan</th>
              <th>Trial started</th>
              <th>Trial ends</th>
              <th>Members</th>
              <th>Health</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j}>
                        <div className="h-4 animate-pulse rounded bg-gray-200" />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {isError ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-red-600">
                  Failed to load trials.{' '}
                  <button type="button" className="underline" onClick={() => refetch()}>
                    Retry
                  </button>
                </td>
              </tr>
            ) : null}
            {!isLoading && !isError && data?.items.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-gray-500">
                  No trialing tenants match these filters.
                </td>
              </tr>
            ) : null}
            {data?.items.map((row) => (
              <tr
                key={row.id}
                tabIndex={0}
                onClick={() =>
                  navigate(`/tenants/${row.id}?tab=subscription&returnTo=/trials?${params.toString()}`)
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    navigate(
                      `/tenants/${row.id}?tab=subscription&returnTo=/trials?${params.toString()}`,
                    )
                  }
                }}
              >
                <td>
                  <div className="font-semibold text-gray-900">{row.name}</div>
                  <div className="font-[var(--mono)] text-xs text-gray-400">{row.gymCode}</div>
                </td>
                <td className="text-sm text-gray-700">
                  {row.ownerName ? (
                    <>
                      <div>{row.ownerName}</div>
                      {row.ownerEmail ? (
                        <div className="text-xs text-gray-400">{row.ownerEmail}</div>
                      ) : null}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <TierBadge tier={row.planTier} />
                </td>
                <td className="tabular-nums text-gray-700">
                  {formatCairoDate(row.currentPeriodStart ?? null)}
                </td>
                <td className="tabular-nums text-gray-700">
                  {row.trialEndsAtUtc
                    ? formatCairoDateTime(row.trialEndsAtUtc)
                    : formatCairoDate(row.currentPeriodEnd)}
                </td>
                <td>
                  {row.memberCount == null ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    (() => {
                      const tone = capTone(row.memberCount!, row.memberCap ?? null)
                      const toneClass =
                        tone === 'red'
                          ? 'text-red-600'
                          : tone === 'amber'
                            ? 'text-amber-700'
                            : 'text-gray-800'
                      return (
                        <span className={`font-[var(--mono)] tabular-nums ${toneClass}`}>
                          {row.memberCount!.toLocaleString('en-US')}
                          {row.memberCap != null ? ` / ${row.memberCap.toLocaleString('en-US')}` : ' / ∞'}
                        </span>
                      )
                    })()
                  )}
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <RiskBandBadge band={row.riskBand} />
                    <span className="font-[var(--mono)] tabular-nums text-gray-400">
                      {row.healthScore == null ? '—' : row.healthScore}
                    </span>
                  </div>
                </td>
                <td className="tabular-nums">{formatEgp(row.priceEgp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data ? (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            Page {data.page} of {Math.max(data.totalPages, 1)} · {data.totalCount} trialing
            {isFetching ? ' · updating…' : ''}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!data.hasPrevious}
              className="cp-btn cp-btn-secondary"
              onClick={() => patchParams({ page: String(page - 1) })}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!data.hasNext}
              className="cp-btn cp-btn-secondary"
              onClick={() => patchParams({ page: String(page + 1) })}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
