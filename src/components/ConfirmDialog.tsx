import { useEffect, useRef } from 'react'

export type ConfirmRequest = {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
}

/**
 * In-page confirm. Unlike window.confirm it keeps the click a user gesture, so the
 * confirm handler may open a file dialog (Safari blocks that after window.confirm).
 */
export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest | null
  onClose: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!request) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, onClose])

  if (!request) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div role="alertdialog" aria-modal className="w-full max-w-sm rounded-lg bg-surface-elevated p-4 shadow-xl">
        <h2 className="mb-1 text-sm font-semibold">{request.title}</h2>
        <p className="mb-4 text-xs text-muted">{request.message}</p>
        <div className="flex justify-end gap-2 text-xs">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface">
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => {
              onClose()
              request.onConfirm()
            }}
            className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700"
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
