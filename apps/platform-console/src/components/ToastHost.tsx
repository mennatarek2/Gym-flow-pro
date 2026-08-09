import { useEffect } from 'react'
import { useUiStore } from '@/stores/ui-store'

export function ToastHost() {
  const toast = useUiStore((s) => s.toast)
  const clearToast = useUiStore((s) => s.clearToast)

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => clearToast(), toast.durationMs ?? 4000)
    return () => window.clearTimeout(id)
  }, [toast, clearToast])

  if (!toast) return null

  const tone =
    toast.tone === 'error'
      ? 'border-red-700 bg-red-950 text-red-100'
      : toast.tone === 'success'
        ? 'border-emerald-700 bg-emerald-950 text-emerald-100'
        : 'border-slate-600 bg-slate-900 text-slate-100'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-[var(--radius)] border px-4 py-3 text-sm shadow-lg ${tone}`}
    >
      {toast.message}
    </div>
  )
}
