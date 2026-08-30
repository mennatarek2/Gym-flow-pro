import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  changePlatformUserRole,
  createPlatformUser,
  disablePlatformUser,
  fetchPlatformUsers,
  reactivatePlatformUser,
} from '@/lib/api'
import { ApiClientError } from '@/lib/api/errors'
import { PLATFORM_USER_ROLES, type PlatformUserDto } from '@/lib/api/types'
import { formatCairoDateTime } from '@/lib/format'
import { isAdmin } from '@/lib/platform-roles'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'

type ModalKind = 'create' | 'disable' | 'reactivate' | 'role' | null

const ROLE_LABEL: Record<string, string> = {
  platform_admin: 'Platform Admin',
  platform_ops: 'Platform Ops',
  platform_support: 'Platform Support',
}

const ROLE_BADGE: Record<string, string> = {
  platform_admin: 'bg-red-50 text-red-800 ring-1 ring-red-200',
  platform_ops: 'bg-blue-50 text-blue-800 ring-1 ring-blue-200',
  platform_support: 'bg-gray-100 text-gray-800 ring-1 ring-gray-200',
}

function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.status === 403) return 'Forbidden — Requires Platform Admin (403).'
    return err.message
  }
  if (err instanceof Error) return err.message
  return 'Request failed'
}

export function PlatformUsersPage() {
  const currentUser = useAuthStore((s) => s.user)
  const admin = isAdmin(currentUser?.role)

  if (!admin) {
    return (
      <div className="flex flex-col gap-4">
        <header>
          <h1 className="text-2xl font-semibold text-gray-900">Platform Users</h1>
          <p className="text-sm text-gray-500">Accounts with access to platform-level operations.</p>
        </header>
        <div className="rounded-[var(--radius)] border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-900">
          This section requires Platform Admin access. Your role ({currentUser?.role ?? 'unknown'}) cannot
          view or manage platform users — this is enforced by the backend, not just hidden here.
        </div>
      </div>
    )
  }

  return <PlatformUsersAdminView currentUserId={currentUser?.id ?? null} />
}

