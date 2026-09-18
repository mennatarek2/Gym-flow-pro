import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  authorizeLocalLicenseTransfer,
  changeContractStatus,
  createSupportTicket,
  fetchCustomerPayments,
  fetchCustomerProfile,
  fetchSupportTickets,
  initiateOwnerPasswordReset,
  updateCustomer,
  updateSupportTicket,
} from '@/lib/api'
import { ApiClientError } from '@/lib/api/errors'
import { formatCairoDateTime, formatEgp } from '@/lib/format'
import { isOpsOrAbove, isSalesOrAbove, isSupportOrAbove, MIN_REASON_LENGTH, validateReason } from '@/lib/platform-roles'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'
import { NEXT_CONTRACT_STATUS, StatusChip } from './status'

const TABS = ['overview', 'licenses', 'installations', 'sales', 'support', 'activity'] as const
type Tab = (typeof TABS)[number]

function errMsg(err: unknown, t: (k: string) => string) {
  if (err instanceof ApiClientError) return err.status === 403 ? t('errors.forbidden') : err.message
  return t('errors.generic')
}

export function CustomerProfilePage() {
  const { id = '' } = useParams()
  const t = useUiStore((s) => s.t)
  const showToast = useUiStore((s) => s.showToast)
  const role = useAuthStore((s) => s.user?.role)
  const canWrite = isSalesOrAbove(role)
  const canReset = isOpsOrAbove(role)
  const canTicket = isSupportOrAbove(role) || canWrite
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [resetReason, setResetReason] = useState('')
  const [ticketSubject, setTicketSubject] = useState('')
  const [ticketBody, setTicketBody] = useState('')
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replaceReason, setReplaceReason] = useState('')
  const [replaceError, setReplaceError] = useState<string | null>(null)

  const profileQuery = useQuery({
    queryKey: ['customer-profile', id],
    queryFn: () => fetchCustomerProfile(id),
    enabled: Boolean(id),
  })
  const paymentsQuery = useQuery({
    queryKey: ['customer-payments', id],
    queryFn: () => fetchCustomerPayments(id),
    enabled: Boolean(id),
  })
  const ticketsQuery = useQuery({
    queryKey: ['customer-tickets', id],
    queryFn: () => fetchSupportTickets(id),
    enabled: Boolean(id),
  })

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['customer-profile', id] }),
      queryClient.invalidateQueries({ queryKey: ['customer-tickets', id] }),
      queryClient.invalidateQueries({ queryKey: ['customer-payments', id] }),
      queryClient.invalidateQueries({ queryKey: ['platform-customers'] }),
      queryClient.invalidateQueries({ queryKey: ['local-licenses'] }),
    ])

  const resetMutation = useMutation({
    mutationFn: () => initiateOwnerPasswordReset(id, { reason: resetReason.trim() }),
    onSuccess: async (result) => {
      showToast(result.message, 'success')
      setResetReason('')
      await invalidate()
    },
    onError: (err) => showToast(errMsg(err, t), 'error'),
  })

  const ticketMutation = useMutation({
    mutationFn: () =>
      createSupportTicket({
        customerId: id,
        contractId: profileQuery.data?.latestContract?.id,
        localLicenseId: profileQuery.data?.license?.id,
        localInstallationId: profileQuery.data?.installation?.id,
        subject: ticketSubject.trim(),
        description: ticketBody.trim(),
      }),
    onSuccess: async () => {
      showToast(t('support.created'), 'success')
      setTicketSubject('')
      setTicketBody('')
      await invalidate()
    },
    onError: (err) => showToast(errMsg(err, t), 'error'),
  })

  const transferMutation = useMutation({
    mutationFn: (licenseId: string) =>
      authorizeLocalLicenseTransfer(licenseId, { reason: replaceReason.trim() }),
    onSuccess: async () => {
      showToast(t('gyms.replacePcDone'), 'success')
      setReplaceOpen(false)
      setReplaceReason('')
      setReplaceError(null)
      await invalidate()
    },
    onError: (err) => setReplaceError(errMsg(err, t)),
  })

  const statusMutation = useMutation({
    mutationFn: ({ contractId, status }: { contractId: string; status: string }) =>
      changeContractStatus(contractId, { status }),
    onSuccess: async () => {
      showToast(t('contracts.statusChanged'), 'success')
      await invalidate()
    },
    onError: (err) => showToast(errMsg(err, t), 'error'),
  })

  if (profileQuery.isLoading) return <div className="text-sm text-gray-500">{t('common.loading')}</div>
  if (profileQuery.isError || !profileQuery.data) {
    return (
      <div className="flex flex-col gap-3">
        <Link to="/gyms" className="text-sm text-[var(--accent)] hover:underline">
          ← {t('customers.backGyms')}
        </Link>
        <div className="rounded-[var(--radius)] border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-800">
          {profileQuery.error instanceof ApiClientError ? profileQuery.error.message : t('customers.notFound')}
        </div>
      </div>
    )
  }

  const p = profileQuery.data
  const c = p.customer
  const licenses = p.licenses?.length ? p.licenses : p.license ? [p.license] : []
  const replaceLicense =
    licenses.find((row) => row.activeInstallationCount > 0) ?? licenses.find((row) => row.status === 'active') ?? null
  const canReplacePc = isOpsOrAbove(role) && Boolean(replaceLicense)

  return (
    <div className="flex flex-col gap-4">
      <Link to="/gyms" className="text-sm text-[var(--accent)] hover:underline">
        ← {t('customers.backGyms')}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="cp-page-title">{c.businessName}</h1>
          <p className="text-sm text-gray-500">
            {c.ownerName}
            {c.phone ? ` · ${c.phone}` : ''}
            {c.leadSource ? ` · ${t('customers.leadSource')}: ${c.leadSource}` : ''}
          </p>
          {c.tenantId && isSupportOrAbove(role) ? (
            <p className="mt-1 text-sm">
              <Link to={`/tenants/${c.tenantId}`} className="text-[var(--accent)] hover:underline">
                {t('gyms.alsoCloud')}
              </Link>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip value={c.status} />
          {canReplacePc ? (
            <button type="button" className="cp-btn cp-btn-secondary" onClick={() => { setReplaceOpen(true); setReplaceReason(''); setReplaceError(null) }}>
              {t('gyms.replacePc')}
            </button>
          ) : null}
          <Link to="/ops-playbooks" className="cp-btn cp-btn-ghost">
            {t('gyms.help')}
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label={t('customers.contract')} value={p.latestContract?.contractNumber ?? '—'} />
        <SummaryCard label={t('customers.license')} value={p.license?.licenseKey ?? '—'} />
        <SummaryCard label={t('customers.installation')} value={p.installation?.installationId ?? '—'} />
        <SummaryCard
          label={t('customers.financial')}
          value={`${formatEgp(p.paidAmount)} / ${formatEgp(p.contractTotal)}`}
          hint={p.paymentStatus}
        />
      </div>

      <div className="cp-tabs" role="tablist">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`cp-tab${tab === key ? ' is-active' : ''}`}
          >
            {t(`customers.tab.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="rounded-[var(--radius)] border border-gray-200 bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold text-gray-900">{t('customers.contact')}</h2>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-gray-700">
              <dt className="text-gray-500">{t('customers.email')}</dt>
              <dd>{c.email || '—'}</dd>
              <dt className="text-gray-500">{t('customers.whatsapp')}</dt>
              <dd>{c.whatsApp || '—'}</dd>
              <dt className="text-gray-500">{t('customers.address')}</dt>
              <dd>{c.address || '—'}</dd>
              <dt className="text-gray-500">{t('customers.preferredContact')}</dt>
              <dd>{c.preferredContactMethod || '—'}</dd>
              <dt className="text-gray-500">{t('customers.notes')}</dt>
              <dd>{c.notes || '—'}</dd>
            </dl>
          </section>
          <section className="rounded-[var(--radius)] border border-gray-200 bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold text-gray-900">{t('customers.snapshot')}</h2>
            <ul className="space-y-1 text-gray-700">
              <li>
                {t('customers.openTickets')}: {p.openSupportTicketCount}
              </li>
              <li>
                {t('customers.lastValidation')}: {p.lastValidation ? formatCairoDateTime(p.lastValidation) : '—'}
              </li>
              <li>
                {t('customers.ownerAccount')}: {c.ownerEmail || c.ownerUsername || '—'} ({c.ownerAccountStatus})
              </li>
            </ul>
            {canReset ? (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <p className="mb-2 text-xs text-gray-500">{t('customers.resetHint')}</p>
                <textarea
                  value={resetReason}
                  onChange={(e) => setResetReason(e.target.value)}
                  rows={2}
                  className="w-full rounded-[var(--radius)] border border-gray-300 px-3 py-2"
                  placeholder={t('customers.resetReason')}
                />
                <button
                  type="button"
                  disabled={resetReason.trim().length < MIN_REASON_LENGTH || resetMutation.isPending}
                  onClick={() => resetMutation.mutate()}
                  className="mt-2 rounded-[var(--radius)] border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  {t('customers.resetPassword')}
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === 'sales' ? (
        <div className="flex flex-col gap-4">
          <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-white p-4">
            {p.latestContract ? (
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="cp-mono font-semibold">{p.latestContract.contractNumber}</span>
                  <StatusChip value={p.latestContract.status} />
                  <StatusChip value={p.latestContract.paymentStatus} />
                </div>
                <div>
                  {formatEgp(p.latestContract.total)} · {t('customers.outstanding')}: {formatEgp(p.latestContract.outstandingAmount)}
                </div>
                {c.leadSource ? (
                  <div className="text-[var(--text-muted)]">
                    {t('customers.leadSource')}: {c.leadSource}
                  </div>
                ) : null}
                {canWrite ? (
                  <div className="flex flex-wrap gap-2">
                    {(NEXT_CONTRACT_STATUS[p.latestContract.status] ?? []).map((next) => (
                      <button
                        key={next}
                        type="button"
                        disabled={statusMutation.isPending}
                        onClick={() => statusMutation.mutate({ contractId: p.latestContract!.id, status: next })}
                        className="cp-btn cp-btn-secondary"
                      >
                        {next}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">{t('contracts.empty')}</p>
            )}
          </section>
          <ItemTable items={p.purchasedItems} empty={t('customers.noPurchases')} />
          <PaymentTable rows={paymentsQuery.data ?? []} empty={t('payments.empty')} />
        </div>
      ) : null}

      {tab === 'licenses' ? (
        licenses.length > 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--text-muted)]">{t('onboard.noFakeInstall')}</p>
            {licenses.map((license) => (
              <section key={license.id} className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-white p-4 text-sm">
                <Link to={`/local-licenses/${license.id}`} className="cp-mono text-[var(--accent)] hover:underline">
                  {license.licenseKey}
                </Link>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusChip value={license.status === 'created' ? 'pending_activation' : license.status} />
                  <span>
                    {license.activeInstallationCount} / {license.deviceLimit}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-[var(--accent)] hover:underline"
                    onClick={() => void navigator.clipboard.writeText(license.licenseKey)}
                  >
                    {t('gyms.copyKey')}
                  </button>
                </div>
              </section>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">{t('customers.noLicense')}</p>
        )
      ) : null}

      {tab === 'installations' ? (
        p.installation ? (
          <section className="rounded-[var(--radius)] border border-gray-200 bg-white p-4 text-sm">
            <p className="mb-2 text-sm text-[var(--text-muted)]">{t('onboard.noFakeInstall')}</p>
            <div className="cp-mono">{p.installation.installationId}</div>
            <StatusChip value={p.installation.status} />
            <div className="mt-1 text-gray-600">
              {t('customers.lastValidation')}:{' '}
              {p.installation.lastValidatedAtUtc ? formatCairoDateTime(p.installation.lastValidatedAtUtc) : '—'}
            </div>
          </section>
        ) : (
          <p className="text-sm text-gray-500">{t('customers.noInstallation')}</p>
        )
      ) : null}

      {tab === 'support' ? (
        <div className="flex flex-col gap-3">
          {canTicket ? (
            <section className="rounded-[var(--radius)] border border-gray-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold">{t('support.new')}</h2>
              <input
                value={ticketSubject}
                onChange={(e) => setTicketSubject(e.target.value)}
                placeholder={t('support.subject')}
                className="mb-2 w-full rounded-[var(--radius)] border border-gray-300 px-3 py-2 text-sm"
              />
              <textarea
                value={ticketBody}
                onChange={(e) => setTicketBody(e.target.value)}
                rows={3}
                placeholder={t('support.description')}
                className="w-full rounded-[var(--radius)] border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={!ticketSubject.trim() || !ticketBody.trim() || ticketMutation.isPending}
                onClick={() => ticketMutation.mutate()}
                className="mt-2 rounded-[var(--radius)] bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {t('support.create')}
              </button>
            </section>
          ) : null}
          <TicketList
            rows={ticketsQuery.data ?? []}
            canAssign={isSupportOrAbove(role)}
            onPatch={(ticketId, body) =>
              updateSupportTicket(ticketId, body).then(() => {
                showToast(t('support.updated'), 'success')
                return invalidate()
              })
            }
          />
        </div>
      ) : null}

      {tab === 'activity' ? (
        <section className="rounded-[var(--radius)] border border-gray-200 bg-white p-4 text-sm text-gray-700">
          <ul className="space-y-1">
            <li>
              {t('customers.created')}: {formatCairoDateTime(c.createdAtUtc)}
            </li>
            <li>
              {t('common.saveChanges')}: {formatCairoDateTime(c.updatedAtUtc)}
            </li>
            {p.latestContract ? (
              <li>
                {t('customers.contract')}: {p.latestContract.contractNumber} ({p.latestContract.status})
              </li>
            ) : null}
            {p.license ? (
              <li>
                {t('customers.license')}: {p.license.licenseKey} ({p.license.status})
              </li>
            ) : null}
            {(ticketsQuery.data ?? []).slice(0, 8).map((ticket) => (
              <li key={ticket.id}>
                {ticket.ticketNumber}: {ticket.subject} ({ticket.status})
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canWrite ? (
        <EditNotes customerId={id} notes={c.notes ?? ''} onSaved={invalidate} />
      ) : null}

      <ConfirmDialog
        open={replaceOpen}
        title={t('gyms.replacePc')}
        description={<p>{t('gyms.replacePcHint')}</p>}
        confirmLabel={t('gyms.replacePc')}
        busy={transferMutation.isPending}
        error={replaceError}
        confirmDisabled={!!validateReason(replaceReason)}
        onClose={() => {
          if (!transferMutation.isPending) setReplaceOpen(false)
        }}
        onConfirm={() => {
          if (!replaceLicense) return
          transferMutation.mutate(replaceLicense.id)
        }}
      >
        <p className="mt-2 text-xs text-gray-500">{t('gyms.replacePcReclaim')}</p>
        <Link to="/ops-playbooks" className="mt-2 inline-block text-sm text-[var(--accent)] hover:underline">
          {t('gyms.help')}
        </Link>
        <label className="mt-2 block text-sm">
          <span className="text-gray-500">{t('customers.resetReason')}</span>
          <textarea
            value={replaceReason}
            disabled={transferMutation.isPending}
            onChange={(e) => setReplaceReason(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-[var(--radius)] border border-gray-300 bg-white px-3 py-2"
          />
        </label>
      </ConfirmDialog>
    </div>
  )
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-gray-200 bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="truncate font-semibold text-gray-900">{value}</div>
      {hint ? <StatusChip value={hint} /> : null}
    </div>
  )
}

function ItemTable({
  items,
  empty,
}: {
  items: { id: string; quantity: number; nameSnapshot: string; lineTotal: number }[]
  empty: string
}) {
  const t = useUiStore((s) => s.t)
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-gray-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="px-3 py-2 font-medium">{t('catalog.name')}</th>
            <th className="px-3 py-2 font-medium">{t('contracts.qty')}</th>
            <th className="px-3 py-2 font-medium">{t('contracts.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-3 py-6 text-center text-gray-500">
                {empty}
              </td>
            </tr>
          ) : null}
          {items.map((item) => (
            <tr key={item.id} className="border-t border-gray-200">
              <td className="px-3 py-2">{item.nameSnapshot}</td>
              <td className="px-3 py-2">{item.quantity}</td>
              <td className="px-3 py-2">{formatEgp(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PaymentTable({
  rows,
  empty,
}: {
  rows: { id: string; paymentDate: string; amount: number; paymentMethod: string; reference?: string | null }[]
  empty: string
}) {
  const t = useUiStore((s) => s.t)
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-gray-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="px-3 py-2 font-medium">{t('payments.date')}</th>
            <th className="px-3 py-2 font-medium">{t('payments.amount')}</th>
            <th className="px-3 py-2 font-medium">{t('payments.method')}</th>
            <th className="px-3 py-2 font-medium">{t('payments.reference')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                {empty}
              </td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-gray-200">
              <td className="px-3 py-2">{row.paymentDate}</td>
              <td className="px-3 py-2">{formatEgp(row.amount)}</td>
              <td className="px-3 py-2">{row.paymentMethod.replace('_', ' ')}</td>
              <td className="px-3 py-2">{row.reference || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TicketList({
  rows,
  canAssign,
  onPatch,
}: {
  rows: { id: string; ticketNumber: string; subject: string; status: string; priority: string }[]
  canAssign: boolean
  onPatch: (id: string, body: { status?: string }) => Promise<unknown>
}) {
  const t = useUiStore((s) => s.t)
  if (rows.length === 0) return <p className="text-sm text-gray-500">{t('support.empty')}</p>
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-gray-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="px-3 py-2 font-medium">{t('support.number')}</th>
            <th className="px-3 py-2 font-medium">{t('support.subject')}</th>
            <th className="px-3 py-2 font-medium">{t('customers.status')}</th>
            <th className="px-3 py-2 font-medium">{t('support.priority')}</th>
            {canAssign ? <th className="px-3 py-2 font-medium">{t('common.actions')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-gray-200">
              <td className="px-3 py-2 font-[var(--mono)] text-xs">{row.ticketNumber}</td>
              <td className="px-3 py-2">{row.subject}</td>
              <td className="px-3 py-2">
                <StatusChip value={row.status} />
              </td>
              <td className="px-3 py-2">
                <StatusChip value={row.priority} />
              </td>
              {canAssign ? (
                <td className="px-3 py-2">
                  {row.status === 'open' ? (
                    <button
                      type="button"
                      className="text-xs text-blue-700 hover:underline"
                      onClick={() => onPatch(row.id, { status: 'in_progress' })}
                    >
                      {t('support.start')}
                    </button>
                  ) : row.status === 'in_progress' ? (
                    <button
                      type="button"
                      className="text-xs text-blue-700 hover:underline"
                      onClick={() => onPatch(row.id, { status: 'resolved' })}
                    >
                      {t('support.resolve')}
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EditNotes({
  customerId,
  notes,
  onSaved,
}: {
  customerId: string
  notes: string
  onSaved: () => Promise<unknown>
}) {
  const t = useUiStore((s) => s.t)
  const showToast = useUiStore((s) => s.showToast)
  const profile = useQuery({ queryKey: ['customer-profile', customerId], queryFn: () => fetchCustomerProfile(customerId) })
  const [value, setValue] = useState(notes)
  const mutation = useMutation({
    mutationFn: async () => {
      const c = profile.data?.customer
      if (!c) throw new Error('missing')
      return updateCustomer(customerId, {
        businessName: c.businessName,
        ownerName: c.ownerName,
        phone: c.phone,
        whatsApp: c.whatsApp,
        email: c.email,
        address: c.address,
        preferredContactMethod: c.preferredContactMethod,
        notes: value,
        status: c.status,
        leadSource: c.leadSource,
        ownerUsername: c.ownerUsername,
        ownerEmail: c.ownerEmail,
      })
    },
    onSuccess: async () => {
      showToast(t('customers.updated'), 'success')
      await onSaved()
    },
  })
  return (
    <section className="rounded-[var(--radius)] border border-gray-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold">{t('customers.notes')}</h2>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        className="w-full rounded-[var(--radius)] border border-gray-300 px-3 py-2 text-sm"
      />
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="mt-2 rounded-[var(--radius)] border border-gray-300 px-3 py-1.5 text-sm"
      >
        {t('common.save')}
      </button>
    </section>
  )
}
