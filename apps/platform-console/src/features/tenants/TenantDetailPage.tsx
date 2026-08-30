import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  fetchSubscriptionChanges,
  fetchTenantDetail,
  fetchTenantInvoices,
} from '@/lib/api'
import { StatusBadge, TierBadge } from '@/components/Badges'
import { UsagePanel } from '@/features/tenants/UsagePanel'
import { HealthTab } from '@/features/tenants/HealthTab'
import { TenantOverviewTab } from '@/features/tenants/TenantOverviewTab'
import { TenantBillingTab } from '@/features/tenants/TenantBillingTab'
import { StaffUsersPanel } from '@/features/tenants/StaffUsersPanel'
import { ActionsPanel } from '@/features/tenants/ActionsPanel'
import { ImpersonateButton } from '@/features/tenants/ImpersonateButton'
import { AuditTrailPanel } from '@/features/tenants/AuditTrailPanel'
import { formatCairoDate, formatCairoDateTime, formatEgp } from '@/lib/format'
import { ApiClientError } from '@/lib/api/errors'
import { PLATFORM_TRIAL_DAYS } from '@/lib/platform-plans'

const DETAIL_TABS = ['overview', 'subscription', 'usage', 'health', 'users', 'billing', 'audit'] as const
type DetailTab = (typeof DETAIL_TABS)[number]

function isDetailTab(value: string | null): value is DetailTab {
  return !!value && (DETAIL_TABS as readonly string[]).includes(value)
}

