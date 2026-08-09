import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { provisionTenant } from '@/lib/api'
import { ApiClientError } from '@/lib/api/errors'
import { useUiStore } from '@/stores/ui-store'
import {
  emptyProvisionForm,
  PROVISION_TIERS,
  validateProvisionForm,
  type ProvisionFormValues,
} from './provision-form'

interface ProvisionGymDialogProps {
  open: boolean
  onClose: () => void
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-300">{label}</span>
      {children}
      {error ? <span className="text-xs text-red-300">{error}</span> : null}
    </label>
  )
}

const inputClass =
  'rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 disabled:opacity-60'

export function ProvisionGymDialog({ open, onClose }: ProvisionGymDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showToast = useUiStore((s) => s.showToast)

  const [values, setValues] = useState<ProvisionFormValues>(emptyProvisionForm)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ProvisionFormValues, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      setValues(emptyProvisionForm())
      setFieldErrors({})
      setSubmitError(null)
      el.showModal()
    } else if (!open && el.open) {
      el.close()
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: provisionTenant,
    onSuccess: async (data) => {
      if (!data.trialStarted) {
        showToast(
          `Gym ${data.gymCode} created, but trial did not start${data.trialError ? `: ${data.trialError}` : ''}`,
          'error',
          8000,
        )
      } else {
        showToast(`Gym ${data.gymCode} provisioned`, 'success')
      }
      await queryClient.invalidateQueries({ queryKey: ['tenants'] })
      onClose()
      navigate(`/tenants/${data.tenantId}`)
    },
    onError: (err) => {
      setSubmitError(
        err instanceof ApiClientError
          ? err.status === 403
            ? 'Forbidden — Requires Platform Ops (403).'
            : err.message
          : err instanceof Error
            ? err.message
            : 'Provisioning failed',
      )
    },
  })

  function patch(key: keyof ProvisionFormValues, value: string) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  function handleSubmit() {
    setSubmitError(null)
    const result = validateProvisionForm(values)
    if (!result.ok) {
      setFieldErrors(result.errors)
      return
    }
    setFieldErrors({})
    mutation.mutate(result.body)
  }

  const busy = mutation.isPending

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="w-[min(100%,36rem)] rounded-[var(--radius)] border border-slate-600 bg-slate-900 p-0 text-slate-100 shadow-2xl backdrop:bg-slate-950/70 open:flex open:flex-col"
      onCancel={(e) => {
        if (busy) {
          e.preventDefault()
          return
        }
        onClose()
      }}
      onClick={(e) => {
        if (busy) return
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="flex max-h-[85vh] flex-col gap-3 overflow-y-auto p-5" aria-busy={busy}>
        <h2 id={titleId} className="text-lg font-semibold text-slate-50">
          Provision gym
        </h2>
        <p className="text-sm text-slate-300">
          Creates a tenant, Owner account, defaults, and starts a trial. Leave gym code blank to
          auto-generate.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Gym name *" error={fieldErrors.name}>
            <input
              className={inputClass}
              value={values.name}
              disabled={busy}
              onChange={(e) => patch('name', e.target.value)}
              autoComplete="organization"
            />
          </Field>
          <Field label="Name (Arabic)" error={fieldErrors.nameAr}>
            <input
              className={inputClass}
              value={values.nameAr}
              disabled={busy}
              onChange={(e) => patch('nameAr', e.target.value)}
              dir="rtl"
            />
          </Field>
          <Field label="City *" error={fieldErrors.city}>
            <input
              className={inputClass}
              value={values.city}
              disabled={busy}
              onChange={(e) => patch('city', e.target.value)}
            />
          </Field>
          <Field label="Phone *" error={fieldErrors.phoneNumber}>
            <input
              className={inputClass}
              value={values.phoneNumber}
              disabled={busy}
              onChange={(e) => patch('phoneNumber', e.target.value)}
              autoComplete="tel"
            />
          </Field>
          <Field label="Gym email *" error={fieldErrors.email}>
            <input
              type="email"
              className={inputClass}
              value={values.email}
              disabled={busy}
              onChange={(e) => patch('email', e.target.value)}
              autoComplete="email"
            />
          </Field>
          <Field label="Address" error={fieldErrors.address}>
            <input
              className={inputClass}
              value={values.address}
              disabled={busy}
              onChange={(e) => patch('address', e.target.value)}
            />
          </Field>
          <Field label="Gym code (optional)" error={fieldErrors.gymCode}>
            <input
              className={inputClass}
              value={values.gymCode}
              disabled={busy}
              onChange={(e) => patch('gymCode', e.target.value)}
              placeholder="Auto if blank"
            />
          </Field>
          <Field label="Time zone (optional)" error={fieldErrors.timeZone}>
            <input
              className={inputClass}
              value={values.timeZone}
              disabled={busy}
              onChange={(e) => patch('timeZone', e.target.value)}
              placeholder="Africa/Cairo"
            />
          </Field>
          <Field label="Plan tier" error={fieldErrors.tier}>
            <select
              className={inputClass}
              value={values.tier}
              disabled={busy}
              onChange={(e) => patch('tier', e.target.value)}
            >
              {PROVISION_TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-1 border-t border-slate-700 pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Owner account</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Owner full name *" error={fieldErrors.ownerFullName}>
              <input
                className={inputClass}
                value={values.ownerFullName}
                disabled={busy}
                onChange={(e) => patch('ownerFullName', e.target.value)}
                autoComplete="name"
              />
            </Field>
            <Field label="Owner email *" error={fieldErrors.ownerEmail}>
              <input
                type="email"
                className={inputClass}
                value={values.ownerEmail}
                disabled={busy}
                onChange={(e) => patch('ownerEmail', e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="Owner password * (min 8)" error={fieldErrors.ownerPassword}>
              <input
                type="password"
                className={inputClass}
                value={values.ownerPassword}
                disabled={busy}
                onChange={(e) => patch('ownerPassword', e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          </div>
        </div>

        {submitError ? (
          <p role="alert" className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
            {submitError}
          </p>
        ) : null}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-[var(--radius)] border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleSubmit}
            className="rounded-[var(--radius)] bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? 'Provisioning…' : 'Provision gym'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
