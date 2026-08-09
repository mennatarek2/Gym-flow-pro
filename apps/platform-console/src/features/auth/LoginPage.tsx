import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { platformLogin } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { InternalStrip } from '@/components/InternalStrip'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
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
        navigate(from && from !== '/login' ? from : '/tenants', { replace: true })
        return
      }

      setError(data.errorMessage || 'Invalid email or password.')
    } catch {
      setError('Unable to reach the platform API. Check the API is running.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen">
      <InternalStrip />
      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">Sign in</h1>
          <p className="mt-2 text-sm text-slate-400">
            Platform Console access requires two-factor authentication because this tool can view every gym&apos;s account.
          </p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-[var(--radius)] border border-slate-700 bg-slate-900/70 p-6">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Email</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-[var(--radius)] border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100"
            />
          </label>
          {error ? (
            <p role="alert" className="rounded-[var(--radius)] border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-[var(--radius)] bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {submitting ? 'Signing in…' : 'Continue'}
          </button>
        </form>
      </main>
    </div>
  )
}