const TAB_LABEL: Record<DetailTab, string> = {
  overview: 'Overview',
  subscription: 'Subscription',
  usage: 'Usage',
  health: 'Health',
  users: 'Users',
  billing: 'Billing',
  audit: 'Audit',
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const end = new Date(iso).getTime()
  if (Number.isNaN(end)) return null
  const ms = end - Date.now()
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

export function TenantDetailPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()

  // Tab selection lives in the URL so deep links, refresh, and back/forward preserve state.
  const activeTab: DetailTab = isDetailTab(params.get('tab')) ? (params.get('tab') as DetailTab) : 'overview'
  function setActiveTab(tab: DetailTab) {
    const next = new URLSearchParams(params)
    if (tab === 'overview') next.delete('tab')
    else next.set('tab', tab)
    setParams(next, { replace: true })
  }

  const returnToRaw = params.get('returnTo')
  const returnTo =
    returnToRaw && returnToRaw.startsWith('/') && !returnToRaw.startsWith('//')
      ? returnToRaw
      : null
  const backParams = new URLSearchParams(params)
  backParams.delete('tab')
  backParams.delete('returnTo')
  const backQuery = backParams.toString()
  const backHref = returnTo ?? `/tenants${backQuery ? `?${backQuery}` : ''}`
  const backLabel = returnTo?.startsWith('/risk-queue')
    ? '← Back to risk queue'
    : returnTo?.startsWith('/subscriptions')
      ? '← Back to subscriptions'
      : returnTo?.startsWith('/trials')
        ? '← Back to trials'
        : '← Back to tenants'

  const detailQuery = useQuery({
    queryKey: ['tenant', id],
    queryFn: () => fetchTenantDetail(id),
    enabled: Boolean(id),
    retry: false,
  })

  const changesQuery = useQuery({
    queryKey: ['tenant-changes', id],
    queryFn: () => fetchSubscriptionChanges(id),
    enabled: Boolean(id) && detailQuery.isSuccess,
  })

  const invoicesQuery = useQuery({
    queryKey: ['tenant-invoices', id],
    queryFn: () => fetchTenantInvoices(id),
    enabled: Boolean(id) && detailQuery.isSuccess,
  })

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
        <div className="h-40 animate-pulse rounded bg-gray-200" />
      </div>
    )
  }

  if (detailQuery.isError) {
    const err = detailQuery.error
    const notFound = err instanceof ApiClientError && err.status === 404
    return (
      <div className="cp-card p-6">
        <h1 className="text-xl font-semibold text-gray-900">
          {notFound ? 'Tenant not found' : 'Failed to load tenant'}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          {notFound
            ? 'This tenant id does not exist or was deleted.'
            : 'Something went wrong loading this tenant.'}
        </p>
        <Link to={backHref} className="mt-4 inline-block text-blue-600 underline">
          Back to list
        </Link>
      </div>
    )
  }

  const tenant = detailQuery.data!
  const sub = tenant.subscription
  const owner = (tenant.users ?? []).find((u) => (u.role ?? '').toLowerCase() === 'owner')
  const trialDaysLeft = sub?.status === 'trialing' ? daysUntil(sub.trialEndsAtUtc ?? sub.currentPeriodEnd) : null
  const initials = tenant.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link to={backHref} className="text-sm font-semibold text-blue-600 hover:underline">
          {backLabel}
        </Link>

        <header className="cp-card mt-3 flex flex-wrap items-start gap-4 p-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-[var(--radius-lg)] bg-blue-600 text-lg font-bold text-white">
            {initials || 'T'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">{tenant.name}</h1>
              <span className="font-[var(--mono)] text-sm text-gray-400">{tenant.gymCode}</span>
              <TierBadge tier={sub?.planTier} />
              <StatusBadge status={sub?.status} />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {tenant.city} · {tenant.email} · {tenant.phoneNumber}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
              {owner ? (
                <span>
                  Owner:{' '}
                  <span className="font-semibold text-gray-800">
                    {owner.fullName}
                    {owner.email ? ` · ${owner.email}` : ''}
                  </span>
                </span>
              ) : (
                <span className="text-gray-400">Owner: —</span>
              )}
              {sub?.status === 'trialing' ? (
                <span>
                  Trial ends {formatCairoDateTime(sub.trialEndsAtUtc ?? sub.currentPeriodEnd)}
                  {trialDaysLeft != null ? (
                    <span className="ml-1 font-semibold text-amber-700">
                      ({trialDaysLeft}d left · default {PLATFORM_TRIAL_DAYS}d config)
                    </span>
                  ) : null}
                </span>
              ) : sub ? (
                <span>
                  Renewal {formatCairoDate(sub.currentPeriodEnd)} · {formatEgp(sub.priceEgp)}
                </span>
              ) : null}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="cp-btn cp-btn-secondary"
              onClick={() => setActiveTab('subscription')}
            >
              Manage subscription
            </button>
            <ImpersonateButton tenant={tenant} />
          </div>
        </header>
      </div>

      <div
        className="flex gap-1 overflow-x-auto border-b border-gray-200"
        role="tablist"
        aria-label="Tenant sections"
      >
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold ${
              activeTab === tab
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {TAB_LABEL[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? <TenantOverviewTab tenant={tenant} onGotoTab={setActiveTab} /> : null}

      {activeTab === 'subscription' ? (
        <div className="flex flex-col gap-6">
          {sub?.status === 'trialing' ? (
            <section className="cp-card border-l-4 border-l-amber-500 p-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-amber-800">Trial</h2>
              <p className="mt-1 text-sm text-gray-600">
                Tenant is in trial. At period end: card on file → <strong>Active</strong>; no card →{' '}
                <strong>Cancelled</strong>.
              </p>
              <div className="trial-rail mt-3">
                <div className="text-xs font-semibold text-gray-500">
                  Started
                  <div className="mt-0.5 font-normal text-gray-700">
                    {formatCairoDate(sub.currentPeriodStart)}
                  </div>
                </div>
                <div>
                  <div className="rail" aria-hidden />
                  <div className="mt-1 text-center text-[11px] font-semibold uppercase text-blue-700">
                    {trialDaysLeft != null ? `${trialDaysLeft} days remaining` : 'In trial'}
                  </div>
                </div>
                <div className="text-right text-xs font-semibold text-amber-700">
                  Ends
                  <div className="mt-0.5 font-normal text-gray-700">
                    {formatCairoDateTime(sub.trialEndsAtUtc ?? sub.currentPeriodEnd)}
                  </div>
                </div>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-gray-500">Plan</dt>
                  <dd className="capitalize font-semibold">{sub.planTier}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Frozen price</dt>
                  <dd className="font-[var(--mono)]">{formatEgp(sub.priceEgp)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Payment method</dt>
                  <dd>{sub.hasPaymentMethodOnFile ? 'Card on file' : 'No card on file'}</dd>
                </div>
              </dl>
            </section>
          ) : null}

          {sub?.status === 'active' ? (
            <section className="cp-card border-l-4 border-l-emerald-500 p-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-emerald-800">Active</h2>
              <p className="mt-1 text-sm text-gray-600">Paid subscription is live and renews at period end.</p>
              {sub.cancelAtPeriodEnd ? (
                <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                  Cancels at period end ({formatCairoDate(sub.currentPeriodEnd)})
                </p>
              ) : null}
              {sub.pendingDowngradeTier ? (
                <p className="mt-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                  Scheduled downgrade to <strong className="capitalize">{sub.pendingDowngradeTier}</strong> at
                  period end ({formatCairoDate(sub.currentPeriodEnd)}).
                </p>
              ) : null}
            </section>
          ) : null}

          {sub?.status === 'past_due' ? (
            <section className="cp-card border-l-4 border-l-orange-500 p-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-orange-800">Past due</h2>
              <p className="mt-1 text-sm text-gray-600">
                Subscription is still live, but payment is overdue. Check the Billing tab for invoice
                state.
              </p>
            </section>
          ) : null}

          {sub?.status === 'suspended' ? (
            <section className="cp-card border-l-4 border-l-red-500 p-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-red-800">Suspended</h2>
              <p className="mt-1 text-sm text-gray-600">
                Access is blocked because the subscription is suspended. Reactivate moves{' '}
                <strong>suspended → active</strong> (does not restore trialing).
              </p>
            </section>
          ) : null}

          {sub?.status === 'cancelled' ? (
            <section className="cp-card border-l-4 border-l-gray-400 p-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">Cancelled</h2>
              <p className="mt-1 text-sm text-gray-600">
                This subscription row is <strong>terminal</strong>. Restart as Paid creates a{' '}
                <strong>new subscription</strong> — it does not resurrect this row.
              </p>
              {sub.cancelledAtUtc ? (
                <p className="mt-2 text-xs text-gray-500">
                  Cancelled {formatCairoDateTime(sub.cancelledAtUtc)}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="cp-card p-4">
            <h2 className="text-lg font-semibold text-gray-900">Subscription details</h2>
            {!sub ? (
              <p className="mt-2 text-sm text-gray-500">No subscription on file.</p>
            ) : (
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-gray-500">Current plan</dt>
                  <dd className="capitalize font-semibold">{sub.planTier}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Frozen price</dt>
                  <dd className="font-[var(--mono)] tabular-nums">{formatEgp(sub.priceEgp)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Status</dt>
                  <dd>
                    <StatusBadge status={sub.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Billing cycle</dt>
                  <dd className="capitalize">{sub.billingCycle}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Period start</dt>
                  <dd>{formatCairoDate(sub.currentPeriodStart)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Renewal / period end</dt>
                  <dd>{formatCairoDate(sub.currentPeriodEnd)}</dd>
                </div>
                {sub.status === 'trialing' && sub.trialEndsAtUtc ? (
                  <div>
                    <dt className="text-gray-500">Trial ends (UTC)</dt>
                    <dd>{formatCairoDateTime(sub.trialEndsAtUtc)}</dd>
                  </div>
                ) : null}
                {sub.pendingDowngradeTier ? (
                  <div>
                    <dt className="text-gray-500">Pending downgrade</dt>
                    <dd className="capitalize font-semibold">{sub.pendingDowngradeTier}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-gray-500">Updated</dt>
                  <dd>{formatCairoDateTime(sub.updatedAtUtc)}</dd>
                </div>
              </dl>
            )}
          </section>

          <ActionsPanel tenant={tenant} />

          <section className="cp-card p-4">
            <h2 className="text-lg font-semibold text-gray-900">Subscription history</h2>
            {changesQuery.isLoading ? (
              <div className="mt-3 h-24 animate-pulse rounded bg-gray-200" />
            ) : changesQuery.isError ? (
              <p className="mt-2 text-sm text-red-600">Failed to load history.</p>
            ) : !changesQuery.data?.length ? (
              <p className="mt-2 text-sm text-gray-500">No changes recorded yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="cp-table min-w-full">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Tier</th>
                      <th>Effective</th>
                      <th>Initiated by</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changesQuery.data.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <StatusBadge status={c.changeType} />
                        </td>
                        <td>
                          {c.fromTier || c.toTier
                            ? `${c.fromTier ?? '—'} ${c.fromTier && c.toTier ? '→' : ''} ${c.toTier ?? ''}`.trim()
                            : '—'}
                        </td>
                        <td>{formatCairoDateTime(c.effectiveAtUtc)}</td>
                        <td className="capitalize">{c.initiatedBy.replace('_', ' ')}</td>
                        <td className="text-gray-500">{c.reason ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {activeTab === 'usage' ? <UsagePanel usageCounters={tenant.usageCounters} /> : null}

      {activeTab === 'health' ? <HealthTab health={tenant.health} /> : null}

      {activeTab === 'users' ? <StaffUsersPanel tenantId={tenant.id} tenantName={tenant.name} /> : null}

      {activeTab === 'billing' ? (
        <TenantBillingTab subscription={sub} invoicesQuery={invoicesQuery} />
      ) : null}

      {activeTab === 'audit' ? <AuditTrailPanel recentAudit={tenant.recentAudit} /> : null}
    </div>
  )
}
