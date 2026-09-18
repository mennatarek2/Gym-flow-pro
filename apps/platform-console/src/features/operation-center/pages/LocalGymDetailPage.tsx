import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { DsAlert, DsButton, DsCard, DsEmptyState, DsPageHeader, SelectField, TextAreaField, TextInput } from '@/design-system'
import {
  createSupportTicket,
  fetchCustomerPayments,
  fetchCustomerProfile,
  fetchLocalLicenseDetail,
  fetchSupportTickets,
  fetchTenantDetail,
  fetchTenantStaff,
  initiateOwnerPasswordReset,
  updateCustomer,
} from '@/lib/api'
import { ApiClientError } from '@/lib/api/errors'
import type { LocalInstallationDto, LocalLicenseDetailDto, LocalLicenseListItemDto, PlatformCustomerDetailDto } from '@/lib/api/types'
import { formatCairoDateTime } from '@/lib/format'
import { displayLicenseKey } from '@/lib/license-key'
import { isCustomerAccess, isOpsOrAbove, isSales, isSalesOrAbove } from '@/lib/platform-roles'
import { statusLabel, type Locale } from '@gymflowpro/i18n'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'
import { OcId, OcLoadError, OcSkeletons, OcTabs } from '../ui'
import { OcLicenseStatus, OcStatus } from '../OcStatus'
import { OcLicenseActions } from '../OcLicenseActions'
import { OcReasonDrawer } from '../OcReasonDrawer'
import { OcStaffPasswordReset } from '../OcStaffPasswordReset'
import { OcOwnerRecoveryCard } from '../OcOwnerRecovery'
import { OcSalesContractPanel } from '../OcSalesContractPanel'
import { useOcCopy } from '../useOcCopy'

const TABS = ['summary', 'sales', 'support', 'activity'] as const
type Tab = (typeof TABS)[number]
const CUSTOMER_STATUSES = ['prospect', 'active', 'inactive', 'churned'] as const

function deriveLiveLicenseStatus(licenses: LocalLicenseListItemDto[], selectedLicenseId: string): string | null {
  if (selectedLicenseId) {
    return licenses.find((row) => row.id === selectedLicenseId)?.status ?? null
  }
  if (licenses.length === 1) return licenses[0]?.status ?? null
  return null
}

function customerStatusOption(value: string, locale: Locale): string {
  const labeled = statusLabel(value, locale)
  return labeled && labeled !== value ? labeled : value.replace(/_/g, ' ')
}

export function customerLicenses(profile: {
  licenses?: LocalLicenseListItemDto[] | null
  license?: LocalLicenseListItemDto | null
}): LocalLicenseListItemDto[] {
  if (profile.licenses?.length) return profile.licenses
  return profile.license ? [profile.license] : []
}

export function resolveLocalGymIdentity(args: {
  selectedDetail: LocalLicenseDetailDto | null
  details: LocalLicenseDetailDto[]
  licenses: LocalLicenseListItemDto[]
}): { gymCode: string | null; gymName: string | null; appVersion: string | null } {
  const pick = (row?: {
    gymCode?: string | null
    gymName?: string | null
    appVersion?: string | null
    installations?: LocalInstallationDto[]
  } | null) => {
    if (!row) return { gymCode: null as string | null, gymName: null as string | null, appVersion: null as string | null }
    const inst = row.installations?.find((item) => item.gymCode || item.gymName || item.appVersion)
    return {
      gymCode: row.gymCode || inst?.gymCode || null,
      gymName: row.gymName || inst?.gymName || null,
      appVersion: row.appVersion || inst?.appVersion || null,
    }
  }
  const selected = pick(args.selectedDetail)
  if (selected.gymCode || selected.gymName || selected.appVersion) return selected
  for (const detail of args.details) {
    const next = pick(detail)
    if (next.gymCode || next.gymName || next.appVersion) return next
  }
  for (const license of args.licenses) {
    const next = pick(license)
    if (next.gymCode || next.gymName || next.appVersion) return next
  }
  return { gymCode: null, gymName: null, appVersion: null }
}

