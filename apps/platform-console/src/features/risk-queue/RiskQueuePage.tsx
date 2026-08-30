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
import { factorLabel } from '@/features/tenants/HealthScorePanel'
import { formatCairoDateTime } from '@/lib/format'
import { isOpsOrAbove } from '@/lib/platform-roles'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'

type ModalKind = 'assign' | 'clear' | 'outcome' | null
type AssignmentFilter = 'all' | 'assigned' | 'unassigned'
/**
 * UX-only grouping — there is no persisted "status" field on the backend risk queue row.
 * Derived purely from the existing recentOutcomes[] the API already returns:
 *   - no outcome recorded yet          -> 'new'
 *   - latest outcome is a terminal one -> 'resolved' (retained or churned)
 *   - latest outcome is anything else  -> 'in_progress' (contacted / no_answer / watching)
 * If this needs to become a real, independently-settable queue state, that requires a backend
 * field — do not fake persistence for it here.
 */
type QueueStatus = 'new' | 'in_progress' | 'resolved'
type StatusFilter = 'all' | QueueStatus

const TERMINAL_OUTCOMES = new Set(['retained', 'churned'])

export function deriveStatus(row: RiskQueueItemDto): QueueStatus {
  const latest = row.recentOutcomes[0]
  if (!latest) return 'new'
  return TERMINAL_OUTCOMES.has(latest.outcome) ? 'resolved' : 'in_progress'
}

const STATUS_LABEL: Record<QueueStatus, string> = {
  new: 'New',
  in_progress: 'In Progress',
  resolved: 'Resolved',
}

const STATUS_BADGE: Record<QueueStatus, string> = {
  new: 'bg-gray-100 text-gray-800 ring-1 ring-gray-200',
  in_progress: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
  resolved: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
}

export function ageLabel(computedAtUtc: string): string {
  const ms = Date.now() - new Date(computedAtUtc).getTime()
  const days = Math.max(0, Math.floor(ms / 86_400_000))
  return days === 0 ? '<1d' : `${days}d`
}

interface RulesV1Signal {
  key?: string
  label?: string
  available?: boolean
  score?: number | null
}
interface RulesV1Payload {
  signals?: RulesV1Signal[]
}

