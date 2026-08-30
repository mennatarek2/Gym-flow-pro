import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { platformLogin } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { InternalStrip } from '@/components/InternalStrip'
import { OtpInput } from '@/components/OtpInput'

export function MfaChallengePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const mfaPhase = useAuthStore((s) => s.mfaPhase)
  const pendingCredentials = useAuthStore((s) => s.pendingCredentials)
  const applySuccessfulAuth = useAuthStore((s) => s.applySuccessfulAuth)
  const clearMfaFlow = useAuthStore((s) => s.clearMfaFlow)

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (mfaPhase !== 'challenge' || !pendingCredentials) {
    return <Navigate to="/login" replace />
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const { status, data } = await platformLogin({
        email: pendingCredentials!.email,
        password: pendingCredentials!.password,
        mfaCode: code,
      })
      if (status === 200 && data.success && data.accessToken) {
        applySuccessfulAuth(data)
        const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
        navigate(from && from !== '/login' ? from : '/tenants', { replace: true })
        return
      }
      if (data.errorCode === 'MFA_INVALID') {
        setError('Incorrect code — check your authenticator app and try again.')
        return
      }
      setError(data.errorMessage || 'Authentication failed. Please try again.')
    } catch {
      setError('Unable to verify code. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen">
      <InternalStrip />
      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Enter authenticator code</h1>
          <p className="mt-2 text-sm text-gray-500">
            Platform Console access requires two-factor authentication because this tool can view every gym&apos;s account.
          </p>
        </div>
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-4 rounded-[var(--radius)] border border-gray-200 bg-white p-6"
        >
          <OtpInput value={code} onChange={setCode} autoFocus />
          <p className="text-xs text-gray-500">
            Code not working? Make sure your device&apos;s clock is correct — TOTP drifts when the device time is off.
          </p>
          {error ? (
            <p role="alert" className="rounded-[var(--radius)] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting || code.length < 6}
            className="rounded-[var(--radius)] bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? 'Verifying…' : 'Verify'}
          </button>
          <Link to="/login" onClick={() => clearMfaFlow()} className="text-center text-sm text-gray-500 underline">
            Back to login
          </Link>
        </form>
      </main>
    </div>
  )
}
