import { useEffect, useState } from 'react'
import {
  minutesUntil,
  useImpersonationSessionStore,
} from '@/stores/impersonation-session-store'

/** Persistent shell cue so ops don't lose track of an open support session. */
export function ImpersonationSessionBanner() {
  const session = useImpersonationSessionStore((s) => s.session)
  const hydrate = useImpersonationSessionStore((s) => s.hydrate)
  const clearIfExpired = useImpersonationSessionStore((s) => s.clearIfExpired)
  const setSession = useImpersonationSessionStore((s) => s.setSession)
  const [mins, setMins] = useState(0)

  useEffect(() => {
    hydrate()
    const tick = () => {
      clearIfExpired()
      const s = useImpersonationSessionStore.getState().session
      if (s) setMins(minutesUntil(s.expiresAtUtc))
    }
    tick()
    const id = window.setInterval(tick, 15_000)
    return () => window.clearInterval(id)
  }, [hydrate, clearIfExpired])

  if (!session) return null

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <span>
        Active support session: <strong>{session.gymName}</strong>
        <span className="text-amber-700"> ({session.gymCode})</span>
        {mins > 0 ? (
          <>
            , expires in <strong>{mins} min</strong>
          </>
        ) : (
          <> — expired</>
        )}
      </span>
      <button
        type="button"
        className="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-900 hover:bg-amber-100"
        onClick={() => setSession(null)}
      >
        Dismiss indicator
      </button>
    </div>
  )
}
