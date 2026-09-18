import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { platformLogin } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'
import { InternalStrip } from '@/components/InternalStrip'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const t = useUiStore((s) => s.t)
  const beginMfaSetup = useAuthStore((s) => s.beginMfaSetup)
  const beginMfaChallenge = useAuthStore((s) => s.beginMfaChallenge)
  const applySuccessfulAuth = useAuthStore((s) => s.applySuccessfulAuth)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const { status, data } = await platformLogin({ email: email.trim(), password })
      const credentials = { email: email.trim(), password }

      if (status === 403 || data.mfaSetupRequired) {
        beginMfaSetup(data, credentials)
        navigate('/mfa-setup', { replace: true })
        return
      }

      if (status === 401 && data.errorCode === 'MFA_REQUIRED') {
        beginMfaChallenge(credentials)
        navigate('/mfa-challenge', { replace: true, state: location.state })
        return
      }

      if (status === 200 && data.success && data.accessToken) {
        applySuccessfulAuth(data)
        const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
        navigate(from && from !== '/login' ? from : '/oc', { replace: true })
        return
      }

      const message = data && typeof data === 'object' ? (data as { errorMessage?: string }).errorMessage : undefined

      if (status === 401) {
        setError(message || t('auth.invalidCredentials'))
        return
      }

      setError(message || t('errors.generic'))
    } catch {
      setError(t('errors.network'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen">
      <InternalStrip />
      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
        <div>
          <h1 className="cp-page-title">{t('auth.signIn')}</h1>
          <p className="cp-page-subtitle">{t('auth.platformHint')}</p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-white p-6">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text)]">{t('auth.email')}</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="cp-input"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text)]">{t('auth.password')}</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="cp-input"
            />
          </label>
          {error ? (
            <p role="alert" className="rounded-[var(--radius)] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={submitting} className="cp-btn cp-btn-primary disabled:opacity-60">
            {submitting ? t('auth.signingIn') : t('common.continue')}
          </button>
        </form>
      </main>
    </div>
  )
}
