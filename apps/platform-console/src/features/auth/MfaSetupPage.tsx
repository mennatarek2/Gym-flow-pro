import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { platformMfaSetup } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { InternalStrip } from '@/components/InternalStrip'
import { OtpInput } from '@/components/OtpInput'
import { useUiStore } from '@/stores/ui-store'

export function MfaSetupPage() {
  const t = useUiStore((s) => s.t)
  const navigate = useNavigate()
  const mfaPhase = useAuthStore((s) => s.mfaPhase)
  const setupToken = useAuthStore((s) => s.setupToken)
  const otpAuthUri = useAuthStore((s) => s.otpAuthUri)
  const mfaManualKey = useAuthStore((s) => s.mfaManualKey)
  const applySuccessfulAuth = useAuthStore((s) => s.applySuccessfulAuth)
  const clearMfaFlow = useAuthStore((s) => s.clearMfaFlow)

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  if (mfaPhase !== 'setup' || !setupToken) {
    return <Navigate to="/login" replace />
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const { status, data } = await platformMfaSetup({ setupToken: setupToken!, mfaCode: code })
      if (status === 200 && data.success && data.accessToken) {
        applySuccessfulAuth(data)
        navigate('/oc', { replace: true })
        return
      }
      if (data.errorCode === 'SETUP_TOKEN_EXPIRED' || data.errorCode === 'SETUP_TOKEN_INVALID') {
        setExpired(true)
        setError(t('auth.mfaSetupExpired'))
        return
      }
      setError(data.errorMessage || t('auth.mfaBadCode'))
    } catch {
      setError(t('auth.mfaSetupFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen">
      <InternalStrip />
      <main className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-12">
        <div>
          <h1 className="cp-page-title">{t('auth.mfaSetupTitle')}</h1>
          <p className="mt-2 text-sm text-gray-500">{t('auth.mfaHint')}</p>
        </div>
        <div className="rounded-[var(--radius)] border border-gray-200 bg-white p-6">
          {otpAuthUri ? (
            <div className="mb-4 flex justify-center rounded bg-white p-4">
              <QRCodeSVG value={otpAuthUri} size={180} />
            </div>
          ) : null}
          {mfaManualKey ? (
            <p className="mb-4 text-sm text-gray-700">
              {t('auth.mfaManual')}{' '}
              <code className="select-all rounded bg-white px-2 py-1 font-[var(--mono)] text-blue-600">
                {mfaManualKey}
              </code>
            </p>
          ) : null}
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <OtpInput value={code} onChange={setCode} autoFocus />
            {error ? (
              <p role="alert" className="rounded-[var(--radius)] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}{' '}
                {expired ? (
                  <Link
                    to="/login"
                    onClick={() => clearMfaFlow()}
                    className="underline"
                  >
                    {t('auth.mfaBackLogin')}
                  </Link>
                ) : null}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={submitting || code.length < 6}
              className="cp-btn cp-btn-primary disabled:opacity-60"
            >
              {submitting ? t('auth.mfaVerifying') : t('auth.mfaEnable')}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
