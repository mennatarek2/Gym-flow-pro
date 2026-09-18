import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { platformLogin } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { InternalStrip } from '@/components/InternalStrip'
import { OtpInput } from '@/components/OtpInput'
import { useUiStore } from '@/stores/ui-store'

export function MfaChallengePage() {
  const t = useUiStore((s) => s.t)
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
        navigate(from && from !== '/login' ? from : '/oc', { replace: true })
        return
      }
      if (data.errorCode === 'MFA_INVALID') {
        setError(t('auth.mfaBadCode'))
        return
      }
      setError(data.errorMessage || t('auth.mfaAuthFailed'))
    } catch {
      setError(t('auth.mfaVerifyFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen">
      <InternalStrip />
      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12">
        <div>
          <h1 className="cp-page-title">{t('auth.mfaChallengeTitle')}</h1>
          <p className="mt-2 text-sm text-gray-500">{t('auth.mfaHint')}</p>
        </div>
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-4 rounded-[var(--radius)] border border-gray-200 bg-white p-6"
        >
          <OtpInput value={code} onChange={setCode} autoFocus />
          <p className="text-xs text-gray-500">
            {t('auth.mfaClockHint')}
          </p>
          {error ? (
            <p role="alert" className="rounded-[var(--radius)] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting || code.length < 6}
            className="cp-btn cp-btn-primary disabled:opacity-60"
          >
            {submitting ? t('auth.mfaVerifying') : t('auth.mfaVerify')}
          </button>
          <Link to="/login" onClick={() => clearMfaFlow()} className="text-center text-sm text-gray-500 underline">
            {t('auth.mfaBackLogin')}
          </Link>
        </form>
      </main>
    </div>
  )
}
