import { useEffect, useId, useRef, type ReactNode } from 'react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  confirmTone?: 'danger' | 'default'
  busy?: boolean
  error?: string | null
  /** Disable confirm (e.g. validation failed). */
  confirmDisabled?: boolean
  onConfirm: () => void
  onClose: () => void
  children?: ReactNode
}

/**
 * Modal dialog for Stage 2 write confirmations.
 * Native &lt;dialog&gt; — no shadcn dependency in this app; styled to match the light Control Plane.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmTone = 'default',
  busy = false,
  error = null,
  confirmDisabled = false,
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      el.showModal()
    } else if (!open && el.open) {
      el.close()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="w-[min(100%,28rem)] rounded-[var(--radius)] border border-gray-200 bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-black/40 open:flex open:flex-col"
      onCancel={(e) => {
        if (busy) {
          e.preventDefault()
          return
        }
        onClose()
      }}
      onClick={(e) => {
        if (busy) return
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="flex flex-col gap-3 p-5" aria-busy={busy}>
        <h2 id={titleId} className="text-lg font-semibold text-gray-900">
          {title}
        </h2>
        <div className="text-sm text-gray-700">{description}</div>
        {children}
        {error ? (
          <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-[var(--radius)] border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
            className={`rounded-[var(--radius)] px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
              confirmTone === 'danger'
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
