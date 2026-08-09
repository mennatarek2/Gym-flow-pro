import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchTenants } from '@/lib/api'
import { RiskBandBadge, StatusBadge, TierBadge } from '@/components/Badges'
import { formatCairoDate, formatCairoDateTime, formatEgp } from '@/lib/format'
import { isOpsOrAbove } from '@/lib/platform-roles'
import { useAuthStore } from '@/stores/auth-store'
import { ProvisionGymDialog } from './ProvisionGymDialog'

const STATUS_OPTIONS = ['trialing', 'active', 'past_due', 'suspended', 'cancelled']
const TIER_OPTIONS = ['starter', 'growth', 'pro', 'enterprise']
const RISK_OPTIONS = ['healthy', 'watch', 'at_risk', 'critical']
const PAGE_SIZE_OPTIONS = [20, 50, 100]

export function TenantsListPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.user?.role)
  const canProvision = isOpsOrAbove(role)
  const [provisionOpen, setProvisionOpen] = useState(false)

  const search = params.get('search') ?? ''
  const status = params.get('status') ?? ''
  const tier = params.get('tier') ?? ''
  const riskBand = params.get('riskBand') ?? ''
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

  const queryKey = useMemo(
    () => ['tenants', { search, status, tier, riskBand, page, pageSize }] as const,
    [search, status, tier, riskBand, page, pageSize],
  )

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      fetchTenants({
        search: search || undefined,
        status: status || undefined,
        tier: tier || undefined,
        riskBand: riskBand || undefined,
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
    const current = (params.get(key) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const set = new Set(current)
    if (set.has(value)) set.delete(value)
    else set.add(value)
    const joined = Array.from(set).join(',')
    patchParams({ [key]: joined || null, page: '1' })
  }

  const selectedStatus = new Set((status || '').split(',').filter(Boolean))
  const selectedTier = new Set((tier || '').split(',').filter(Boolean))
  const selectedRisk = new Set((riskBand || '').split(',').filter(Boolean))
  const colCount = 10

  const showOrphanBillingCallout =
    !!data &&
    data.totalCount > 0 &&
    data.items.length > 0 &&
    data.items.every((row) => !row.status && !row.planTier)

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">Tenants</h1>
          <p className="text-sm text-slate-400">
            Platform gyms — open a row for billing, health, and ops actions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span title={canProvision ? undefined : 'Requires Platform Ops'}>
            <button
              type="button"
              disabled={!canProvision}
              onClick={() => setProvisionOpen(true)}
              aria-disabled={!canProvision}
              className="rounded-[var(--radius)] bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Provision gym
            </button>
          </span>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <span className="text-slate-400">Rows</span>
            <select
              value={pageSize}
              onChange={(e) => patchParams({ pageSize: e.target.value, page: '1' })}
              className="rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-2 py-1"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <ProvisionGymDialog open={provisionOpen} onClose={() => setProvisionOpen(false)} />

      {showOrphanBillingCallout ? (
        <div
          role="status"
          className="rounded-[var(--radius)] border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-100"
        >
          No billing subscription on these gyms — provision StartTrial or open Platform Ops checklist.
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-slate-700 bg-slate-900/50 p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-300">Search gym name / code</span>
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            className="max-w-md rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2"
            placeholder="e.g. Cairo or GYM-"
          />
        </label>
        <div className="flex flex-wrap gap-4 text-sm">
          <fieldset>
            <legend className="mb-1 text-slate-400">Status</legend>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((s) => (
                <label key={s} className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1">
                  <input
                    type="checkbox"
                    checked={selectedStatus.has(s)}
                    onChange={() => toggleCsv('status', s)}
                  />
                  {s}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-slate-400">Tier</legend>
            <div className="flex flex-wrap gap-2">
              {TIER_OPTIONS.map((t) => (
                <label key={t} className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1">
                  <input
                    type="checkbox"
                    checked={selectedTier.has(t)}
                    onChange={() => toggleCsv('tier', t)}
                  />
                  {t}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-slate-400">Risk band</legend>
            <div className="flex flex-wrap gap-2">
              {RISK_OPTIONS.map((r) => (
                <label key={r} className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1">
                  <input
                    type="checkbox"
                    checked={selectedRisk.has(r)}
                    onChange={() => toggleCsv('riskBand', r)}
                  />
                  {r.replace('_', ' ')}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-slate-700">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium">Gym Name</th>
              <th className="px-3 py-2 font-medium">Gym Code</th>
              <th className="px-3 py-2 font-medium">Tier</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Risk</th>
              <th className="px-3 py-2 font-medium">Score</th>
              <th className="px-3 py-2 font-medium">Last login</th>
              <th className="px-3 py-2 font-medium">Billing Cycle</th>
              <th className="px-3 py-2 font-medium">Period End</th>
              <th className="px-3 py-2 font-medium">Price</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    {Array.from({ length: colCount }).map((__, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="h-4 animate-pulse rounded bg-slate-800" />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {isError ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-8 text-center text-red-300">
                  Failed to load tenants.{' '}
                  <button type="button" className="underline" onClick={() => refetch()}>
                    Retry
                  </button>
                </td>
              </tr>
            ) : null}
            {!isLoading && !isError && data?.items.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-8 text-center text-slate-400">
                  No tenants match these filters.{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setSearchDraft('')
                      setParams({}, { replace: true })
                    }}
                  >
                    Clear filters
                  </button>
                </td>
              </tr>
            ) : null}
            {data?.items.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-t border-slate-800 hover:bg-slate-900/80"
                onClick={() => navigate(`/tenants/${row.id}?${params.toString()}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') navigate(`/tenants/${row.id}?${params.toString()}`)
                }}
                tabIndex={0}
              >
                <td className="px-3 py-2 font-medium text-slate-100">{row.name}</td>
                <td className="px-3 py-2 font-[var(--mono)] text-slate-300">{row.gymCode}</td>
                <td className="px-3 py-2">
                  <TierBadge tier={row.planTier} />
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-3 py-2">
                  <RiskBandBadge band={row.riskBand} />
                </td>
                <td className="px-3 py-2 font-[var(--mono)] tabular-nums text-slate-300">
                  {row.healthScore == null ? '—' : row.healthScore}
                </td>
                <td className="px-3 py-2 text-slate-300">{formatCairoDateTime(row.lastLoginAtUtc)}</td>
                <td className="px-3 py-2 capitalize text-slate-300">{row.billingCycle ?? '—'}</td>
                <td className="px-3 py-2 text-slate-300">{formatCairoDate(row.currentPeriodEnd)}</td>
                <td className="px-3 py-2 text-slate-200">{formatEgp(row.priceEgp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data ? (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            Page {data.page} of {Math.max(data.totalPages, 1)} · {data.totalCount} total
            {isFetching ? ' · updating…' : ''}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!data.hasPrevious}
              className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40"
              onClick={() => patchParams({ page: String(page - 1) })}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!data.hasNext}
              className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40"
              onClick={() => patchParams({ page: String(page + 1) })}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      <p className="sr-only">
        <Link to="/tenants">Tenants list</Link>
      </p>
    </div>
  )
}
