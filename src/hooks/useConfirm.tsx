import { useCallback, useState, type ReactNode } from 'react'
import { ConfirmDialog, type ConfirmRequest } from '../components/ConfirmDialog'

/** In-page confirm instead of window.confirm: render `dialog`, call `ask` to show it. */
export function useConfirm(): { dialog: ReactNode; ask: (request: ConfirmRequest) => void } {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const close = useCallback(() => setRequest(null), [])
  return { dialog: <ConfirmDialog request={request} onClose={close} />, ask: setRequest }
}
