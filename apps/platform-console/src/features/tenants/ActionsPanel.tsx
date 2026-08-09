import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  applyCoupon,
  deleteFeatureOverride,
  extendTrialTenant,
  forceReactivateTenant,
  forceSuspendTenant,
  upsertFeatureOverride,
} from '@/lib/api/tenant-actions-api'
import { ApiClientError } from '@/lib/api/errors'
import type {
  FeatureOverrideDto,
  PlatformTenantDetailDto,
  PriceOverrideDto,
} from '@/lib/api/types'
import { KNOWN_FEATURE_KEYS } from '@/lib/api/types'
import { formatCairoDateTime, formatEgp } from '@/lib/format'
import { isOpsOrAbove, MIN_REASON_LENGTH, validateReason } from '@/lib/platform-roles'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'

type ModalKind =
  | 'suspend'
  | 'reactivate'
  | 'extend'
  | 'coupon'
  | 'override-add'
  | 'override-revoke'
  | null

interface ActionsPanelProps {
  tenant: PlatformTenantDetailDto
}

function ReasonField({
  value,
  onChange,
  disabled,
  id = 'action-reason',
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  id?: string
}) {
  return (
    <label className="mt-2 block text-sm" htmlFor={id}>
      <span className="text-slate-400">
        Reason <span className="text-red-300">(required, min {MIN_REASON_LENGTH} chars — audit log)</span>
      </span>
      <textarea
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 disabled:opacity-60"
        placeholder="Explain why this action is being taken…"
      />
    </label>
  )
}

function ActionButton({
  label,
  onClick,
  disabled,
  tooltip,
  tone = 'default',
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  tooltip?: string
  tone?: 'default' | 'danger'
}) {
  const classes =
    tone === 'danger'
      ? 'border-red-800 bg-red-950/40 text-red-100 hover:bg-red-900/50'
      : 'border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'

  return (
    <span className="inline-flex" title={disabled && tooltip ? tooltip : undefined}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-disabled={disabled}
        className={`rounded-[var(--radius)] border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-45 ${classes}`}
      >
        {label}
      </button>
    </span>
  )
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.status === 403) return 'Forbidden — your role cannot perform this action (403).'
    return err.message
  }
  if (err instanceof Error) return err.message
  return 'Request failed'
}