function PlatformUsersAdminView({ currentUserId }: { currentUserId: string | null }) {
  const showToast = useUiStore((s) => s.showToast)
  const queryClient = useQueryClient()

  const query = useQuery({ queryKey: ['platform-users'], queryFn: fetchPlatformUsers })

  const [modal, setModal] = useState<ModalKind>(null)
  const [target, setTarget] = useState<PlatformUserDto | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [newEmail, setNewEmail] = useState('')
  const [newFullName, setNewFullName] = useState('')
  const [newRole, setNewRole] = useState<string>(PLATFORM_USER_ROLES[0])
  const [newPassword, setNewPassword] = useState('')
  const [roleValue, setRoleValue] = useState<string>(PLATFORM_USER_ROLES[0])

  function openModal(kind: ModalKind, row?: PlatformUserDto) {
    setModal(kind)
    setTarget(row ?? null)
    setFormError(null)
    if (kind === 'create') {
      setNewEmail('')
      setNewFullName('')
      setNewRole(PLATFORM_USER_ROLES[0])
      setNewPassword('')
    }
    if (kind === 'role' && row) {
      setRoleValue(row.role)
    }
  }

  function closeModal() {
    if (busy) return
    setModal(null)
    setTarget(null)
    setFormError(null)
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['platform-users'] })

  const createMutation = useMutation({
    mutationFn: () => {
      if (newPassword.length < 10) {
        return Promise.reject(new Error('Password must be at least 10 characters.'))
      }
      return createPlatformUser({
        email: newEmail.trim(),
        fullName: newFullName.trim(),
        role: newRole,
        password: newPassword,
      })
    },
    onSuccess: async (user) => {
      showToast(`${user.fullName} created as ${roleLabel(user.role)}.`, 'success')
      await invalidate()
      closeModal()
    },
    onError: (err) => setFormError(errorMessage(err)),
  })

  const disableMutation = useMutation({
    mutationFn: () => {
      if (!target) return Promise.reject(new Error('No user selected.'))
      return disablePlatformUser(target.id)
    },
    onSuccess: async () => {
      showToast(`${target?.fullName} disabled.`, 'success')
      await invalidate()
      closeModal()
    },
    onError: (err) => setFormError(errorMessage(err)),
  })

  const reactivateMutation = useMutation({
    mutationFn: () => {
      if (!target) return Promise.reject(new Error('No user selected.'))
      return reactivatePlatformUser(target.id)
    },
    onSuccess: async () => {
      showToast(`${target?.fullName} reactivated.`, 'success')
      await invalidate()
      closeModal()
    },
    onError: (err) => setFormError(errorMessage(err)),
  })

  const roleMutation = useMutation({
    mutationFn: () => {
      if (!target) return Promise.reject(new Error('No user selected.'))
      return changePlatformUserRole(target.id, { role: roleValue })
    },
    onSuccess: async () => {
      showToast(`${target?.fullName} is now ${roleLabel(roleValue)}.`, 'success')
      await invalidate()
      closeModal()
    },
    onError: (err) => setFormError(errorMessage(err)),
  })

  const busy =
    createMutation.isPending || disableMutation.isPending || reactivateMutation.isPending || roleMutation.isPending

  const users = query.data ?? []
  const colCount = 7

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Platform Users</h1>
          <p className="text-sm text-gray-500">Accounts with access to platform-level operations.</p>
        </div>
        <button
          type="button"
          onClick={() => openModal('create')}
          className="rounded-[var(--radius)] bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Create Platform User
        </button>
      </header>

      <div
        role="status"
        className="rounded-[var(--radius)] border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-700"
      >
        Platform users have access to platform-level operations across every tenant. Tenant users (gym staff)
        are managed separately, per tenant.
      </div>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-gray-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Last Login</th>
              <th className="px-3 py-2 font-medium">Created</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-t border-gray-200">
                    {Array.from({ length: colCount }).map((__, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="h-4 animate-pulse rounded bg-gray-200" />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {query.isError ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-8 text-center text-red-600">
                  {query.error instanceof ApiClientError ? query.error.message : 'Failed to load platform users.'}{' '}
                  <button type="button" className="underline" onClick={() => query.refetch()}>
                    Retry
                  </button>
                </td>
              </tr>
            ) : null}
            {!query.isLoading && !query.isError && users.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-8 text-center text-gray-500">
                  No platform users yet.
                </td>
              </tr>
            ) : null}
            {users.map((u) => {
              const isSelf = currentUserId != null && u.id === currentUserId
              return (
                <tr key={u.id} className="border-t border-gray-200">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {u.fullName}
                    {isSelf ? <span className="ml-2 text-xs text-gray-500">(you)</span> : null}
                  </td>
                  <td className="px-3 py-2 font-[var(--mono)] text-xs text-gray-700">{u.email}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGE[u.role] ?? 'bg-gray-200 text-gray-800'}`}>
                      {roleLabel(u.role)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        u.isActive
                          ? 'inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200'
                          : 'inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200'
                      }
                    >
                      {u.isActive ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{formatCairoDateTime(u.lastLoginAtUtc)}</td>
                  <td className="px-3 py-2 text-gray-700">{formatCairoDateTime(u.createdAtUtc)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <span title={isSelf ? "You can't change your own role" : undefined}>
                        <button
                          type="button"
                          disabled={isSelf}
                          onClick={() => openModal('role', u)}
                          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-900 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Change Role
                        </button>
                      </span>
                      {u.isActive ? (
                        <span title={isSelf ? "You can't disable your own account" : undefined}>
                          <button
                            type="button"
                            disabled={isSelf}
                            onClick={() => openModal('disable', u)}
                            className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            Disable
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openModal('reactivate', u)}
                          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-900 hover:bg-gray-200"
                        >
                          Reactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={modal === 'create'}
        title="Create Platform User"
        description="Creates a new platform_support / platform_ops / platform_admin account. The new user completes MFA setup on first login."
        confirmLabel="Create User"
        busy={busy}
        error={formError}
        confirmDisabled={!newEmail.trim() || !newFullName.trim() || newPassword.length < 10}
        onClose={closeModal}
        onConfirm={() => createMutation.mutate()}
      >
        <label className="mt-2 block text-sm">
          <span className="text-gray-500">Full name</span>
          <input
            value={newFullName}
            disabled={busy}
            onChange={(e) => setNewFullName(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius)] border border-gray-300 bg-white px-3 py-2"
          />
        </label>
        <label className="mt-2 block text-sm">
          <span className="text-gray-500">Email</span>
          <input
            type="email"
            value={newEmail}
            disabled={busy}
            onChange={(e) => setNewEmail(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius)] border border-gray-300 bg-white px-3 py-2"
          />
        </label>
        <label className="mt-2 block text-sm">
          <span className="text-gray-500">Role</span>
          <select
            value={newRole}
            disabled={busy}
            onChange={(e) => setNewRole(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius)] border border-gray-300 bg-white px-3 py-2"
          >
            {PLATFORM_USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-2 block text-sm">
          <span className="text-gray-500">Temporary password (min 10 characters)</span>
          <input
            type="password"
            value={newPassword}
            disabled={busy}
            onChange={(e) => setNewPassword(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius)] border border-gray-300 bg-white px-3 py-2"
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={modal === 'disable'}
        title="Disable Platform User"
        description={target ? <>Disable <strong>{target.fullName}</strong>&apos;s platform access.</> : null}
        confirmLabel="Disable"
        confirmTone="danger"
        busy={busy}
        error={formError}
        onClose={closeModal}
        onConfirm={() => disableMutation.mutate()}
      />

      <ConfirmDialog
        open={modal === 'reactivate'}
        title="Reactivate Platform User"
        description={target ? <>Restore <strong>{target.fullName}</strong>&apos;s platform access.</> : null}
        confirmLabel="Reactivate"
        busy={busy}
        error={formError}
        onClose={closeModal}
        onConfirm={() => reactivateMutation.mutate()}
      />

      <ConfirmDialog
        open={modal === 'role'}
        title="Change Role"
        description={target ? <>Change <strong>{target.fullName}</strong>&apos;s role.</> : null}
        confirmLabel="Change Role"
        busy={busy}
        error={formError}
        confirmDisabled={target?.role === roleValue}
        onClose={closeModal}
        onConfirm={() => roleMutation.mutate()}
      >
        <label className="mt-2 block text-sm">
          <span className="text-gray-500">New role</span>
          <select
            value={roleValue}
            disabled={busy}
            onChange={(e) => setRoleValue(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius)] border border-gray-300 bg-white px-3 py-2"
          >
            {PLATFORM_USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </label>
      </ConfirmDialog>
    </div>
  )
}
