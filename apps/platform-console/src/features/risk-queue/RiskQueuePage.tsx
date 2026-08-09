import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { RiskBandBadge, StatusBadge, TierBadge } from '@/components/Badges'
import {
  assignRiskQueue,
  fetchRiskQueue,
  recordRiskQueueOutcome,
} from '@/lib/api'
import { ApiClientError } from '@/lib/api/errors'
import {
  RISK_QUEUE_BANDS,
  RISK_QUEUE_OUTCOMES,
  type RiskQueueItemDto,
  type RiskQueueOutcomeValue,
} from '@/lib/api/types'
import { formatCairoDateTime } from '@/lib/format'
import { isOpsOrAbove } from '@/lib/platform-roles'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'

type ModalKind = 'assign' | 'clear' | 'outcome' | null

function shortId(id?: string | null): string {
  if (!id) return '—'
  return id.slice(0, 8)
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.status === 403) return 'Forbidden — Requires Platform Ops (403).'
    return err.message
  }
  if (err instanceof Error) return err.message
  return 'Request failed'
}

export function RiskQueuePage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showToast = useUiStore((s) => s.showToast)
  const user = useAuthStore((s) => s.user)
  const ops = isOpsOrAbove(user?.role)

  const band = params.get('band') ?? ''
  const selectedBands = useMemo(
    () => new Set(band.split(',').map((s) => s.trim()).filter(Boolean)),
    [band],
  )

  const queryKey = useMemo(() => ['risk-queue', { band }] as const, [band])
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => fetchRiskQueue(band || undefined),
  })

  const [modal, setModal] = useState<ModalKind>(null)
  const [target, setTarget] = useState<RiskQueueItemDto | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<RiskQueueOutcomeValue>('contacted')
  const [note, setNote] = useState('')

  function patchBandToggle(value: string) {
    const next = new Set(selectedBands)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    const joined = Array.from(next).join(',')
    const sp = new URLSearchParams(params)
    if (joined) sp.set('band', joined)
    else sp.delete('band')
    setParams(sp, { replace: true })
  }

  function openModal(kind: ModalKind, row: RiskQueueItemDto) {
    setTarget(row)
    setModal(kind)
    setFormError(null)
    setOutcome('contacted')
    setNote('')
  }

  function closeModal(force = false) {
    if (!force && (assignMutation.isPending || outcomeMutation.isPending)) return
    setModal(null)
    setTarget(null)
    setFormError(null)
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['risk-queue'] })

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('No tenant')
      if (modal === 'clear') {
        return assignRiskQueue(target.tenantId, { assignedPlatformUserId: null })
      }
      if (!user?.id) throw new Error('Missing platform user id')
      return assignRiskQueue(target.tenantId, { assignedPlatformUserId: user.id })
    },
    onSuccess: async () => {
      showToast(modal === 'clear' ? 'Assignee cleared' : 'Assigned to you', 'success')
      await invalidate()
      closeModal(true)
    },
    onError: (err) => setFormError(errorMessage(err)),
  })

  const outcomeMutation = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('No tenant')
      return recordRiskQueueOutcome(target.tenantId, {
        outcome,
        note: note.trim() || undefined,
      })
    },
    onSuccess: async () => {
      showToast('Outcome recorded', 'success')
      await invalidate()
      closeModal(true)
    },
    onError: (err) => setFormError(errorMessage(err)),
  })

  function openTenant(row: RiskQueueItemDto) {
    const returnTo = `/risk-queue${params.toString() ? `?${params.toString()}` : ''}`
    navigate(`/tenants/${row.tenantId}?returnTo=${encodeURIComponent(returnTo)}`)
  }

  const rows = data ?? []
  const colCount = 10

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">Risk Queue</h1>
          <p className="text-sm text-slate-400">
            Churn early-warning — default bands at_risk + critical when no filter is set.
          </p>
        </div>
        {isFetching && !isLoading ? (
          <span className="text-xs text-slate-500">Refreshing…</span>
        ) : null}
      </header>

      <div className="rounded-[var(--radius)] border border-slate-700 bg-slate-900/50 p-4">
        <fieldset>
          <legend className="mb-2 text-sm text-slate-400">Risk band</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {RISK_QUEUE_BANDS.map((b) => (
              <label key={b} className="inline-flex items-center gap-2 text-slate-200">
                <input
                  type="checkbox"
                  checked={selectedBands.has(b)}
                  onChange={() => patchBandToggle(b)}
                />
                <span className="capitalize">{b.replace(/_/g, ' ')}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Leave unchecked to use server default (at_risk, critical).
          </p>
        </fieldset>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-slate-700">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-900/80 text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium">Gym</th>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Tier</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Score</th>
              <th className="px-3 py-2 font-medium">Risk</th>
              <th className="px-3 py-2 font-medium">Computed</th>
              <th className="px-3 py-2 font-medium">Assignee</th>
              <th className="px-3 py-2 font-medium">Summary</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
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
                  Failed to load risk queue.{' '}
                  <button type="button" className="underline" onClick={() => refetch()}>
                    Retry
                  </button>
                </td>
              </tr>
            ) : null}
            {!isLoading && !isError && rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-8 text-center text-slate-400">
                  No gyms in this risk queue.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => {
              const assignedToMe =
                !!row.assignedPlatformUserId && row.assignedPlatformUserId === user?.id
              return (
                <tr key={row.tenantId} className="border-t border-slate-800 hover:bg-slate-900/70">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-left font-medium text-sky-300 underline-offset-2 hover:underline"
                      onClick={() => openTenant(row)}
                    >
                      {row.name || '—'}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-[var(--mono)] text-slate-300">{row.gymCode || '—'}</td>
                  <td className="px-3 py-2">
                    <TierBadge tier={row.planTier} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={row.subscriptionStatus} />
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-100">{row.score}</td>
                  <td className="px-3 py-2">
                    <RiskBandBadge band={row.riskBand} />
                  </td>
                  <td className="px-3 py-2 text-slate-300">
                    {formatCairoDateTime(row.computedAtUtc)}
                  </td>
                  <td className="px-3 py-2 text-slate-300">
                    {row.assignedPlatformUserId
                      ? assignedToMe
                        ? 'You'
                        : shortId(row.assignedPlatformUserId)
                      : '—'}
                  </td>
                  <td className="max-w-[14rem] truncate px-3 py-2 text-slate-400" title={row.summary ?? ''}>
                    {row.summary || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <span title={ops ? undefined : 'Requires Platform Ops'}>
                        <button
                          type="button"
                          disabled={!ops}
                          onClick={() => openModal('assign', row)}
                          className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Assign me
                        </button>
                      </span>
                      <span title={ops ? undefined : 'Requires Platform Ops'}>
                        <button
                          type="button"
                          disabled={!ops || !row.assignedPlatformUserId}
                          onClick={() => openModal('clear', row)}
                          className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Clear
                        </button>
                      </span>
                      <button
                        type="button"
                        onClick={() => openModal('outcome', row)}
                        className="rounded border border-sky-800 bg-sky-950/40 px-2 py-0.5 text-xs text-sky-100 hover:bg-sky-900/50"
                      >
                        Outcome
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={modal === 'assign'}
        title="Assign to you"
        description={
          target ? (
            <>
              Assign <strong>{target.name}</strong> ({target.gymCode}) to your platform user.
            </>
          ) : null
        }
        confirmLabel="Assign"
        busy={assignMutation.isPending}
        error={formError}
        onConfirm={() => assignMutation.mutate()}
        onClose={closeModal}
      />

      <ConfirmDialog
        open={modal === 'clear'}
        title="Clear assignee"
        description={
          target ? (
            <>
              Clear the assignee on <strong>{target.name}</strong> ({target.gymCode}).
            </>
          ) : null
        }
        confirmLabel="Clear"
        confirmTone="danger"
        busy={assignMutation.isPending}
        error={formError}
        onConfirm={() => assignMutation.mutate()}
        onClose={closeModal}
      />

      <ConfirmDialog
        open={modal === 'outcome'}
        title="Record outcome"
        description={
          target ? (
            <>
              Log a call-sheet outcome for <strong>{target.name}</strong> ({target.gymCode}).
            </>
          ) : null
        }
        confirmLabel="Save outcome"
        busy={outcomeMutation.isPending}
        error={formError}
        onConfirm={() => outcomeMutation.mutate()}
        onClose={closeModal}
      >
        <label className="mt-1 block text-sm">
          <span className="text-slate-400">Outcome</span>
          <select
            value={outcome}
            disabled={outcomeMutation.isPending}
            onChange={(e) => setOutcome(e.target.value as RiskQueueOutcomeValue)}
            className="mt-1 w-full rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2"
          >
            {RISK_QUEUE_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-2 block text-sm">
          <span className="text-slate-400">Note (optional)</span>
          <textarea
            value={note}
            disabled={outcomeMutation.isPending}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2"
            placeholder="What happened on the call…"
          />
        </label>
      </ConfirmDialog>
    </div>
  )
}