export function ActionsPanel({ tenant }: ActionsPanelProps) {
  const role = useAuthStore((s) => s.user?.role)
  const showToast = useUiStore((s) => s.showToast)
  const queryClient = useQueryClient()
  const ops = isOpsOrAbove(role)
  const sub = tenant.subscription
  const status = sub?.status ?? ''

  const [modal, setModal] = useState<ModalKind>(null)
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [extendDays, setExtendDays] = useState(7)
  const [couponType, setCouponType] = useState<'percent' | 'fixed'>('percent')
  const [couponValue, setCouponValue] = useState('10')
  const [couponExpires, setCouponExpires] = useState('')
  const [overrideKey, setOverrideKey] = useState<string>(KNOWN_FEATURE_KEYS[0])
  const [overrideEnabled, setOverrideEnabled] = useState(true)
  const [overrideExpires, setOverrideExpires] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<FeatureOverrideDto | null>(null)

  const openModal = (kind: ModalKind) => {
    setModal(kind)
    setFormError(null)
    // Preserve reason only on error reopen of same flow — fresh open clears.
    setReason('')
  }

  const closeModal = () => {
    if (busy) return
    setModal(null)
    setRevokeTarget(null)
    setFormError(null)
  }

  const invalidateTenant = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tenant', tenant.id] }),
      queryClient.invalidateQueries({ queryKey: ['tenant-changes', tenant.id] }),
      queryClient.invalidateQueries({ queryKey: ['tenant-invoices', tenant.id] }),
      queryClient.invalidateQueries({ queryKey: ['tenants'] }),
    ])
  }

  const onMutationSuccess = async (message: string) => {
    setModal(null)
    setRevokeTarget(null)
    setFormError(null)
    setReason('')
    showToast(message, 'success')
    await invalidateTenant()
  }

  const onMutationError = (err: unknown) => {
    setFormError(errorMessage(err))
  }

  const suspendMutation = useMutation({
    mutationFn: () => forceSuspendTenant(tenant.id, { reason: reason.trim() }),
    onSuccess: () => onMutationSuccess(`Suspended ${tenant.name}.`),
    onError: onMutationError,
  })
  const reactivateMutation = useMutation({
    mutationFn: () => forceReactivateTenant(tenant.id, { reason: reason.trim() }),
    onSuccess: () => onMutationSuccess(`Reactivated ${tenant.name}.`),
    onError: onMutationError,
  })
  const extendMutation = useMutation({
    mutationFn: () =>
      extendTrialTenant(tenant.id, { days: extendDays, reason: reason.trim() }),
    onSuccess: () => onMutationSuccess(`Extended trial for ${tenant.name} by ${extendDays} day(s).`),
    onError: onMutationError,
  })
  const couponMutation = useMutation({
    mutationFn: () => {
      const value = Number(couponValue)
      if (!Number.isFinite(value) || value <= 0) {
        return Promise.reject(new Error('Coupon value must be a positive number.'))
      }
      if (!couponExpires) {
        return Promise.reject(new Error('Expiry date is required.'))
      }
      const expiresAtUtc = new Date(couponExpires).toISOString()
      return applyCoupon(tenant.id, {
        discountType: couponType,
        value,
        expiresAtUtc,
        reason: reason.trim(),
      })
    },
    onSuccess: () => onMutationSuccess(`Coupon applied to ${tenant.name}.`),
    onError: onMutationError,
  })
  const overrideMutation = useMutation({
    mutationFn: () =>
      upsertFeatureOverride(tenant.id, {
        featureKey: overrideKey,
        enabled: overrideEnabled,
        reason: reason.trim(),
        expiresAtUtc: overrideExpires ? new Date(overrideExpires).toISOString() : null,
      }),
    onSuccess: () => onMutationSuccess(`Feature override saved for ${tenant.name}.`),
    onError: onMutationError,
  })
  const revokeMutation = useMutation({
    mutationFn: () => {
      if (!revokeTarget) return Promise.reject(new Error('No override selected.'))
      return deleteFeatureOverride(tenant.id, revokeTarget.id)
    },
    onSuccess: () => onMutationSuccess(`Feature override revoked for ${tenant.name}.`),
    onError: onMutationError,
  })

  const busy =
    suspendMutation.isPending ||
    reactivateMutation.isPending ||
    extendMutation.isPending ||
    couponMutation.isPending ||
    overrideMutation.isPending ||
    revokeMutation.isPending

  const reasonOk = validateReason(reason) === null
  const canSuspend = status === 'active' || status === 'past_due' || status === 'trialing'
  const canReactivate = status === 'suspended'
  const canExtend = status === 'trialing'

  const overrides = tenant.featureOverrides ?? []
  const coupons = useMemo(
    () => (tenant.priceOverrides ?? []).filter((c) => c.isActive !== false),
    [tenant.priceOverrides],
  )

  const runWithReason = (fn: () => void) => {
    const err = validateReason(reason)
    if (err) {
      setFormError(err)
      return
    }
    setFormError(null)
    fn()
  }

  const supportTooltip = 'Requires Platform Ops'

  return (
    <section className="rounded-[var(--radius)] border border-slate-700 bg-slate-900/50 p-4">
      <h2 className="text-lg font-medium">Actions</h2>
      <p className="mt-1 text-xs text-slate-500">
        Write operations against this tenant&apos;s billing state. Every confirm requires an audit reason.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton
          label="Force suspend"
          tone="danger"
          disabled={!ops || !canSuspend}
          tooltip={
            !ops
              ? supportTooltip
              : !canSuspend
                ? 'Only active, past due, or trialing subscriptions can be suspended'
                : undefined
          }
          onClick={() => openModal('suspend')}
        />
        <ActionButton
          label="Force reactivate"
          disabled={!ops || !canReactivate}
          tooltip={
            !ops
              ? supportTooltip
              : !canReactivate
                ? 'Only suspended subscriptions can be reactivated'
                : undefined
          }
          onClick={() => openModal('reactivate')}
        />
        {canExtend ? (
          <ActionButton
            label="Extend trial"
            disabled={!ops}
            tooltip={!ops ? supportTooltip : undefined}
            onClick={() => openModal('extend')}
          />
        ) : null}
        {ops ? (
          <ActionButton label="Apply coupon" onClick={() => openModal('coupon')} />
        ) : null}
      </div>

      {ops && coupons.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-slate-400">Active coupons</h3>
          <ul className="mt-1 space-y-1 text-sm text-slate-300">
            {coupons.map((c: PriceOverrideDto) => (
              <li key={c.id}>
                {c.discountType === 'percent' ? `${c.value}%` : formatEgp(c.value)} off · expires{' '}
                {formatCairoDateTime(c.expiresAtUtc)} · {c.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {ops ? (
        <FeatureOverridesSubPanel
          overrides={overrides}
          busy={busy}
          onAdd={() => openModal('override-add')}
          onRevoke={(row) => {
            setRevokeTarget(row)
            openModal('override-revoke')
          }}
        />
      ) : null}

      {/* Suspend */}
      <ConfirmDialog
        open={modal === 'suspend'}
        title="Force suspend"
        description={
          <p>
            This will immediately suspend <strong>{tenant.name}</strong>&apos;s admin dashboard
            access (owner/manager/receptionist logins blocked). Member check-in can continue for a
            short buffer (typically 48–72 hours) before all tenant APIs lock. Document why —
            this is written to the platform audit log.
          </p>
        }
        confirmLabel="Suspend now"
        confirmTone="danger"
        busy={busy}
        error={formError}
        confirmDisabled={!reasonOk}
        onClose={closeModal}
        onConfirm={() => runWithReason(() => suspendMutation.mutate())}
      >
        <ReasonField value={reason} onChange={setReason} disabled={busy} />
      </ConfirmDialog>

      {/* Reactivate */}
      <ConfirmDialog
        open={modal === 'reactivate'}
        title="Force reactivate"
        description={
          <p>
            This will immediately restore <strong>{tenant.name}</strong> to an active subscription
            and unlock admin access. Use when payment was confirmed offline or a mistaken
            suspension needs correcting.
          </p>
        }
        confirmLabel="Reactivate"
        busy={busy}
        error={formError}
        confirmDisabled={!reasonOk}
        onClose={closeModal}
        onConfirm={() => runWithReason(() => reactivateMutation.mutate())}
      >
        <ReasonField value={reason} onChange={setReason} disabled={busy} />
      </ConfirmDialog>

      {/* Extend trial */}
      <ConfirmDialog
        open={modal === 'extend'}
        title="Extend trial"
        description={
          <p>
            Extends the trial end date and current period end for <strong>{tenant.name}</strong>.
            Only valid while status is <code>trialing</code>.
          </p>
        }
        confirmLabel="Extend trial"
        busy={busy}
        error={formError}
        confirmDisabled={!reasonOk || extendDays < 1}
        onClose={closeModal}
        onConfirm={() => runWithReason(() => extendMutation.mutate())}
      >
        <label className="mt-2 block text-sm" htmlFor="extend-days">
          <span className="text-slate-400">Days to add</span>
          <input
            id="extend-days"
            type="number"
            min={1}
            max={90}
            disabled={busy}
            value={extendDays}
            onChange={(e) => setExtendDays(Number(e.target.value))}
            className="mt-1 w-full rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2"
          />
        </label>
        <ReasonField value={reason} onChange={setReason} disabled={busy} />
      </ConfirmDialog>

      {/* Coupon */}
      <ConfirmDialog
        open={modal === 'coupon'}
        title="Apply coupon"
        description={
          <p>
            Creates a time-boxed price override for <strong>{tenant.name}</strong>. The next renewal
            invoice picks up the newest non-expired coupon automatically.
          </p>
        }
        confirmLabel="Apply coupon"
        busy={busy}
        error={formError}
        confirmDisabled={!reasonOk}
        onClose={closeModal}
        onConfirm={() => runWithReason(() => couponMutation.mutate())}
      >
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-slate-400">Type</span>
            <select
              disabled={busy}
              value={couponType}
              onChange={(e) => setCouponType(e.target.value as 'percent' | 'fixed')}
              className="mt-1 w-full rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2"
            >
              <option value="percent">Percent</option>
              <option value="fixed">Fixed EGP</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-slate-400">Value</span>
            <input
              disabled={busy}
              type="number"
              min={0.01}
              step="0.01"
              value={couponValue}
              onChange={(e) => setCouponValue(e.target.value)}
              className="mt-1 w-full rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2"
            />
          </label>
        </div>
        <label className="mt-2 block text-sm">
          <span className="text-slate-400">Expires at (local)</span>
          <input
            disabled={busy}
            type="datetime-local"
            value={couponExpires}
            onChange={(e) => setCouponExpires(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2"
          />
        </label>
        <ReasonField value={reason} onChange={setReason} disabled={busy} />
      </ConfirmDialog>

      {/* Add override */}
      <ConfirmDialog
        open={modal === 'override-add'}
        title="Add feature override"
        description={
          <p>
            Grants or denies a feature for <strong>{tenant.name}</strong> outside their plan tier.
            Expiry is optional; leave blank for no automatic expiry.
          </p>
        }
        confirmLabel="Save override"
        busy={busy}
        error={formError}
        confirmDisabled={!reasonOk}
        onClose={closeModal}
        onConfirm={() => runWithReason(() => overrideMutation.mutate())}
      >
        <label className="mt-2 block text-sm">
          <span className="text-slate-400">Feature key</span>
          <select
            disabled={busy}
            value={overrideKey}
            onChange={(e) => setOverrideKey(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2"
          >
            {KNOWN_FEATURE_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={busy}
            checked={overrideEnabled}
            onChange={(e) => setOverrideEnabled(e.target.checked)}
          />
          Enabled (grant access)
        </label>
        <label className="mt-2 block text-sm">
          <span className="text-slate-400">Expires at (optional)</span>
          <input
            disabled={busy}
            type="datetime-local"
            value={overrideExpires}
            onChange={(e) => setOverrideExpires(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2"
          />
        </label>
        <ReasonField value={reason} onChange={setReason} disabled={busy} />
      </ConfirmDialog>

      {/* Revoke override — DELETE has no reason body; still confirm before mutating. */}
      <ConfirmDialog
        open={modal === 'override-revoke'}
        title="Revoke feature override"
        description={
          <p>
            Permanently deletes the override for feature{' '}
            <strong>{revokeTarget?.featureKey ?? '—'}</strong> on <strong>{tenant.name}</strong>.
            Tier defaults apply again immediately. This is written to the platform audit log.
          </p>
        }
        confirmLabel="Revoke"
        confirmTone="danger"
        busy={busy}
        error={formError}
        onClose={closeModal}
        onConfirm={() => revokeMutation.mutate()}
      />
    </section>
  )
}

function FeatureOverridesSubPanel({
  overrides,
  busy,
  onAdd,
  onRevoke,
}: {
  overrides: FeatureOverrideDto[]
  busy: boolean
  onAdd: () => void
  onRevoke: (row: FeatureOverrideDto) => void
}) {
  return (
    <div className="mt-6 border-t border-slate-800 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-medium">Feature overrides</h3>
        <button
          type="button"
          disabled={busy}
          onClick={onAdd}
          className="rounded-[var(--radius)] border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700 disabled:opacity-50"
        >
          Add override
        </button>
      </div>
      {!overrides.length ? (
        <p className="mt-2 text-sm text-slate-500">No active feature overrides.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="px-2 py-1">Feature</th>
                <th className="px-2 py-1">State</th>
                <th className="px-2 py-1">Reason</th>
                <th className="px-2 py-1">Granted by</th>
                <th className="px-2 py-1">Expires</th>
                <th className="px-2 py-1"> </th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((row) => (
                <tr key={row.id} className="border-t border-slate-800">
                  <td className="px-2 py-2 font-[var(--mono)]">{row.featureKey}</td>
                  <td className="px-2 py-2">{row.enabled ? 'Enabled' : 'Disabled'}</td>
                  <td className="px-2 py-2 text-slate-400">{row.reason}</td>
                  <td className="px-2 py-2 font-[var(--mono)] text-xs">{row.grantedByPlatformUserId}</td>
                  <td className="px-2 py-2">
                    {row.expiresAtUtc ? formatCairoDateTime(row.expiresAtUtc) : 'Never'}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRevoke(row)}
                      className="text-red-300 underline disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