export function formatOwnerAccount(
  customer: { ownerEmail?: string | null; ownerUsername?: string | null; ownerAccountStatus?: string | null },
  noneLabel: string,
): string {
  const login = customer.ownerEmail?.trim() || customer.ownerUsername?.trim() || ''
  const status = customer.ownerAccountStatus?.trim() || ''
  if (login && status) return `${login} · ${status}`
  if (login) return login
  if (status && status !== 'unknown') return status
  return noneLabel
}

export function LocalGymDetailPage() {
  const { id = '' } = useParams()
  const t = useOcCopy()
  const role = useAuthStore((s) => s.user?.role)
  const [tab, setTab] = useState<Tab>('summary')
  const [selectedLicenseId, setSelectedLicenseId] = useState('')

  const profileQuery = useQuery({
    queryKey: ['customer-profile', id],
    queryFn: () => fetchCustomerProfile(id),
    enabled: Boolean(id),
  })
  const paymentsQuery = useQuery({
    queryKey: ['customer-payments', id],
    queryFn: () => fetchCustomerPayments(id),
    enabled: Boolean(id) && tab === 'sales',
  })
  const ticketsQuery = useQuery({
    queryKey: ['customer-tickets', id],
    queryFn: () => fetchSupportTickets(id),
    enabled: Boolean(id) && tab === 'support',
  })

  const licenses = useMemo(
    () => (profileQuery.data ? customerLicenses(profileQuery.data) : []),
    [profileQuery.data],
  )
  const detailQueries = useQueries({
    queries: licenses.map((license) => ({
      queryKey: ['local-license', license.id],
      queryFn: () => fetchLocalLicenseDetail(license.id),
      enabled: Boolean(license.id),
    })),
  })
  const cloudTenantId = profileQuery.data?.customer.tenantId ?? ''
  const cloudQuery = useQuery({
    queryKey: ['tenant', cloudTenantId],
    queryFn: () => fetchTenantDetail(cloudTenantId),
    enabled: Boolean(cloudTenantId) && !isSales(role),
  })

  useEffect(() => {
    setSelectedLicenseId('')
  }, [id])

  useEffect(() => {
    if (licenses.length === 1 && licenses[0]) setSelectedLicenseId(licenses[0].id)
  }, [licenses])

  if (profileQuery.isLoading) return <OcSkeletons rows={6} />
  if (profileQuery.isError) {
    return (
      <OcLoadError
        error={profileQuery.error}
        source={`GET /platform-api/customers/${id}/profile`}
        onRetry={() => void profileQuery.refetch()}
      />
    )
  }

  const profile = profileQuery.data
  if (!profile) {
    return <DsEmptyState title={t('gyms.notFound')} hint={`GET /platform-api/customers/${id}/profile`} />
  }

  const customer = profile.customer
  const details = detailQueries.map((query) => query.data).filter((row): row is LocalLicenseDetailDto => Boolean(row))
  const detailsLoading = detailQueries.some((query) => query.isLoading)
  const detailsError = detailQueries.find((query) => query.isError)?.error ?? null
  const selectedLicense = licenses.find((row) => row.id === selectedLicenseId) ?? null
  const selectedDetail = details.find((row) => row.id === selectedLicenseId) ?? null
  const installations = details.flatMap((license) =>
    license.installations.map((row) => ({ ...row, licenseKey: license.licenseKey, licenseId: license.id })),
  )
  const operations = details.flatMap((license) =>
    (license.recentOperations ?? []).map((row) => ({ ...row, licenseKey: license.licenseKey })),
  )
  const changes = details.flatMap((license) =>
    license.recentChanges.map((row) => ({ ...row, licenseKey: license.licenseKey })),
  )
  const identity = resolveLocalGymIdentity({ selectedDetail, details, licenses })
  const multiLicense = licenses.length > 1
  const actionReady = Boolean(selectedLicense)
  const liveStatus = deriveLiveLicenseStatus(licenses, selectedLicenseId)
  const revealLicenseKeys = isOpsOrAbove(role)

  return (
    <div className="oc-stack">
      <Link to="/oc/gyms">{t('common.back')}</Link>
      <DsPageHeader
        title={identity.gymName || customer.businessName}
        subtitle={`${customer.ownerName} · ${customer.phone || customer.email || '—'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DsButton type="button" variant="secondary" onClick={() => setTab('sales')}>
              {t('gyms.printContract')}
            </DsButton>
            {customer.tenantId && !isSales(role) ? (
              <Link to={`/oc/gyms/cloud/${customer.tenantId}`}>
                <span className="text-sm font-semibold text-[var(--ds-teal-500)]">{t('gyms.alsoCloud')}</span>
              </Link>
            ) : null}
            {actionReady && selectedLicense ? (
              <OcLicenseActions
                licenseId={selectedLicense.id}
                licenseKey={selectedLicense.licenseKey}
                status={selectedLicense.status}
                installations={selectedDetail?.installations ?? (profile.installation ? [profile.installation] : [])}
              />
            ) : null}
          </div>
        }
      />
      <div className="flex flex-wrap gap-2">
        <OcStatus value={customer.status} />
        {liveStatus ? (
          <span className="inline-flex items-center gap-1">
            <span className="text-xs text-[var(--ds-text-muted)]">{t('gyms.liveStatus')}</span>
            <OcLicenseStatus value={liveStatus} showCode={false} />
          </span>
        ) : null}
        {identity.gymCode ? <OcId value={identity.gymCode} /> : null}
      </div>
      {multiLicense && !selectedLicenseId ? <DsAlert tone="warning">{t('gyms.selectLicense')}</DsAlert> : null}
      <OcTabs
        label={t('gyms.title')}
        value={tab}
        onChange={(next) => setTab(next as Tab)}
        tabs={TABS.map((tabId) => ({ id: tabId, label: t(`gyms.tab.${tabId}` as const) }))}
      />

      {tab === 'summary' ? (
        <div className="oc-stack">
          <DsCard>
            <div className="oc-cta-row">
              <div>
                <h3 className="oc-section-title">{t('salesContract.title')}</h3>
                <p className="oc-section-body">{t('gyms.printContractHint')}</p>
              </div>
              <DsButton type="button" onClick={() => setTab('sales')}>
                {t('gyms.openSalesForContract')}
              </DsButton>
            </div>
          </DsCard>

          <div className="oc-grid oc-grid-2">
            <DsCard>
              <h3 className="oc-section-title">{t('gyms.section.identity')}</h3>
              <dl className="oc-dl">
                <div>
                  <dt>{t('gyms.gymName')}</dt>
                  <dd>{identity.gymName || customer.businessName}</dd>
                </div>
                <div>
                  <dt>{t('gyms.code')}</dt>
                  <dd>{identity.gymCode ? <OcId value={identity.gymCode} /> : t('common.none')}</dd>
                </div>
                <div>
                  <dt>{t('gyms.version')}</dt>
                  <dd className="ds-ltr-isolate">{identity.appVersion || t('common.none')}</dd>
                </div>
                <div>
                  <dt>{t('gyms.cloudTenant')}</dt>
                  <dd>
                    {customer.tenantId ? (
                      <span className="oc-stack" style={{ gap: 4 }}>
                        {cloudQuery.data ? (
                          <>
                            <OcId value={cloudQuery.data.gymCode} />
                            <span> {cloudQuery.data.name}</span>
                          </>
                        ) : !isSales(role) ? (
                          <span className="ds-ltr-isolate">{customer.tenantId}</span>
                        ) : (
                          t('gyms.alsoCloud')
                        )}
                      </span>
                    ) : (
                      t('gyms.noCloudTenant')
                    )}
                  </dd>
                </div>
              </dl>
            </DsCard>

            <DsCard>
              <h3 className="oc-section-title">{t('gyms.section.people')}</h3>
              <dl className="oc-dl">
                <div>
                  <dt>{t('gyms.owner')}</dt>
                  <dd>{customer.ownerName}</dd>
                </div>
                <div>
                  <dt>{t('gyms.contact')}</dt>
                  <dd>{customer.phone || customer.email || '—'}</dd>
                </div>
                <div>
                  <dt>{t('gyms.ownerAccount')}</dt>
                  <dd>{formatOwnerAccount(customer, t('common.none'))}</dd>
                </div>
              </dl>
            </DsCard>
          </div>

          <DsCard>
            <h3 className="oc-section-title">{t('gyms.section.snapshot')}</h3>
            <dl className="oc-dl">
              <div>
                <dt>{t('gyms.customerStatus')}</dt>
                <dd>
                  <OcStatus value={customer.status} />
                  <p className="m-0 mt-1 text-xs text-[var(--ds-text-muted)]">{t('gyms.customerStatusHint')}</p>
                </dd>
              </div>
              <div>
                <dt>{t('gyms.liveStatus')}</dt>
                <dd>
                  {liveStatus ? <OcLicenseStatus value={liveStatus} /> : t('common.none')}
                  <p className="m-0 mt-1 text-xs text-[var(--ds-text-muted)]">{t('gyms.liveFromLicense')}</p>
                </dd>
              </div>
              <div>
                <dt>{t('gyms.licensesCount')}</dt>
                <dd className="ds-ltr-isolate">{licenses.length}</dd>
              </div>
              <div>
                <dt>{t('gyms.tickets')}</dt>
                <dd className="ds-ltr-isolate">{profile.openSupportTicketCount}</dd>
              </div>
            </dl>
          </DsCard>

          <DsCard>
            <h3 className="oc-section-title">{t('gyms.section.licensePc')}</h3>
            <div className="oc-stack mt-1">
              <DsAlert tone="info">{t('gyms.cannotActivate')}</DsAlert>
              {licenses.length === 0 ? (
                <DsEmptyState title={t('gyms.noLicense')} hint="GET /platform-api/customers/{id}/profile" />
              ) : (
                <LicenseTable
                  licenses={licenses}
                  selectedLicenseId={selectedLicenseId}
                  onSelect={setSelectedLicenseId}
                  requireSelection={multiLicense}
                  revealLicenseKeys={revealLicenseKeys}
                />
              )}
            </div>
          </DsCard>

          <DsCard>
            <h3 className="oc-section-title">{t('gyms.section.installsOps')}</h3>
            <div className="oc-stack mt-1">
              <p className="m-0 text-sm text-[var(--ds-text-muted)]">{t('gyms.checkInHint')}</p>
              <InstallationsPanel
                loading={detailsLoading}
                error={detailsError}
                onRetry={() => detailQueries.forEach((query) => void query.refetch())}
                installations={installations}
                lastValidation={profile.lastValidation}
              />
              <p className="m-0 text-sm text-[var(--ds-text-muted)]">{t('gyms.operationsHint')}</p>
              <OperationsPanel
                loading={detailsLoading}
                error={detailsError}
                onRetry={() => detailQueries.forEach((query) => void query.refetch())}
                operations={operations}
                source="GET /platform-api/local-licenses/{id}"
                revealLicenseKeys={revealLicenseKeys}
              />
            </div>
          </DsCard>

          <CustomerOpsCard customer={customer} />
          <p className="m-0 text-sm text-[var(--ds-text-muted)]">{t('gyms.accessHelp')}</p>
          {!customer.tenantId ? <OcOwnerRecoveryCard customerId={id} /> : null}
        </div>
      ) : null}

      {tab === 'sales' ? (
        <OcSalesContractPanel
          customerId={id}
          customerRollup={{
            contractTotal: profile.contractTotal,
            paid: profile.paidAmount,
            outstanding: profile.outstandingAmount,
            paymentStatus: profile.paymentStatus,
          }}
          payments={paymentsQuery.data ?? []}
          paymentsLoading={paymentsQuery.isLoading}
          paymentsError={paymentsQuery.isError ? paymentsQuery.error : null}
          onRetryPayments={() => void paymentsQuery.refetch()}
        />
      ) : null}

      {tab === 'support' ? (
        <div className="oc-stack">
          {isCustomerAccess(role) ? (
            <CreateTicketForm
              customerId={id}
              customerName={customer.businessName}
              licenses={licenses}
              details={details}
              selectedLicenseId={selectedLicenseId}
              onSelectLicense={setSelectedLicenseId}
            />
          ) : null}
          <TicketsPanel
            loading={ticketsQuery.isLoading}
            error={ticketsQuery.isError ? ticketsQuery.error : null}
            onRetry={() => void ticketsQuery.refetch()}
            tickets={ticketsQuery.data ?? []}
          />
        </div>
      ) : null}

      {tab === 'activity' ? (
        <ActivityPanel
          loading={detailsLoading}
          error={detailsError}
          onRetry={() => detailQueries.forEach((query) => void query.refetch())}
          changes={changes}
          source="GET /platform-api/local-licenses/{id}"
          revealLicenseKeys={revealLicenseKeys}
        />
      ) : null}
    </div>
  )
}

function LicenseTable({
  licenses,
  selectedLicenseId,
  onSelect,
  requireSelection,
  revealLicenseKeys,
}: {
  licenses: LocalLicenseListItemDto[]
  selectedLicenseId: string
  onSelect: (id: string) => void
  requireSelection: boolean
  revealLicenseKeys: boolean
}) {
  const t = useOcCopy()
  return (
    <div className="ds-table-wrap">
      <table className="ds-table">
        <thead>
          <tr>
            <th>{requireSelection ? t('gyms.actionTarget') : t('gyms.license')}</th>
            <th>{t('gyms.licenseKey')}</th>
            <th>{t('gyms.gymIdentity')}</th>
            <th>{t('gyms.edition')}</th>
            <th>{t('support.status')}</th>
            <th>{t('gyms.devices')}</th>
          </tr>
        </thead>
        <tbody>
          {licenses.map((row) => (
            <tr key={row.id}>
              <td>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="oc-license-target"
                    checked={selectedLicenseId === row.id}
                    onChange={() => onSelect(row.id)}
                  />
                  <span>{t('gyms.actionTarget')}</span>
                </label>
              </td>
              <td>
                <OcId value={displayLicenseKey(row.licenseKey, { revealFull: revealLicenseKeys })} />
              </td>
              <td>
                <div>{row.gymName || t('common.none')}</div>
                {row.gymCode ? <OcId value={row.gymCode} /> : null}
              </td>
              <td>{row.edition}</td>
              <td>
                <OcLicenseStatus value={row.status} />
              </td>
              <td className="ds-ltr-isolate">
                {row.activeInstallationCount} / {row.deviceLimit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CustomerOpsCard({ customer }: { customer: PlatformCustomerDetailDto }) {
  const t = useOcCopy()
  const locale = useUiStore((s) => s.locale) as Locale
  const role = useAuthStore((s) => s.user?.role)
  const canWrite = isSalesOrAbove(role)
  const canReset = isOpsOrAbove(role)
  const showToast = useUiStore((s) => s.showToast)
  const queryClient = useQueryClient()
  const [status, setStatus] = useState(customer.status)
  const [notes, setNotes] = useState(customer.notes ?? '')
  const [resetOpen, setResetOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const cloudTenantId = customer.tenantId
  const staffQuery = useQuery({
    queryKey: ['tenant-staff', cloudTenantId],
    queryFn: () => fetchTenantStaff(cloudTenantId!),
    enabled: Boolean(cloudTenantId) && canReset,
  })
  const cloudOwner = (staffQuery.data ?? []).find((row) => (row.role ?? '').toLowerCase() === 'owner') ?? null
  const [resetTarget, setResetTarget] = useState<typeof cloudOwner>(null)

  useEffect(() => {
    setStatus(customer.status)
    setNotes(customer.notes ?? '')
  }, [customer.id, customer.status, customer.notes])

  const save = useMutation({
    mutationFn: () =>
      updateCustomer(customer.id, {
        businessName: customer.businessName,
        ownerName: customer.ownerName,
        phone: customer.phone,
        email: customer.email,
        whatsApp: customer.whatsApp,
        address: customer.address,
        preferredContactMethod: customer.preferredContactMethod,
        notes,
        status,
        leadSource: customer.leadSource,
        assignedSalesRepPlatformAdminUserId: customer.assignedSalesRepPlatformAdminUserId,
        ownerUsername: customer.ownerUsername,
        ownerEmail: customer.ownerEmail,
      }),
    onSuccess: async () => {
      showToast(t('gyms.customerSaved'), 'success')
      await queryClient.invalidateQueries({ queryKey: ['customer-profile', customer.id] })
    },
    onError: (err) => showToast(err instanceof ApiClientError ? err.message : t('errors.generic'), 'error'),
  })

  const reset = useMutation({
    mutationFn: () => initiateOwnerPasswordReset(customer.id, { reason: reason.trim() }),
    onSuccess: async () => {
      showToast(t('gyms.resetOwnerDone'), 'success')
      setResetOpen(false)
      setReason('')
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['customer-profile', customer.id] })
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : t('errors.generic')),
  })

  return (
    <DsCard>
      <h3 className="oc-section-title">{t('gyms.section.customerRecord')}</h3>
      <div className="oc-stack mt-1">
        {canWrite ? (
          <>
            <SelectField label={t('gyms.customerStatus')} value={status} onChange={(e) => setStatus(e.target.value)}>
              {CUSTOMER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {customerStatusOption(value, locale)}
                </option>
              ))}
            </SelectField>
            <TextAreaField label={t('gyms.customerNotes')} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            <DsButton type="button" onClick={() => save.mutate()} loading={save.isPending}>
              {t('gyms.saveCustomer')}
            </DsButton>
          </>
        ) : (
          <p className="m-0 text-sm text-[var(--ds-text-muted)]">{customer.notes || t('common.none')}</p>
        )}
        {canReset ? (
          <div className="border-t border-[var(--ds-border)] pt-3">
            <DsButton
              type="button"
              variant="secondary"
              onClick={() => {
                setError(null)
                if (cloudTenantId) {
                  if (!cloudOwner) {
                    setError(t('gyms.resetOwnerMissing'))
                    return
                  }
                  setResetTarget(cloudOwner)
                  return
                }
                setResetOpen(true)
              }}
            >
              {t('gyms.resetOwner')}
            </DsButton>
          </div>
        ) : null}
        {error && !resetOpen ? <p className="m-0 text-sm text-[var(--ds-status-danger)]">{error}</p> : null}
      </div>
      <OcReasonDrawer
        open={resetOpen}
        title={t('gyms.resetOwner')}
        body={t('gyms.resetOwnerBody')}
        confirmLabel={t('gyms.resetOwner')}
        reason={reason}
        onReasonChange={setReason}
        error={error}
        loading={reset.isPending}
        onConfirm={() => reset.mutate()}
        onClose={() => {
          setResetOpen(false)
          setError(null)
        }}
      />
      {cloudTenantId ? (
        <OcStaffPasswordReset
          tenantId={cloudTenantId}
          staff={resetTarget}
          open={Boolean(resetTarget)}
          onClose={() => setResetTarget(null)}
        />
      ) : null}
    </DsCard>
  )
}

function InstallationsPanel({
  loading,
  error,
  onRetry,
  installations,
  lastValidation,
}: {
  loading: boolean
  error: unknown
  onRetry: () => void
  installations: Array<
    LocalInstallationDto & {
      licenseKey?: string
      licenseId?: string
    }
  >
  lastValidation?: string | null
}) {
  const t = useOcCopy()
  const role = useAuthStore((s) => s.user?.role)
  const revealLicenseKeys = isOpsOrAbove(role)
  if (loading) return <OcSkeletons />
  if (error) return <OcLoadError error={error} source="GET /platform-api/local-licenses/{id}" onRetry={onRetry} />
  if (installations.length === 0) {
    return (
      <DsEmptyState
        title={t('gyms.noInstall')}
        hint={lastValidation ? undefined : t('gyms.lastSeenHint')}
      />
    )
  }
  return (
    <div className="ds-table-wrap">
      <table className="ds-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>{t('gyms.license')}</th>
            <th>{t('gyms.gymIdentity')}</th>
            <th>{t('gyms.version')}</th>
            <th>{t('support.status')}</th>
            <th>{t('gyms.firstSeen')}</th>
            <th>{t('gyms.lastValidation')}</th>
          </tr>
        </thead>
        <tbody>
          {installations.map((row) => (
            <tr key={`${row.licenseId ?? ''}-${row.installationId}`}>
              <td>
                <OcId value={row.installationId} />
              </td>
              <td>
                {row.licenseKey ? (
                  <OcId value={displayLicenseKey(row.licenseKey, { revealFull: revealLicenseKeys })} />
                ) : (
                  t('common.none')
                )}
              </td>
              <td>
                <div>{row.gymName || t('common.none')}</div>
                {row.gymCode ? <OcId value={row.gymCode} /> : null}
              </td>
              <td className="ds-ltr-isolate">{row.appVersion || t('common.none')}</td>
              <td>
                <OcStatus value={row.status} />
              </td>
              <td className="ds-ltr-isolate">{formatCairoDateTime(row.firstActivatedAtUtc)}</td>
              <td className="ds-ltr-isolate">
                {row.lastValidatedAtUtc ? formatCairoDateTime(row.lastValidatedAtUtc) : t('gyms.neverChecked')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CreateTicketForm({
  customerId,
  customerName,
  licenses,
  details,
  selectedLicenseId,
  onSelectLicense,
}: {
  customerId: string
  customerName: string
  licenses: LocalLicenseListItemDto[]
  details: LocalLicenseDetailDto[]
  selectedLicenseId: string
  onSelectLicense: (id: string) => void
}) {
  const t = useOcCopy()
  const role = useAuthStore((s) => s.user?.role)
  const revealLicenseKeys = isOpsOrAbove(role)
  const showToast = useUiStore((s) => s.showToast)
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('normal')
  const [installationId, setInstallationId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const selectedLicense = licenses.find((row) => row.id === selectedLicenseId) ?? null
  const installations = details.find((row) => row.id === selectedLicenseId)?.installations ?? []

  useEffect(() => {
    if (installations.length === 1 && installations[0]?.id) setInstallationId(installations[0].id)
    else setInstallationId('')
  }, [selectedLicenseId, installations.length, installations[0]?.id])

  const needsLicense = licenses.length > 1 && !selectedLicenseId
  const mutation = useMutation({
    mutationFn: () =>
      createSupportTicket({
        customerId,
        localLicenseId: selectedLicense?.id || null,
        localInstallationId: installationId || null,
        subject: subject.trim(),
        description: description.trim(),
        priority,
      }),
    onSuccess: async () => {
      showToast(t('support.updated'), 'success')
      setSubject('')
      setDescription('')
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['customer-tickets', customerId] })
      await queryClient.invalidateQueries({ queryKey: ['support-tickets'] })
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : t('errors.generic')),
  })
  return (
    <DsCard>
      <h3>{t('support.create')}</h3>
      <dl className="oc-dl mt-3">
        <div>
          <dt>{t('support.customer')}</dt>
          <dd>{customerName}</dd>
        </div>
        <div>
          <dt>{t('gyms.license')}</dt>
          <dd>
            {selectedLicense ? (
              <OcId value={displayLicenseKey(selectedLicense.licenseKey, { revealFull: revealLicenseKeys })} />
            ) : (
              t('common.none')
            )}
          </dd>
        </div>
        <div>
          <dt>{t('gyms.installation')}</dt>
          <dd>
            {installationId
              ? <OcId value={installations.find((row) => row.id === installationId)?.installationId || installationId} />
              : t('common.none')}
          </dd>
        </div>
      </dl>
      <form
        className="oc-stack mt-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (needsLicense) {
            setError(t('gyms.needLicenseForTicket'))
            return
          }
          mutation.mutate()
        }}
      >
        {licenses.length > 1 ? (
          <SelectField label={t('gyms.license')} value={selectedLicenseId} onChange={(e) => onSelectLicense(e.target.value)}>
            <option value="">{t('gyms.selectLicense')}</option>
            {licenses.map((row) => (
              <option key={row.id} value={row.id}>
                {displayLicenseKey(row.licenseKey, { revealFull: revealLicenseKeys })}
              </option>
            ))}
          </SelectField>
        ) : null}
        {installations.length > 1 ? (
          <SelectField label={t('gyms.installation')} value={installationId} onChange={(e) => setInstallationId(e.target.value)}>
            <option value="">{t('common.none')}</option>
            {installations.map((row) => (
              <option key={row.id ?? row.installationId} value={row.id ?? ''}>
                {row.installationId}
              </option>
            ))}
          </SelectField>
        ) : null}
        <TextInput label={t('support.subject')} required value={subject} onChange={(e) => setSubject(e.target.value)} />
        <TextAreaField label={t('support.description')} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        <SelectField label={t('support.priority')} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="low">low</option>
          <option value="normal">normal</option>
          <option value="high">high</option>
          <option value="critical">critical</option>
        </SelectField>
        {error ? <DsAlert tone="danger">{error}</DsAlert> : null}
        <DsButton type="submit" disabled={!subject.trim() || !description.trim() || needsLicense} loading={mutation.isPending}>
          {t('support.create')}
        </DsButton>
      </form>
    </DsCard>
  )
}

function TicketsPanel({
  loading,
  error,
  onRetry,
  tickets,
}: {
  loading: boolean
  error: unknown
  onRetry: () => void
  tickets: Array<{ id: string; ticketNumber: string; subject: string; priority: string; status: string }>
}) {
  const t = useOcCopy()
  if (loading) return <OcSkeletons />
  if (error) return <OcLoadError error={error} source="GET /platform-api/support-tickets" onRetry={onRetry} />
  if (tickets.length === 0) return <DsEmptyState title={t('gyms.noTickets')} />
  return (
    <div className="ds-table-wrap">
      <table className="ds-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>{t('support.subject')}</th>
            <th>{t('support.priority')}</th>
            <th>{t('support.status')}</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((row) => (
            <tr key={row.id}>
              <td>
                <OcId value={row.ticketNumber} />
              </td>
              <td>
                <Link to={`/oc/support/tickets/${row.id}`}>{row.subject}</Link>
              </td>
              <td>
                <OcStatus value={row.priority} />
              </td>
              <td>
                <OcStatus value={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OperationsPanel({
  loading,
  error,
  onRetry,
  operations,
  source,
  revealLicenseKeys,
}: {
  loading: boolean
  error: unknown
  onRetry: () => void
  operations: Array<{
    operationId: string
    eventType: string
    installationId?: string | null
    gymCode?: string | null
    gymName?: string | null
    message?: string | null
    createdAtUtc: string
    licenseKey?: string
  }>
  source: string
  revealLicenseKeys: boolean
}) {
  const t = useOcCopy()
  if (loading) return <OcSkeletons />
  if (error) return <OcLoadError error={error} source={source} onRetry={onRetry} />
  if (operations.length === 0) return <DsEmptyState title={t('gyms.noOperations')} hint={source} />
  return (
    <div className="ds-table-wrap">
      <table className="ds-table">
        <thead>
          <tr>
            <th>{t('gyms.operation')}</th>
            <th>{t('gyms.event')}</th>
            <th>{t('gyms.gymIdentity')}</th>
            <th>{t('gyms.license')}</th>
            <th>{t('settings.when')}</th>
          </tr>
        </thead>
        <tbody>
          {operations.map((row, i) => (
            <tr key={`${row.operationId}-${row.eventType}-${i}`}>
              <td>
                <OcId value={row.operationId} />
              </td>
              <td>
                <div>{row.eventType}</div>
                {row.message ? <div className="text-sm text-[var(--ds-text-muted)]">{row.message}</div> : null}
              </td>
              <td>
                <div>{row.gymName || t('common.none')}</div>
                {row.gymCode ? <OcId value={row.gymCode} /> : null}
                {row.installationId ? <OcId value={row.installationId} /> : null}
              </td>
              <td>
                {row.licenseKey ? (
                  <OcId value={displayLicenseKey(row.licenseKey, { revealFull: revealLicenseKeys })} />
                ) : (
                  t('common.none')
                )}
              </td>
              <td className="ds-ltr-isolate">{formatCairoDateTime(row.createdAtUtc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ActivityPanel({
  loading,
  error,
  onRetry,
  changes,
  source,
  revealLicenseKeys,
}: {
  loading: boolean
  error: unknown
  onRetry: () => void
  changes: Array<{
    changeType: string
    fromStatus?: string | null
    toStatus?: string | null
    initiatedBy: string
    createdAtUtc: string
    licenseKey?: string
  }>
  source: string
  revealLicenseKeys: boolean
}) {
  const t = useOcCopy()
  if (loading) return <OcSkeletons />
  if (error) return <OcLoadError error={error} source={source} onRetry={onRetry} />
  if (changes.length === 0) return <DsEmptyState title={t('gyms.noActivity')} hint={source} />
  return (
    <div className="ds-table-wrap">
      <table className="ds-table">
        <thead>
          <tr>
            <th>{t('settings.action')}</th>
            <th>{t('gyms.license')}</th>
            <th>{t('settings.actor')}</th>
            <th>{t('settings.when')}</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((row, i) => (
            <tr key={`${row.createdAtUtc}-${i}`}>
              <td>{row.changeType}</td>
              <td>
                {row.licenseKey ? (
                  <OcId value={displayLicenseKey(row.licenseKey, { revealFull: revealLicenseKeys })} />
                ) : null}
                <OcStatus value={row.toStatus ?? row.fromStatus} />
              </td>
              <td className="ds-ltr-isolate">{row.initiatedBy}</td>
              <td className="ds-ltr-isolate">{formatCairoDateTime(row.createdAtUtc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
