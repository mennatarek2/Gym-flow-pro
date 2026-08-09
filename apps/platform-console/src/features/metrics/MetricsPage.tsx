import { useEffect, useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  fetchChurnMetrics,
  fetchConversionMetrics,
  fetchMrr,
  fetchMrrMovement,
  fetchTierDistribution,
} from '@/lib/api'
import { ApiClientError } from '@/lib/api/errors'
import {
  cairoMonthStartYmd,
  cairoTodayYmd,
  formatCairoDate,
  formatCairoDateTime,
  formatEgp,
  formatPercent,
} from '@/lib/format'

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <section className="border-t border-slate-800 pt-6 first:border-t-0 first:pt-0">
      <header className="mb-3">
        <h2 className="text-lg font-semibold text-slate-50">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p> : null}
      </header>
      {children}
    </section>
  )
}

function MetricStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-50">{value}</div>
    </div>
  )
}

function QueryState({
  isLoading,
  isError,
  error,
  onRetry,
  children,
}: {
  isLoading: boolean
  isError: boolean
  error: unknown
  onRetry: () => void
  children: ReactNode
}) {
  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded bg-slate-800/80" />
        ))}
      </div>
    )
  }
  if (isError) {
    const msg =
      error instanceof ApiClientError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to load'
    return (
      <p role="alert" className="text-sm text-red-300">
        {msg}{' '}
        <button type="button" className="underline" onClick={onRetry}>
          Retry
        </button>
      </p>
    )
  }
  return <>{children}</>
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function MetricsPage() {
  const [params, setParams] = useSearchParams()
  const defaults = useMemo(
    () => ({
      asOf: cairoTodayYmd(),
      from: cairoMonthStartYmd(),
      to: cairoTodayYmd(),
    }),
    [],
  )

  const asOf = params.get('asOf') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''

  // Seed URL with Cairo defaults once if missing.
  useEffect(() => {
    const next = new URLSearchParams(params)
    let changed = false
    if (!params.get('asOf')) {
      next.set('asOf', defaults.asOf)
      changed = true
    }
    if (!params.get('from')) {
      next.set('from', defaults.from)
      changed = true
    }
    if (!params.get('to')) {
      next.set('to', defaults.to)
      changed = true
    }
    if (changed) setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const effectiveAsOf = isYmd(asOf) ? asOf : defaults.asOf
  const rangeValid = isYmd(from) && isYmd(to) && from <= to
  const rangeError =
    !from || !to
      ? 'from and to are required for movement, churn, and conversion.'
      : !isYmd(from) || !isYmd(to)
        ? 'Use yyyy-MM-dd for from and to.'
        : from > to
          ? 'from must be on or before to.'
          : null

  function patchDates(patch: Record<string, string>) {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => {
      if (v) next.set(k, v)
      else next.delete(k)
    })
    setParams(next, { replace: true })
  }

  const mrrQuery = useQuery({
    queryKey: ['metrics', 'mrr', effectiveAsOf],
    queryFn: () => fetchMrr(effectiveAsOf),
  })

  const tierQuery = useQuery({
    queryKey: ['metrics', 'tier-distribution', effectiveAsOf],
    queryFn: () => fetchTierDistribution(effectiveAsOf),
  })

  const movementQuery = useQuery({
    queryKey: ['metrics', 'movement', from, to],
    queryFn: () => fetchMrrMovement(from, to),
    enabled: rangeValid,
  })

  const churnQuery = useQuery({
    queryKey: ['metrics', 'churn', from, to],
    queryFn: () => fetchChurnMetrics(from, to),
    enabled: rangeValid,
  })

  const conversionQuery = useQuery({
    queryKey: ['metrics', 'conversion', from, to],
    queryFn: () => fetchConversionMetrics(from, to),
    enabled: rangeValid,
  })

  const tierMax = Math.max(1, ...(tierQuery.data?.tiers.map((t) => t.mrrEgp) ?? [0]))

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-50">Metrics</h1>
        <p className="text-sm text-slate-400">
          SaaS billing health — MRR uses PriceEgp/12 for annual plans (already server-side).
        </p>
      </header>

      <div className="flex flex-wrap gap-4 border-b border-slate-800 pb-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">As of (Cairo)</span>
          <input
            type="date"
            value={asOf || defaults.asOf}
            onChange={(e) => patchDates({ asOf: e.target.value })}
            className="rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Range from</span>
          <input
            type="date"
            value={from || defaults.from}
            onChange={(e) => patchDates({ from: e.target.value })}
            className="rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Range to</span>
          <input
            type="date"
            value={to || defaults.to}
            onChange={(e) => patchDates({ to: e.target.value })}
            className="rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2"
          />
        </label>
      </div>

      <Section
        title="MRR / ARR"
        subtitle={`Snapshot as of ${formatCairoDate(effectiveAsOf)}`}
      >
        <QueryState
          isLoading={mrrQuery.isLoading}
          isError={mrrQuery.isError}
          error={mrrQuery.error}
          onRetry={() => mrrQuery.refetch()}
        >
          {mrrQuery.data ? (
            mrrQuery.data.payingTenantCount === 0 ? (
              <p className="text-sm text-slate-400">No paying tenants as of this date.</p>
            ) : (
              <div className="grid gap-6 sm:grid-cols-3">
                <MetricStat label="MRR" value={formatEgp(mrrQuery.data.mrrEgp)} />
                <MetricStat label="ARR" value={formatEgp(mrrQuery.data.arrEgp)} />
                <MetricStat
                  label="Paying tenants"
                  value={String(mrrQuery.data.payingTenantCount)}
                />
                <p className="sm:col-span-3 text-xs text-slate-500">
                  Computed {formatCairoDateTime(mrrQuery.data.computedAtUtc)}
                </p>
              </div>
            )
          ) : null}
        </QueryState>
      </Section>

      <Section
        title="MRR movement"
        subtitle={
          rangeValid
            ? `${formatCairoDate(from)} → ${formatCairoDate(to)}`
            : 'Set a valid date range'
        }
      >
        {rangeError ? (
          <p role="alert" className="text-sm text-amber-200">
            {rangeError}
          </p>
        ) : (
          <QueryState
            isLoading={movementQuery.isLoading}
            isError={movementQuery.isError}
            error={movementQuery.error}
            onRetry={() => movementQuery.refetch()}
          >
            {movementQuery.data ? (
              <div className="grid gap-6 sm:grid-cols-3 lg:grid-cols-5">
                <MetricStat label="New" value={formatEgp(movementQuery.data.newMrrEgp)} />
                <MetricStat label="Expansion" value={formatEgp(movementQuery.data.expansionMrrEgp)} />
                <MetricStat
                  label="Contraction"
                  value={formatEgp(movementQuery.data.contractionMrrEgp)}
                />
                <MetricStat label="Churned" value={formatEgp(movementQuery.data.churnedMrrEgp)} />
                <MetricStat label="Ending" value={formatEgp(movementQuery.data.endingMrrEgp)} />
                <p className="sm:col-span-3 lg:col-span-5 text-xs text-slate-500">
                  Starting {formatEgp(movementQuery.data.startingMrrEgp)}
                  {' · '}
                  Direct end {formatEgp(movementQuery.data.endingMrrDirectEgp)}
                  {' · '}
                  {movementQuery.data.reconciles ? 'Reconciles' : 'Does not reconcile'}
                </p>
              </div>
            ) : null}
          </QueryState>
        )}
      </Section>

      <Section title="Churn" subtitle={rangeValid ? undefined : 'Set a valid date range'}>
        {rangeError ? (
          <p role="alert" className="text-sm text-amber-200">
            {rangeError}
          </p>
        ) : (
          <QueryState
            isLoading={churnQuery.isLoading}
            isError={churnQuery.isError}
            error={churnQuery.error}
            onRetry={() => churnQuery.refetch()}
          >
            {churnQuery.data ? (
              <div className="flex flex-col gap-4">
                <div className="grid gap-6 sm:grid-cols-3">
                  <MetricStat
                    label="Gross churn rate"
                    value={formatPercent(churnQuery.data.grossChurnRate)}
                  />
                  <MetricStat
                    label="Churned MRR"
                    value={formatEgp(churnQuery.data.churnedMrrEgp)}
                  />
                  <MetricStat
                    label="Churned tenants"
                    value={`${churnQuery.data.churnedTenants} / ${churnQuery.data.startingPayingTenants} start`}
                  />
                </div>
                {churnQuery.data.cohorts.length > 0 ? (
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-slate-300">
                      Signup cohorts (as of period end)
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead className="text-slate-400">
                          <tr>
                            <th className="py-1 pr-4 font-medium">Cohort</th>
                            <th className="py-1 pr-4 font-medium">Signed up</th>
                            <th className="py-1 pr-4 font-medium">Still paying</th>
                            <th className="py-1 font-medium">Retention</th>
                          </tr>
                        </thead>
                        <tbody>
                          {churnQuery.data.cohorts.map((c) => (
                            <tr key={c.cohortMonth} className="border-t border-slate-800">
                              <td className="py-1.5 pr-4 font-[var(--mono)] text-slate-200">
                                {c.cohortMonth}
                              </td>
                              <td className="py-1.5 pr-4 tabular-nums">{c.signedUp}</td>
                              <td className="py-1.5 pr-4 tabular-nums">{c.retainedPaying}</td>
                              <td className="py-1.5 tabular-nums">
                                {formatPercent(c.retentionRate)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No cohort rows for this range.</p>
                )}
              </div>
            ) : null}
          </QueryState>
        )}
      </Section>

      <Section
        title="Trial → paid conversion"
        subtitle={rangeValid ? undefined : 'Set a valid date range'}
      >
        {rangeError ? (
          <p role="alert" className="text-sm text-amber-200">
            {rangeError}
          </p>
        ) : (
          <QueryState
            isLoading={conversionQuery.isLoading}
            isError={conversionQuery.isError}
            error={conversionQuery.error}
            onRetry={() => conversionQuery.refetch()}
          >
            {conversionQuery.data ? (
              conversionQuery.data.trialsStarted === 0 ? (
                <p className="text-sm text-slate-400">No trials started in this range.</p>
              ) : (
                <div className="grid gap-6 sm:grid-cols-3">
                  <MetricStat
                    label="Trials started"
                    value={String(conversionQuery.data.trialsStarted)}
                  />
                  <MetricStat
                    label="Converted to paid"
                    value={String(conversionQuery.data.convertedToPaid)}
                  />
                  <MetricStat
                    label="Conversion rate"
                    value={formatPercent(conversionQuery.data.conversionRate)}
                  />
                </div>
              )
            ) : null}
          </QueryState>
        )}
      </Section>

      <Section
        title="Tier distribution"
        subtitle={`Paying mix as of ${formatCairoDate(effectiveAsOf)}`}
      >
        <QueryState
          isLoading={tierQuery.isLoading}
          isError={tierQuery.isError}
          error={tierQuery.error}
          onRetry={() => tierQuery.refetch()}
        >
          {tierQuery.data ? (
            tierQuery.data.totalPayingTenants === 0 ? (
              <p className="text-sm text-slate-400">No paying tenants as of this date.</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid gap-6 sm:grid-cols-2">
                  <MetricStat label="Total MRR" value={formatEgp(tierQuery.data.totalMrrEgp)} />
                  <MetricStat
                    label="Paying tenants"
                    value={String(tierQuery.data.totalPayingTenants)}
                  />
                </div>
                <ul className="flex flex-col gap-3">
                  {tierQuery.data.tiers.map((row) => {
                    const pct = Math.round((row.mrrEgp / tierMax) * 100)
                    return (
                      <li key={row.planTier}>
                        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                          <span className="capitalize text-slate-200">{row.planTier}</span>
                          <span className="tabular-nums text-slate-400">
                            {row.tenantCount} · {formatEgp(row.mrrEgp)}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded bg-slate-800">
                          <div
                            className="h-full bg-sky-700"
                            style={{ width: `${pct}%` }}
                            title={`${pct}% of max tier MRR`}
                          />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          ) : null}
        </QueryState>
      </Section>
    </div>
  )
}
