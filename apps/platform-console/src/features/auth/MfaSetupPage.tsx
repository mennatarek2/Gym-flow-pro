import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { platformMfaSetup } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { InternalStrip } from '@/components/InternalStrip'
import { OtpInput } from '@/components/OtpInput'

export function MfaSetupPage() {
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
        navigate('/tenants', { replace: true })
        return
      }
      if (data.errorCode === 'SETUP_TOKEN_EXPIRED' || data.errorCode === 'SETUP_TOKEN_INVALID') {
        setExpired(true)
        setError('This setup link expired. Please log in again.')
        return
      }
      setError(data.errorMessage || 'Incorrect code — check your authenticator app and try again.')
    } catch {
      setError('Unable to complete MFA setup. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen">
      <InternalStrip />
      <main className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-12">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Set up authenticator</h1>
          <p className="mt-2 text-sm text-gray-500">
            Platform Console access requires two-factor authentication because this tool can view every gym&apos;s account.
          </p>
        </div>
        <div className="rounded-[var(--radius)] border border-gray-200 bg-white p-6">
          {otpAuthUri ? (
            <div className="mb-4 flex justify-center rounded bg-white p-4">
              <QRCodeSVG value={otpAuthUri} size={180} />
            </div>
          ) : null}
          {mfaManualKey ? (
            <p className="mb-4 text-sm text-gray-700">
              Can&apos;t scan? Enter this key manually:{' '}
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
                    Back to login
                  </Link>
                ) : null}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={submitting || code.length < 6}
              className="rounded-[var(--radius)] bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? 'Verifying…' : 'Enable MFA & continue'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
