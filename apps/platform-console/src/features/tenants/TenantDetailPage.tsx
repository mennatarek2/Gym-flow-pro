import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  fetchSubscriptionChanges,
  fetchTenantDetail,
  fetchTenantInvoices,
} from '@/lib/api'
import { StatusBadge, TierBadge } from '@/components/Badges'
import { UsagePanel } from '@/features/tenants/UsagePanel'
import { HealthScorePanel } from '@/features/tenants/HealthScorePanel'
import { ActionsPanel } from '@/features/tenants/ActionsPanel'
import { ImpersonateButton } from '@/features/tenants/ImpersonateButton'
import { AuditTrailPanel } from '@/features/tenants/AuditTrailPanel'
import { formatCairoDate, formatCairoDateTime, formatEgp } from '@/lib/format'
import { ApiClientError } from '@/lib/api/errors'

export function TenantDetailPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const returnToRaw = params.get('returnTo')
  const returnTo =
    returnToRaw && returnToRaw.startsWith('/') && !returnToRaw.startsWith('//')
      ? returnToRaw
      : null
  const backQuery = params.toString()
  const backHref = returnTo ?? `/tenants${backQuery ? `?${backQuery}` : ''}`
  const backLabel = returnTo?.startsWith('/risk-queue') ? '← Back to risk queue' : '← Back to tenants'

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
        <div className="h-8 w-64 animate-pulse rounded bg-slate-800" />
        <div className="h-40 animate-pulse rounded bg-slate-800" />
      </div>
    )
  }

  if (detailQuery.isError) {
    const err = detailQuery.error
    const notFound = err instanceof ApiClientError && err.status === 404
    return (
      <div className="rounded-[var(--radius)] border border-slate-700 bg-slate-900/60 p-6">
        <h1 className="text-xl font-semibold">{notFound ? 'Tenant not found' : 'Failed to load tenant'}</h1>
        <p className="mt-2 text-sm text-slate-400">
          {notFound
            ? 'This tenant id does not exist or was deleted.'
            : 'Something went wrong loading this tenant.'}
        </p>
        <Link to={backHref} className="mt-4 inline-block underline">
          Back to list
        </Link>
      </div>
    )
  }

  const tenant = detailQuery.data!
  const sub = tenant.subscription

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to={backHref} className="text-sm text-slate-400 underline">
          {backLabel}
        </Link>
        <header className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-50">{tenant.name}</h1>
          <span className="font-[var(--mono)] text-slate-400">{tenant.gymCode}</span>
          <TierBadge tier={sub?.planTier} />
          <StatusBadge status={sub?.status} />
          <div className="ml-auto">
            <ImpersonateButton tenant={tenant} />
          </div>
        </header>
        <p className="mt-1 text-sm text-slate-400">
          {tenant.city} · {tenant.email} · {tenant.phoneNumber}
        </p>
      </div>

      <section className="rounded-[var(--radius)] border border-slate-700 bg-slate-900/50 p-4">
        <h2 className="text-lg font-medium">Subscription</h2>
        {!sub ? (
          <p className="mt-2 text-sm text-slate-400">No subscription on file.</p>
        ) : (
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            <div>
              <dt className="text-slate-500">Period start</dt>
              <dd>{formatCairoDate(sub.currentPeriodStart)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Period end</dt>
              <dd>{formatCairoDate(sub.currentPeriodEnd)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Billing cycle</dt>
              <dd className="capitalize">{sub.billingCycle}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Price</dt>
              <dd>{formatEgp(sub.priceEgp)}</dd>
            </div>
            {sub.status === 'trialing' && sub.trialEndsAtUtc ? (
              <div>
                <dt className="text-slate-500">Trial ends</dt>
                <dd>{formatCairoDateTime(sub.trialEndsAtUtc)}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-slate-500">Updated</dt>
              <dd>{formatCairoDateTime(sub.updatedAtUtc)}</dd>
            </div>
          </dl>
        )}
        {sub?.cancelAtPeriodEnd ? (
          <p className="mt-4 rounded border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
            This subscription will end on {formatCairoDate(sub.currentPeriodEnd)} and will not renew.
          </p>
        ) : null}
      </section>

      <UsagePanel usageCounters={tenant.usageCounters} />

      <HealthScorePanel health={tenant.health} />

      <ActionsPanel tenant={tenant} />

      <AuditTrailPanel recentAudit={tenant.recentAudit} />

      <section className="rounded-[var(--radius)] border border-slate-700 bg-slate-900/50 p-4">
        <h2 className="text-lg font-medium">Subscription history</h2>
        {changesQuery.isLoading ? (
          <div className="mt-3 h-24 animate-pulse rounded bg-slate-800" />
        ) : changesQuery.isError ? (
          <p className="mt-2 text-sm text-red-300">Failed to load history.</p>
        ) : !changesQuery.data?.length ? (
          <p className="mt-2 text-sm text-slate-400">No changes recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="px-2 py-1">Type</th>
                  <th className="px-2 py-1">Tier</th>
                  <th className="px-2 py-1">Effective</th>
                  <th className="px-2 py-1">Initiated by</th>
                  <th className="px-2 py-1">Reason</th>
                </tr>
              </thead>
              <tbody>
                {changesQuery.data.map((c) => (
                  <tr key={c.id} className="border-t border-slate-800">
                    <td className="px-2 py-2">
                      <StatusBadge status={c.changeType} />
                    </td>
                    <td className="px-2 py-2">
                      {c.fromTier || c.toTier
                        ? `${c.fromTier ?? '—'} ${c.fromTier && c.toTier ? '→' : ''} ${c.toTier ?? ''}`.trim()
                        : '—'}
                    </td>
                    <td className="px-2 py-2">{formatCairoDateTime(c.effectiveAtUtc)}</td>
                    <td className="px-2 py-2 capitalize">{c.initiatedBy.replace('_', ' ')}</td>
                    <td className="px-2 py-2 text-slate-400">{c.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-[var(--radius)] border border-slate-700 bg-slate-900/50 p-4">
        <h2 className="text-lg font-medium">Invoices</h2>
        {invoicesQuery.isLoading ? (
          <div className="mt-3 h-24 animate-pulse rounded bg-slate-800" />
        ) : invoicesQuery.isError ? (
          <p className="mt-2 text-sm text-red-300">Failed to load invoices.</p>
        ) : !invoicesQuery.data?.length ? (
          <p className="mt-2 text-sm text-slate-400">No platform invoices yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="px-2 py-1">Invoice</th>
                  <th className="px-2 py-1">Period</th>
                  <th className="px-2 py-1">Total</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Due</th>
                  <th className="px-2 py-1">Paid</th>
                  <th className="px-2 py-1">PDF</th>
                </tr>
              </thead>
              <tbody>
                {invoicesQuery.data.map((inv) => (
                  <tr key={inv.id} className="border-t border-slate-800">
                    <td className="px-2 py-2 font-[var(--mono)]">{inv.invoiceNumber}</td>
                    <td className="px-2 py-2">
                      {formatCairoDate(inv.periodStart)} – {formatCairoDate(inv.periodEnd)}
                    </td>
                    <td className="px-2 py-2">{formatEgp(inv.total)}</td>
                    <td className="px-2 py-2">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-2 py-2">{formatCairoDate(inv.dueDate)}</td>
                    <td className="px-2 py-2">{inv.paidAtUtc ? formatCairoDateTime(inv.paidAtUtc) : '—'}</td>
                    <td className="px-2 py-2">
                      {inv.pdfUrl ? (
                        <a href={inv.pdfUrl} target="_blank" rel="noreferrer" className="underline">
                          View PDF
                        </a>
                      ) : (
                        <span className="text-slate-500">Not ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
