import { useEffect, useRef, useState } from 'react'
import type { FrameSize, RootOffset, SpineSymbol } from '../core/types'
import { renderSpinePreview, type PreviewResult } from '../spine/renderer'
import { maxFrameIndex } from '../spine/skeletonData'
import { Spinner } from './Spinner'

/** Preview resolution at 100% (fit); zooming in re-renders sharper, up to MAX_RENDER_SIDE. */
const PREVIEW_MAX_SIDE = 900
const MAX_RENDER_SIDE = 4096
const MIN_ZOOM = 0.25
const MAX_ZOOM = 32

type Box = { x: number; y: number; width: number; height: number }
/**
 * What is dragged: root guides (vertical x, horizontal y, intersection xy) or the
 * export frame's right edge (w), bottom edge (h) or corner (wh).
 */
type Axis = 'x' | 'y' | 'xy' | 'w' | 'h' | 'wh'

type Drag =
  | { kind: 'guide'; axis: Axis; x: number; y: number; root: RootOffset; size: FrameSize }
  | { kind: 'pan'; clientX: number; clientY: number; view: Box }

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

type Props = {
  symbol: SpineSymbol
  root: RootOffset
  frameSize: FrameSize
  /** Game cell, drawn centered in the export frame (guide only); 0×0 = hidden */
  cellSize: FrameSize
  onRootChange: (root: RootOffset) => void
  /** Dragging the frame's right/bottom edge resizes the static canvas (own size, or the shared default) */
  onFrameSizeChange: (size: FrameSize) => void
  /** Pausing playback commits the shown frame */
  onFrameChange: (frame: number) => void
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

/** Grow `box` (plus padding) to the element's aspect ratio, centered. */
function fitToAspect(box: Box, aspect: number): Box {
  const pad = Math.max(box.width, box.height) * 0.04
  let w = box.width + 2 * pad
  let h = box.height + 2 * pad
  if (w / h > aspect) h = w / aspect
  else w = h * aspect
  return { x: box.x + box.width / 2 - w / 2, y: box.y + box.height / 2 - h / 2, width: w, height: h }
}

/**
 * Whole skeleton at the selected frame. The export root is the intersection of two
 * independent guides (vertical = x, horizontal = y); the dashed box is the exported
 * canvas, whose top-left corner is the root. Coordinates are pixels relative to the
 * skeleton's root bone (gray cross), y down.
 *
 * Navigation: drag empty space to pan, ⌘/Ctrl + wheel or pinch to zoom. The view is
 * fitted once per symbol (mount with `key={symbol name}`) and again only with Fit.
 */
export function SpinePreview({
  symbol,
  root,
  frameSize,
  cellSize,
  onRootChange,
  onFrameSizeChange,
  onFrameChange,
}: Props) {
  const [preview, setPreview] = useState<{
    result: PreviewResult
    /** What this image shows; differs from the current pose while re-rendering */
    for: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Drag | null>(null)
  /** Offset readout next to the cursor */
  const [label, setLabel] = useState<{ left: number; top: number; axis: Axis } | null>(null)
  /**
   * Current view. Fitted once, when the first preview arrives (or with Fit) — then it
   * stays put while frames/animations change, so the skeleton never jumps.
   */
  const [viewState, setViewState] = useState<Box | null>(null)
  /** Width of the view at the last fit: 100% for the zoom readout */
  const [fitWidth, setFitWidth] = useState<number | null>(null)
  const [elSize, setElSize] = useState({ width: 600, height: 400 })
  /** Frame shown while playing (local; committed to the symbol on pause) */
  const [playFrame, setPlayFrame] = useState<number | null>(null)
  const playing = playFrame != null

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setElSize({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const frameBox: Box = { x: root.x, y: root.y, ...frameSize }
  const fitFor = (bounds: Box | null) =>
    fitToAspect(bounds ? union(bounds, frameBox) : frameBox, elSize.width / elSize.height)
  const fitView = fitFor(preview?.result.bounds ?? null)
  const view = viewState ?? fitView
  const zoom = (fitWidth ?? fitView.width) / view.width
  /** Marker sizes in world units so they look the same at any zoom */
  const unit = view.width / 300
  const setView = (v: Box) => setViewState(v)

  /** Screen placement of the rendered frame: same math as preserveAspectRatio="xMidYMid meet". */
  const canvasBox = (() => {
    if (!preview) return null
    const k = Math.min(elSize.width / view.width, elSize.height / view.height)
    const ox = (elSize.width - view.width * k) / 2
    const oy = (elSize.height - view.height * k) / 2
    const b = preview.result.bounds
    return {
      left: ox + (b.x - view.x) * k,
      top: oy + (b.y - view.y) * k,
      width: b.width * k,
      height: b.height * k,
    }
  })()
  const fit = (v: Box) => {
    setViewState(v)
    setFitWidth(v.width)
  }
  /** Latest fit function for the async renderer (first-preview fit) */
  const fitForRef = useRef(fitFor)
  useEffect(() => {
    fitForRef.current = fitFor
  })

  // Render at the resolution it is shown at (CSS px × devicePixelRatio), in power-of-two
  // steps so zooming does not re-render on every wheel tick.
  const screenPxPerUnit =
    Math.min(elSize.width / view.width, elSize.height / view.height) * (window.devicePixelRatio || 1)
  const boundsSide = preview
    ? Math.max(preview.result.bounds.width, preview.result.bounds.height)
    : PREVIEW_MAX_SIDE
  const renderSide = Math.min(
    MAX_RENDER_SIDE,
    2 ** Math.ceil(Math.log2(Math.max(512, boundsSide * screenPxPerUnit))),
  )

  const { source, animationName } = symbol
  const anim = source.animations.find((a) => a.name === animationName)
  const maxFrame = anim ? maxFrameIndex(anim.duration, source.fps) : 0
  const frame = playFrame ?? symbol.frame
  const poseKey = `${symbol.name}\t${animationName}\t${frame}`
  const loading = !error && !playing && preview?.for !== poseKey

  const playFrameRef = useRef(playFrame)
  useEffect(() => {
    playFrameRef.current = playFrame
  })
  // Playback: advance at the animation's fps, looping; pause commits the frame.
  useEffect(() => {
    if (!playing || !anim) return
    const start = performance.now() - (playFrameRef.current ?? 0) * (1000 / source.fps)
    let raf = 0
    const tick = (now: number) => {
      const f = Math.floor(((now - start) / 1000) * source.fps) % (maxFrame + 1)
      setPlayFrame((prev) => (prev === f ? prev : f))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // Restart only when playback starts/stops or the animation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, animationName, maxFrame, source.fps])
  const togglePlay = () => {
    if (playing) {
      onFrameChange(playFrame)
      setPlayFrame(null)
    } else {
      setPlayFrame(Math.min(symbol.frame, maxFrame))
    }
  }

  // Latest-only rendering: while one render runs, newer requests replace each other,
  // so scrubbing or playback never builds a backlog of stale renders.
  const wantRef = useRef<{ key: string; run: () => Promise<PreviewResult> } | null>(null)
  const runningRef = useRef(false)
  const aliveRef = useRef(true)
  // Declared before the render effect so a StrictMode remount re-enables rendering first.
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])
  useEffect(() => {
    wantRef.current = {
      key: poseKey,
      run: () => renderSpinePreview(source, { animationName, frame, fps: source.fps }, renderSide),
    }
    if (runningRef.current) return
    runningRef.current = true
    void (async () => {
      while (wantRef.current && aliveRef.current) {
        const req = wantRef.current
        wantRef.current = null
        try {
          const result = await req.run()
          if (!aliveRef.current) continue
          setPreview({ result, for: req.key })
          // First preview of this symbol: fit once.
          setViewState((v) => {
            if (v) return v
            const first = fitForRef.current(result.bounds)
            setFitWidth(first.width)
            return first
          })
          setError(null)
        } catch (e) {
          if (aliveRef.current) setError(e instanceof Error ? e.message : String(e))
        }
      }
      runningRef.current = false
    })()
  }, [source, animationName, frame, poseKey, renderSide])

  // Draw the rendered frame straight into the on-screen canvas (no PNG encode per frame).
  useEffect(() => {
    const target = canvasRef.current
    const src = preview?.result.canvas
    if (!target || !src) return
    if (target.width !== src.width) target.width = src.width
    if (target.height !== src.height) target.height = src.height
    const ctx = target.getContext('2d')
    ctx?.clearRect(0, 0, target.width, target.height)
    ctx?.drawImage(src, 0, 0)
  }, [preview])

  const toWorld = (clientX: number, clientY: number) => {
    const m = svgRef.current?.getScreenCTM()
    if (!m) return { x: 0, y: 0 }
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }

  /** Zoom by `factor` keeping world point `at` under the same screen position. */
  const zoomBy = (factor: number, at?: { x: number; y: number }) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor))
    const f = next / zoom
    if (f === 1) return
    const p = at ?? { x: view.x + view.width / 2, y: view.y + view.height / 2 }
    setView({
      x: p.x - (p.x - view.x) / f,
      y: p.y - (p.y - view.y) / f,
      width: view.width / f,
      height: view.height / f,
    })
  }

  // ⌘/Ctrl + wheel and trackpad pinch (sent as ctrl+wheel) zoom; plain wheel scrolls the page.
  const zoomByRef = useRef(zoomBy)
  useEffect(() => {
    zoomByRef.current = zoomBy
  })
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const m = svg.getScreenCTM()
      const at = m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : undefined
      // Mouse wheel notches are ~100 (capped to ×1.65 per notch); pinch deltas are small and smooth.
      const delta = Math.max(-50, Math.min(50, e.deltaY))
      zoomByRef.current(Math.exp(-delta * 0.01), at && { x: at.x, y: at.y })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const moveLabel = (e: React.PointerEvent, axis: Axis) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (rect) setLabel({ left: e.clientX - rect.left + 14, top: e.clientY - rect.top + 14, axis })
  }

  const startGuideDrag = (axis: Axis) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const p = toWorld(e.clientX, e.clientY)
    drag.current = { kind: 'guide', axis, x: p.x, y: p.y, root, size: frameSize }
    svgRef.current?.setPointerCapture(e.pointerId)
    moveLabel(e, axis)
  }

  /** Same offset readout on hover (not only while dragging) */
  const hover = (axis: Axis) => ({
    onPointerEnter: (e: React.PointerEvent) => {
      if (!drag.current) moveLabel(e, axis)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!drag.current) moveLabel(e, axis)
    },
    onPointerLeave: () => {
      if (!drag.current) setLabel(null)
    },
  })

  const endDrag = () => {
    drag.current = null
    setLabel(null)
  }

  const hit = unit * 8
  const guide = '#c026d3'
  const btn =
    'flex h-6 min-w-6 items-center justify-center rounded border border-border bg-surface-elevated/90 px-1.5 font-mono text-[11px] text-muted shadow-sm hover:border-accent hover:text-accent'

  return (
    <div className="space-y-1 rounded-lg border border-border bg-surface-elevated p-2">
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted">
        <span>
          Skeleton · drag the guides; their intersection (
          <span className="text-fuchsia-600">●</span>) is canvas 0,0 · drag the frame's edge to
          resize · <span className="text-cyan-600">cell</span> · drag empty space to pan ·
          ⌘/Ctrl + wheel to zoom
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {loading ? <Spinner size={10} /> : null}
          <span className="font-mono tabular-nums">
            root {signed(root.x)}, {signed(root.y)}
          </span>
        </span>
      </div>
      {error ? <p className="text-[11px] text-red-500">{error}</p> : null}
      <div
        ref={wrapRef}
        className="checkerboard relative h-[min(52vh,560px)] w-full overflow-hidden border border-border"
      >
        {/* Frame layer: an HTML canvas placed under the SVG with the same mapping as its
            viewBox (Safari ignores viewBox transforms for foreignObject content). */}
        {preview && canvasBox ? (
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute"
            style={canvasBox}
          />
        ) : null}
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 block size-full cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            drag.current = { kind: 'pan', clientX: e.clientX, clientY: e.clientY, view }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d) return
            if (d.kind === 'pan') {
              const m = svgRef.current?.getScreenCTM()
              const scale = m ? 1 / m.a : 1
              setView({
                ...d.view,
                x: d.view.x - (e.clientX - d.clientX) * scale,
                y: d.view.y - (e.clientY - d.clientY) * scale,
              })
              return
            }
            const p = toWorld(e.clientX, e.clientY)
            if (d.axis === 'w' || d.axis === 'h' || d.axis === 'wh') {
              onFrameSizeChange({
                width: d.axis === 'h' ? d.size.width : Math.max(1, Math.round(d.size.width + p.x - d.x)),
                height: d.axis === 'w' ? d.size.height : Math.max(1, Math.round(d.size.height + p.y - d.y)),
              })
              moveLabel(e, d.axis)
              return
            }
            onRootChange({
              x: d.axis === 'y' ? d.root.x : Math.round(d.root.x + p.x - d.x),
              y: d.axis === 'x' ? d.root.y : Math.round(d.root.y + p.y - d.y),
            })
            moveLabel(e, d.axis)
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >

          <rect
            x={frameBox.x}
            y={frameBox.y}
            width={frameBox.width}
            height={frameBox.height}
            fill="none"
            stroke={guide}
            strokeOpacity={0.6}
            strokeWidth={unit}
            strokeDasharray={`${unit * 4} ${unit * 3}`}
            pointerEvents="none"
          />
          {/* game cell, centered in the export frame */}
          {cellSize.width > 0 && cellSize.height > 0 ? (
            <rect
              x={frameBox.x + (frameBox.width - cellSize.width) / 2}
              y={frameBox.y + (frameBox.height - cellSize.height) / 2}
              width={cellSize.width}
              height={cellSize.height}
              fill="none"
              stroke="#0891b2"
              strokeWidth={unit}
              strokeDasharray={`${unit * 2} ${unit * 2}`}
              pointerEvents="none"
            />
          ) : null}
          {/* export frame: right edge = width, bottom edge = height, corner = both */}
          <line
            x1={frameBox.x + frameBox.width}
            y1={frameBox.y}
            x2={frameBox.x + frameBox.width}
            y2={frameBox.y + frameBox.height}
            stroke="transparent"
            strokeWidth={hit}
            className="cursor-ew-resize"
            onPointerDown={startGuideDrag('w')}
            {...hover('w')}
          />
          <line
            x1={frameBox.x}
            y1={frameBox.y + frameBox.height}
            x2={frameBox.x + frameBox.width}
            y2={frameBox.y + frameBox.height}
            stroke="transparent"
            strokeWidth={hit}
            className="cursor-ns-resize"
            onPointerDown={startGuideDrag('h')}
            {...hover('h')}
          />
          <rect
            x={frameBox.x + frameBox.width - unit * 3}
            y={frameBox.y + frameBox.height - unit * 3}
            width={unit * 6}
            height={unit * 6}
            fill="white"
            stroke={guide}
            strokeWidth={unit}
            className="cursor-nwse-resize"
            onPointerDown={startGuideDrag('wh')}
            {...hover('wh')}
          />
          {/* skeleton root bone (original root) */}
          <g stroke="#6b7280" strokeWidth={unit} pointerEvents="none">
            <line x1={-unit * 6} y1={0} x2={unit * 6} y2={0} />
            <line x1={0} y1={-unit * 6} x2={0} y2={unit * 6} />
          </g>
          {/* vertical guide → root x (long enough to cover any pan) */}
          <line
            x1={root.x}
            y1={view.y - view.height * 10}
            x2={root.x}
            y2={view.y + view.height * 11}
            stroke={guide}
            strokeWidth={unit}
            pointerEvents="none"
          />
          <line
            x1={root.x}
            y1={view.y - view.height * 10}
            x2={root.x}
            y2={view.y + view.height * 11}
            stroke="transparent"
            strokeWidth={hit}
            className="cursor-ew-resize"
            onPointerDown={startGuideDrag('x')}
            {...hover('x')}
          />
          {/* horizontal guide → root y */}
          <line
            x1={view.x - view.width * 10}
            y1={root.y}
            x2={view.x + view.width * 11}
            y2={root.y}
            stroke={guide}
            strokeWidth={unit}
            pointerEvents="none"
          />
          <line
            x1={view.x - view.width * 10}
            y1={root.y}
            x2={view.x + view.width * 11}
            y2={root.y}
            stroke="transparent"
            strokeWidth={hit}
            className="cursor-ns-resize"
            onPointerDown={startGuideDrag('y')}
            {...hover('y')}
          />
          <circle
            cx={root.x}
            cy={root.y}
            r={unit * 4}
            fill={guide}
            className="cursor-move"
            onPointerDown={startGuideDrag('xy')}
            {...hover('xy')}
          />
        </svg>
        <div className="absolute right-2 top-2 flex items-center gap-1">
          {anim && maxFrame > 0 ? (
            <button
              type="button"
              className={`${btn} ${playing ? '!border-accent !text-accent' : ''}`}
              onClick={togglePlay}
              title={playing ? 'Pause (keeps this frame)' : `Play ${animationName} @ ${source.fps} fps`}
            >
              {playing ? `❚❚ ${frame}` : '▶'}
            </button>
          ) : null}
          <button type="button" className={btn} onClick={() => zoomBy(1 / 1.5)} title="Zoom out">
            −
          </button>
          <span className="min-w-10 rounded bg-surface-elevated/90 px-1 text-center font-mono text-[10px] tabular-nums text-muted">
            {Math.round(zoom * 100)}%
          </span>
          <button type="button" className={btn} onClick={() => zoomBy(1.5)} title="Zoom in">
            +
          </button>
          <button
            type="button"
            className={btn}
            onClick={() => fit(fitView)}
            title="Fit skeleton and export frame"
          >
            Fit
          </button>
        </div>
        {label ? (
          <div
            className="pointer-events-none absolute rounded bg-foreground/85 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white"
            style={{ left: label.left, top: label.top }}
          >
            {label.axis === 'w' || label.axis === 'h' || label.axis === 'wh' ? (
              <>
                {label.axis !== 'h' ? `w ${frameSize.width}` : null}
                {label.axis === 'wh' ? ' · ' : null}
                {label.axis !== 'w' ? `h ${frameSize.height}` : null} px
              </>
            ) : (
              <>
                {label.axis !== 'y' ? `x ${signed(root.x)}` : null}
                {label.axis === 'xy' ? ' · ' : null}
                {label.axis !== 'x' ? `y ${signed(root.y)}` : null} px
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
