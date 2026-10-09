import { useEffect, useState } from 'react'
import { getOptimizedPng, peekOptimizedPng } from '../lib/optimizePng'

/** Wait for edits to settle before spending main-thread time on oxipng. */
const START_DELAY_MS = 500

/**
 * Size of the PNG as it will be exported (after oxipng). `exact` is false while
 * the optimization runs; `bytes` is then the raw size.
 */
export function useOptimizedSize(blob: Blob | null | undefined, enabled: boolean) {
  const [done, setDone] = useState<{ blob: Blob; size: number } | null>(null)

  useEffect(() => {
    if (!blob || !enabled || peekOptimizedPng(blob)) return
    let cancelled = false
    const t = window.setTimeout(() => {
      void getOptimizedPng(blob)
        .then((out) => {
          if (!cancelled) setDone({ blob, size: out.size })
        })
        .catch(() => {})
    }, START_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [blob, enabled])

  if (!blob) return null
  const cached = peekOptimizedPng(blob)
  if (cached) return { bytes: cached.size, exact: true }
  if (done?.blob === blob) return { bytes: done.size, exact: true }
  return { bytes: blob.size, exact: false }
}
