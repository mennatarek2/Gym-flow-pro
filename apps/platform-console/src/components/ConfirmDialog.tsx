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
 * Native &lt;dialog&gt; — no shadcn dependency in this app; styled to match the slate console.
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
      className="w-[min(100%,28rem)] rounded-[var(--radius)] border border-slate-600 bg-slate-900 p-0 text-slate-100 shadow-2xl backdrop:bg-slate-950/70 open:flex open:flex-col"
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
        <h2 id={titleId} className="text-lg font-semibold text-slate-50">
          {title}
        </h2>
        <div className="text-sm text-slate-300">{description}</div>
        {children}
        {error ? (
          <p role="alert" className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        ) : null}
        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-[var(--radius)] border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
            className={`rounded-[var(--radius)] px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
              confirmTone === 'danger'
                ? 'bg-red-700 text-white hover:bg-red-600'
                : 'bg-sky-600 text-white hover:bg-sky-500'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
