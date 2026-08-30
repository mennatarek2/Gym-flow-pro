import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchTenants } from '@/lib/api'
import { RiskBandBadge, StatusBadge, TierBadge } from '@/components/Badges'
import { RenewalFilter } from '@/components/RenewalFilter'
import { capTone } from '@/features/tenants/UsagePanel'
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
  const renewingBefore = params.get('renewingBefore') ?? ''
  const hasSubscriptionParam = params.get('hasSubscription') ?? ''
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
    () => ['tenants', { search, status, tier, riskBand, renewingBefore, hasSubscriptionParam, page, pageSize }] as const,
    [search, status, tier, riskBand, renewingBefore, hasSubscriptionParam, page, pageSize],
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
        hasSubscription:
          hasSubscriptionParam === 'false' ? false : hasSubscriptionParam === 'true' ? true : undefined,
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
  const colCount = 9

  const showOrphanBillingCallout = hasSubscriptionParam === 'false'

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-gray-900">Tenants</h1>
          <p className="mt-1 text-[13.5px] text-gray-500">
            Lifecycle control plane — open a row for subscription, usage, health, users, billing, and
            audit.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span title={canProvision ? undefined : 'Requires Platform Ops'}>
            <button
              type="button"
              disabled={!canProvision}
              onClick={() => setProvisionOpen(true)}
              aria-disabled={!canProvision}
              className="cp-btn cp-btn-primary disabled:cursor-not-allowed"
            >
              Create Tenant
            </button>
          </span>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <span className="text-gray-500">Rows</span>
            <select
              value={pageSize}
              onChange={(e) => patchParams({ pageSize: e.target.value, page: '1' })}
              className="cp-input w-auto py-1"
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
          className="rounded-[var(--radius)] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          No billing subscription on these gyms — provision StartTrial or open Platform Ops checklist.
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-gray-200 bg-white p-4 shadow-[var(--shadow-sm)]">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600">Search gym name / code</span>
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            className="cp-input max-w-md"
            placeholder="e.g. Cairo or GYM-"
          />
        </label>
        <div className="flex flex-wrap gap-4 text-sm">
          <fieldset>
            <legend className="mb-1 text-gray-500">Status</legend>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((s) => (
                <label
                  key={s}
                  className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-1"
                >
                  <input
                    type="checkbox"
                    checked={selectedStatus.has(s)}
                    onChange={() => toggleCsv('status', s)}
                  />
                  {s.replace('_', ' ')}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-gray-500">Plan</legend>
            <div className="flex flex-wrap gap-2">
              {TIER_OPTIONS.map((t) => (
                <label
                  key={t}
                  className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 capitalize"
                >
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
            <legend className="mb-1 text-gray-500">Health / risk</legend>
            <div className="flex flex-wrap gap-2">
              {RISK_OPTIONS.map((r) => (
                <label
                  key={r}
                  className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-1"
                >
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
        <div>
          <div className="mb-1 text-sm text-gray-500">Renewal</div>
          <RenewalFilter value={renewingBefore} onChange={(v) => patchParams({ renewingBefore: v || null, page: '1' })} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-gray-200 bg-white shadow-[var(--shadow-sm)]">
        <table className="cp-table min-w-[1100px]">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Owner</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Members</th>
              <th>Renewal</th>
              <th>Health</th>
              <th>Last Login</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: colCount }).map((__, j) => (
                      <td key={j}>
                        <div className="h-4 animate-pulse rounded bg-gray-200" />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {isError ? (
              <tr>
                <td colSpan={colCount} className="py-8 text-center text-red-600">
                  Failed to load tenants.{' '}
                  <button type="button" className="underline" onClick={() => refetch()}>
                    Retry
                  </button>
                </td>
              </tr>
            ) : null}
            {!isLoading && !isError && data?.items.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="py-8 text-center text-gray-500">
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
                tabIndex={0}
                onClick={() => navigate(`/tenants/${row.id}?${params.toString()}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') navigate(`/tenants/${row.id}?${params.toString()}`)
                }}
              >
                <td>
                  <div className="font-semibold text-gray-900">{row.name}</div>
                  <div className="font-[var(--mono)] text-xs text-gray-400">{row.gymCode}</div>
                </td>
                <td>
                  {row.ownerName ? (
                    <>
                      <div className="text-gray-800">{row.ownerName}</div>
                      <div className="text-xs text-gray-400">{row.ownerEmail}</div>
                    </>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td>
                  <TierBadge tier={row.planTier} />
                </td>
                <td>
                  <StatusBadge status={row.status} />
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
                <td className="tabular-nums text-gray-700">{formatCairoDate(row.currentPeriodEnd)}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <RiskBandBadge band={row.riskBand} />
                    <span className="font-[var(--mono)] tabular-nums text-gray-400">
                      {row.healthScore == null ? '—' : row.healthScore}
                    </span>
                  </div>
                </td>
                <td className="text-gray-600">{formatCairoDateTime(row.lastLoginAtUtc)}</td>
                <td className="tabular-nums text-gray-800">{formatEgp(row.priceEgp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

      <p className="sr-only">
        <Link to="/tenants">Tenants list</Link>
      </p>
    </div>
  )
}
