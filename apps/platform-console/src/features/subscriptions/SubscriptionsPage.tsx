import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchTenants, fetchTenantStatusCounts, TENANT_STATUSES } from '@/lib/api'
import { RiskBandBadge, StatusBadge, TierBadge } from '@/components/Badges'
import { RenewalFilter } from '@/components/RenewalFilter'
import { formatCairoDate, cairoDatePlusDays } from '@/lib/format'

const TIER_OPTIONS = ['starter', 'growth', 'pro', 'enterprise']
const RISK_OPTIONS = ['healthy', 'watch', 'at_risk', 'critical']
const PAGE_SIZE_OPTIONS = [20, 50, 100]

export function SubscriptionsPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()

  const search = params.get('search') ?? ''
  const status = params.get('status') ?? ''
  const tier = params.get('tier') ?? ''
  const riskBand = params.get('riskBand') ?? ''
  const renewingBefore = params.get('renewingBefore') ?? ''
  const page = Number(params.get('page') ?? '1') || 1
  const rawPageSize = Number(params.get('pageSize') ?? '20') || 20
  const pageSize = PAGE_SIZE_OPTIONS.includes(rawPageSize) ? rawPageSize : 20

  const [searchDraft, setSearchDraft] = useState(search)

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = new URLSearchParams(params)
      if (searchDraft) next.set('search', searchDraft)
      else next.delete('search')
      next.set('page', '1')
      setParams(next, { replace: true })
    }, 300)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])

  const countsQuery = useQuery({ queryKey: ['overview', 'tenant-status-counts'], queryFn: fetchTenantStatusCounts })
  const renewingSoonQuery = useQuery({
    queryKey: ['subscriptions', 'renewing-soon-count'],
    queryFn: () => fetchTenants({ renewingBefore: cairoDatePlusDays(30), pageSize: 1 }),
  })

  const queryKey = useMemo(
    () => ['subscriptions', { search, status, tier, riskBand, renewingBefore, page, pageSize }] as const,
    [search, status, tier, riskBand, renewingBefore, page, pageSize],
  )

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      fetchTenants({
        search: search || undefined,
        status: status || undefined,
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

  function toggleCsv(key: 'status' | 'tier' | 'riskBand', value: string) {
    const current = (params.get(key) ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const set = new Set(current)
    if (set.has(value)) set.delete(value)
    else set.add(value)
    patchParams({ [key]: Array.from(set).join(',') || null, page: '1' })
  }

  const selectedStatus = new Set((status || '').split(',').filter(Boolean))
  const selectedTier = new Set((tier || '').split(',').filter(Boolean))
  const selectedRisk = new Set((riskBand || '').split(',').filter(Boolean))
  const colCount = 6

  const kpis: Array<{ label: string; value: number | undefined; loading: boolean; error: boolean; href?: string }> = [
    { label: 'Active', value: countsQuery.data?.byStatus.active, loading: countsQuery.isLoading, error: countsQuery.isError, href: '?status=active' },
    { label: 'Trialing', value: countsQuery.data?.byStatus.trialing, loading: countsQuery.isLoading, error: countsQuery.isError, href: '?status=trialing' },
    { label: 'Past Due', value: countsQuery.data?.byStatus.past_due, loading: countsQuery.isLoading, error: countsQuery.isError, href: '?status=past_due' },
    { label: 'Suspended', value: countsQuery.data?.byStatus.suspended, loading: countsQuery.isLoading, error: countsQuery.isError, href: '?status=suspended' },
    { label: 'Cancelled', value: countsQuery.data?.byStatus.cancelled, loading: countsQuery.isLoading, error: countsQuery.isError, href: '?status=cancelled' },
    {
      label: 'Renewing ≤ 30d',
      value: renewingSoonQuery.data?.totalCount,
      loading: renewingSoonQuery.isLoading,
      error: renewingSoonQuery.isError,
      href: `?renewingBefore=${cairoDatePlusDays(30)}`,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Subscriptions</h1>
        <p className="text-sm text-gray-500">How are all customer subscriptions performing?</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={() => k.href && navigate(k.href)}
            className="rounded-[var(--radius)] border border-gray-200 bg-white p-4 text-left shadow-[var(--shadow-sm)] transition hover:border-blue-200"
          >
            <div className="text-xs uppercase tracking-wide text-gray-500">{k.label}</div>
            {k.loading ? (
              <div className="mt-2 h-7 w-12 animate-pulse rounded bg-gray-200" />
            ) : k.error ? (
              <div className="mt-1 text-lg text-gray-400">—</div>
            ) : (
              <div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{k.value ?? 0}</div>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-gray-200 bg-white p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-700">Search tenant name or gym code</span>
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            className="max-w-md rounded-[var(--radius)] border border-gray-300 bg-white px-3 py-2"
            placeholder="e.g. Fitness or GYM-"
          />
        </label>
        <div className="flex flex-wrap gap-4 text-sm">
          <fieldset>
            <legend className="mb-1 text-gray-500">Status</legend>
            <div className="flex flex-wrap gap-2">
              {TENANT_STATUSES.map((s) => (
                <label key={s} className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1">
                  <input type="checkbox" checked={selectedStatus.has(s)} onChange={() => toggleCsv('status', s)} />
                  {s}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-gray-500">Plan</legend>
            <div className="flex flex-wrap gap-2">
              {TIER_OPTIONS.map((t) => (
                <label key={t} className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1">
                  <input type="checkbox" checked={selectedTier.has(t)} onChange={() => toggleCsv('tier', t)} />
                  {t}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-gray-500">Health</legend>
            <div className="flex flex-wrap gap-2">
              {RISK_OPTIONS.map((r) => (
                <label key={r} className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1">
                  <input type="checkbox" checked={selectedRisk.has(r)} onChange={() => toggleCsv('riskBand', r)} />
                  {r.replace('_', ' ')}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div>
          <div className="mb-1 text-sm text-gray-500">Renewal</div>
          <RenewalFilter value={renewingBefore} onChange={(v) => patchParams({ renewingBefore: v || null, page: '1' })} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-gray-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Tenant</th>
              <th className="px-3 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 font-medium">Price</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Renewal</th>
              <th className="px-3 py-2 font-medium">Health</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-gray-200">
                    {Array.from({ length: colCount }).map((__, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="h-4 animate-pulse rounded bg-gray-200" />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {isError ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-8 text-center text-red-600">
                  {isError && !isLoading ? 'Failed to load subscriptions.' : null}{' '}
                  <button type="button" className="underline" onClick={() => refetch()}>
                    Retry
                  </button>
                </td>
              </tr>
            ) : null}
            {!isLoading && !isError && data?.items.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-8 text-center text-gray-500">
                  No subscriptions match these filters.
                </td>
              </tr>
            ) : null}
            {data?.items.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-t border-gray-200 hover:bg-gray-50"
                onClick={() => navigate(`/tenants/${row.id}?returnTo=${encodeURIComponent(`/subscriptions${params.toString() ? `?${params.toString()}` : ''}`)}`)}
              >
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900">{row.name}</div>
                  <div className="font-[var(--mono)] text-xs text-gray-500">{row.gymCode}</div>
                </td>
                <td className="px-3 py-2">
                  <TierBadge tier={row.planTier} />
                </td>
                <td className="px-3 py-2 text-gray-800">{row.priceEgp != null ? `${row.priceEgp.toLocaleString('en-US')} EGP` : '—'}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-3 py-2 text-gray-700">{formatCairoDate(row.currentPeriodEnd)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <RiskBandBadge band={row.riskBand} />
                    {row.healthScore != null ? (
                      <span className="font-[var(--mono)] text-xs text-gray-500">{row.healthScore}</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        A per-tenant Usage column isn&apos;t shown here — the tenant list endpoint doesn&apos;t
        return a usage percentage per row today (backend change required). Open a tenant to see its
        real usage on the Usage tab. Change Tier / Cancel / Suspend / Reactivate / Extend Trial live
        on the tenant&apos;s own Subscription tab, to avoid a second copy of that logic here — open a
        row to act on it.
      </p>

      {data ? (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            Page {data.page} of {Math.max(data.totalPages, 1)} · {data.totalCount} total
            {isFetching ? ' · updating…' : ''}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!data.hasPrevious}
              className="rounded border border-gray-200 px-3 py-1 disabled:opacity-40"
              onClick={() => patchParams({ page: String(page - 1) })}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!data.hasNext}
              className="rounded border border-gray-200 px-3 py-1 disabled:opacity-40"
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