/** Top two lowest-scoring available signals — same rules_v1 payload the Health tab parses. */
export function primaryDrivers(contributingFactorsJson?: string | null): string[] {
  if (!contributingFactorsJson) return []
  let payload: RulesV1Payload | null = null
  try {
    payload = JSON.parse(contributingFactorsJson) as RulesV1Payload
  } catch {
    return []
  }
  const signals = payload?.signals ?? []
  return signals
    .filter((s) => s.available && s.score != null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 2)
    .map((s) => factorLabel(s.key ?? 'unknown', s.label))
}

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
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const queryKey = useMemo(() => ['risk-queue', { band }] as const, [band])
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => fetchRiskQueue(band || undefined),
  })

  const rows = useMemo(() => {
    let list = data ?? []
    if (assignmentFilter === 'assigned') list = list.filter((r) => !!r.assignedPlatformUserId)
    if (assignmentFilter === 'unassigned') list = list.filter((r) => !r.assignedPlatformUserId)
    if (statusFilter !== 'all') list = list.filter((r) => deriveStatus(r) === statusFilter)
    return list
  }, [data, assignmentFilter, statusFilter])

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

  const colCount = 9

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Risk Queue</h1>
          <p className="text-sm text-gray-500">
            Churn early-warning — default bands at_risk + critical when no filter is set.
          </p>
        </div>
        {isFetching && !isLoading ? (
          <span className="text-xs text-gray-500">Refreshing…</span>
        ) : null}
      </header>

      <div className="flex flex-col gap-4 rounded-[var(--radius)] border border-gray-200 bg-white p-4">
        <fieldset>
          <legend className="mb-2 text-sm text-gray-500">Risk band</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {RISK_QUEUE_BANDS.map((b) => (
              <label key={b} className="inline-flex items-center gap-2 text-gray-800">
                <input
                  type="checkbox"
                  checked={selectedBands.has(b)}
                  onChange={() => patchBandToggle(b)}
                />
                <span className="capitalize">{b.replace(/_/g, ' ')}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Leave unchecked to use server default (at_risk, critical).
          </p>
        </fieldset>

        <div className="flex flex-wrap gap-6 border-t border-gray-200 pt-3">
          <fieldset>
            <legend className="mb-1.5 text-xs uppercase tracking-wide text-gray-500">Assignment</legend>
            <div className="flex gap-1 rounded-[var(--radius)] border border-gray-200 bg-white p-0.5 text-sm">
              {(['all', 'assigned', 'unassigned'] as AssignmentFilter[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAssignmentFilter(v)}
                  className={`rounded px-2.5 py-1 capitalize ${
                    assignmentFilter === v ? 'bg-gray-200 text-blue-600' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-xs uppercase tracking-wide text-gray-500">
              Status (derived from outcomes)
            </legend>
            <div className="flex gap-1 rounded-[var(--radius)] border border-gray-200 bg-white p-0.5 text-sm">
              {(['all', 'new', 'in_progress', 'resolved'] as StatusFilter[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setStatusFilter(v)}
                  className={`rounded px-2.5 py-1 ${
                    statusFilter === v ? 'bg-gray-200 text-blue-600' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {v === 'all' ? 'All' : STATUS_LABEL[v]}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-gray-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Tenant</th>
              <th className="px-3 py-2 font-medium">Risk Score</th>
              <th className="px-3 py-2 font-medium">Risk Band</th>
              <th className="px-3 py-2 font-medium">Primary Drivers</th>
              <th className="px-3 py-2 font-medium">Assigned To</th>
              <th className="px-3 py-2 font-medium">Age</th>
              <th className="px-3 py-2 font-medium">Last Action</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-gray-200">
                    {Array.from({ length: colCount }).map((__, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="h-4 animate-pulse rounded bg-gray-200" />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {isError ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-8 text-center text-red-600">
                  Failed to load risk queue.{' '}
                  <button type="button" className="underline" onClick={() => refetch()}>
                    Retry
                  </button>
                </td>
              </tr>
            ) : null}
            {!isLoading && !isError && rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-8 text-center text-gray-500">
                  No gyms match these filters.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => {
              const assignedToMe =
                !!row.assignedPlatformUserId && row.assignedPlatformUserId === user?.id
              const drivers = primaryDrivers(row.contributingFactorsJson)
              const status = deriveStatus(row)
              const lastOutcome = row.recentOutcomes[0]
              return (
                <tr key={row.tenantId} className="border-t border-gray-200 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-left font-medium text-blue-600 underline-offset-2 hover:underline"
                      onClick={() => openTenant(row)}
                    >
                      {row.name || '—'}
                    </button>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="font-[var(--mono)] text-xs text-gray-500">{row.gymCode || '—'}</span>
                      <TierBadge tier={row.planTier} />
                      <StatusBadge status={row.subscriptionStatus} />
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-gray-900">{row.score}</td>
                  <td className="px-3 py-2">
                    <RiskBandBadge band={row.riskBand} />
                  </td>
                  <td className="max-w-[16rem] px-3 py-2 text-gray-500">
                    {drivers.length ? drivers.join(', ') : row.summary || '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {row.assignedPlatformUserId
                      ? assignedToMe
                        ? 'You'
                        : shortId(row.assignedPlatformUserId)
                      : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{ageLabel(row.computedAtUtc)}</td>
                  <td className="max-w-[12rem] px-3 py-2 text-gray-500">
                    {lastOutcome ? (
                      <>
                        <span className="capitalize">{lastOutcome.outcome.replace(/_/g, ' ')}</span>
                        <div className="text-xs text-gray-400">{formatCairoDateTime(lastOutcome.createdAtUtc)}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[status]}`}>
                      {STATUS_LABEL[status]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <span title={ops ? undefined : 'Requires Platform Ops'}>
                        <button
                          type="button"
                          disabled={!ops}
                          onClick={() => openModal('assign', row)}
                          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-900 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Assign me
                        </button>
                      </span>
                      <span title={ops ? undefined : 'Requires Platform Ops'}>
                        <button
                          type="button"
                          disabled={!ops || !row.assignedPlatformUserId}
                          onClick={() => openModal('clear', row)}
                          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-900 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Clear
                        </button>
                      </span>
                      <button
                        type="button"
                        onClick={() => openModal('outcome', row)}
                        className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-800 hover:bg-blue-100"
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
          <span className="text-gray-500">Outcome</span>
          <select
            value={outcome}
            disabled={outcomeMutation.isPending}
            onChange={(e) => setOutcome(e.target.value as RiskQueueOutcomeValue)}
            className="mt-1 w-full rounded-[var(--radius)] border border-gray-300 bg-white px-3 py-2"
          >
            {RISK_QUEUE_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-2 block text-sm">
          <span className="text-gray-500">Note (optional)</span>
          <textarea
            value={note}
            disabled={outcomeMutation.isPending}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-[var(--radius)] border border-gray-300 bg-white px-3 py-2"
            placeholder="What happened on the call…"
          />
        </label>
      </ConfirmDialog>
    </div>
  )
}
