import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type ThumbMetrics = {
  show: boolean
  thumbHeight: number
  thumbTop: number
}

function measureThumb(el: HTMLDivElement): ThumbMetrics {
  const { scrollTop, scrollHeight, clientHeight } = el
  const overflow = scrollHeight - clientHeight
  const show = overflow > 2
  if (!show) {
    return { show: false, thumbHeight: 0, thumbTop: 0 }
  }
  const thumbHeight = Math.max(28, (clientHeight / scrollHeight) * clientHeight)
  const maxThumbTop = clientHeight - thumbHeight
  const thumbTop = maxThumbTop * (scrollTop / overflow)
  return { show: true, thumbHeight, thumbTop }
}

type Props = {
  children: ReactNode
  className?: string
}

export function ScrollArea({ children, className = '' }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<ThumbMetrics>({
    show: false,
    thumbHeight: 0,
    thumbTop: 0,
  })

  const refresh = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    setThumb(measureThumb(el))
  }, [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    refresh()
    const ro = new ResizeObserver(refresh)
    ro.observe(el)
    el.addEventListener('scroll', refresh, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', refresh)
    }
  }, [refresh, children])

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track || e.button !== 0) return

    const jump = (clientY: number) => {
      const rect = track.getBoundingClientRect()
      const ratio = (clientY - rect.top) / rect.height
      const overflow = viewport.scrollHeight - viewport.clientHeight
      viewport.scrollTop = ratio * overflow
    }

    jump(e.clientY)

    const onMove = (ev: PointerEvent) => jump(ev.clientY)
    const onUp = () => {
      track.releasePointerCapture(e.pointerId)
      track.removeEventListener('pointermove', onMove)
      track.removeEventListener('pointerup', onUp)
    }
    track.setPointerCapture(e.pointerId)
    track.addEventListener('pointermove', onMove)
    track.addEventListener('pointerup', onUp)
  }

  return (
    <div className={`flex min-h-0 flex-1 gap-1.5 ${className}`}>
      <div
        ref={viewportRef}
        className="scrollbar-none min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {children}
      </div>
      {thumb.show ? (
        <div
          ref={trackRef}
          role="scrollbar"
          aria-orientation="vertical"
          aria-hidden
          onPointerDown={onTrackPointerDown}
          className="relative my-0.5 w-1.5 shrink-0 cursor-pointer rounded-full bg-border/70"
        >
          <div
            className="absolute left-0 w-full rounded-full bg-muted/90 shadow-sm transition-[background-color] hover:bg-foreground/35 pointer-events-none"
            style={{
              height: thumb.thumbHeight,
              transform: `translateY(${thumb.thumbTop}px)`,
            }}
          />
        </div>
      ) : (
        <div className="w-1.5 shrink-0" aria-hidden />
      )}
    </div>
  )
}
