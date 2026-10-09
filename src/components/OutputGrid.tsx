import { useState, type CSSProperties } from 'react'
import { useOptimizedSize } from '../hooks/useOptimizedSize'
import { formatSizeKb } from '../lib/formatSize'
import { pixelStyle } from './frameStyles'
import type { OutputImage, OutputKind, SymbolOutputs } from '../core/types'
import { Spinner } from './Spinner'

export function Tile({
  label,
  image,
  frame,
  pending,
  onDownload,
  sizeOf = 'export',
  guides,
}: {
  label: string
  image: OutputImage | undefined
  frame: CSSProperties
  pending: boolean
  onDownload: (() => void) | null
  /** 'export' = size after oxipng (computed in the background); 'file' = blob as is */
  sizeOf?: 'export' | 'file'
  /** Center guides over the image, with a toggle in the caption; omitted = none */
  guides?: { shown: boolean; onToggle: () => void }
}) {
  const optimized = useOptimizedSize(image?.blob, sizeOf === 'export' && !pending)
  const size =
    sizeOf === 'file'
      ? image && { bytes: image.blob.size, exact: true }
      : optimized
  return (
    <figure className="flex w-fit max-w-full min-w-0 flex-col items-start gap-1">
      <figcaption className="flex h-4 items-center gap-1.5 whitespace-nowrap text-[10px] leading-4 text-muted">
        <span className="font-medium text-foreground/80">{label}</span>
        {image ? (
          <span className="font-mono tabular-nums">
            {image.width}×{image.height}
          </span>
        ) : null}
        {size && !pending ? (
          <span className="flex h-4 items-center gap-1 font-mono tabular-nums">
            {size.exact ? (
              formatSizeKb(size.bytes)
            ) : (
              <>
                {/* Same 16px line as the text, so the caption does not jump */}
                <Spinner size={8} className="!border" />
                <span title="Optimizing to get the exported size…">KB</span>
              </>
            )}
          </span>
        ) : null}
        {onDownload ? (
          <button
            type="button"
            onClick={onDownload}
            title="Download PNG"
            aria-label={`Download ${label} PNG`}
            className="flex size-4 items-center justify-center rounded hover:bg-accent/10 hover:text-accent"
          >
            <svg viewBox="0 0 24 24" className="size-3" fill="none" aria-hidden>
              <path
                d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
        {guides ? (
          <button
            type="button"
            onClick={guides.onToggle}
            aria-pressed={guides.shown}
            title={guides.shown ? 'Hide center guides' : 'Show center guides'}
            aria-label="Center guides"
            className={`flex size-4 items-center justify-center rounded hover:bg-accent/10 hover:text-accent ${
              guides.shown ? 'text-accent' : ''
            }`}
          >
            <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden>
              <path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </figcaption>
      <div
        className="checkerboard relative max-w-full overflow-hidden border border-border"
        style={frame}
      >
        {image ? (
          <img
            src={image.url}
            alt={label}
            draggable={false}
            className={`block size-full select-none transition-opacity ${pending ? 'opacity-50' : ''}`}
          />
        ) : null}
        {guides?.shown ? (
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-fuchsia-600/70" />
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-fuchsia-600/70" />
          </div>
        ) : null}
        {pending ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner size={18} />
          </div>
        ) : null}
      </div>
    </figure>
  )
}

const GUIDES_KEY = 'spine-symbol-export.staticGuides'

/** Static center guides on/off, remembered per browser. */
function useStaticGuides() {
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem(GUIDES_KEY) === '1'
    } catch {
      return false
    }
  })
  const onToggle = () => {
    const next = !shown
    setShown(next)
    try {
      localStorage.setItem(GUIDES_KEY, next ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }
  return { shown, onToggle }
}

type Props = {
  outputs: SymbolOutputs | undefined
  /** Outputs that are being re-rendered (only those show a spinner) */
  pendingKinds: ReadonlySet<OutputKind>
  staticWidth: number
  staticHeight: number
  onDownload: (kind: OutputKind) => void
}

export function OutputGrid({
  outputs,
  pendingKinds,
  staticWidth,
  staticHeight,
  onDownload,
}: Props) {
  const images = outputs?.images ?? {}
  const staticGuides = useStaticGuides()
  const history = images.history

  const dl = (kind: OutputKind) =>
    images[kind] && !pendingKinds.has(kind) ? () => onDownload(kind) : null

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-elevated/60 p-2">
      {outputs?.error ? (
        <p className="text-[11px] text-red-500" role="alert">
          {outputs.error}
        </p>
      ) : null}
      {/* All three at true pixel size (shrunk only if they do not fit) */}
      <div className="flex flex-wrap items-start gap-4">
        <Tile
          label="Static"
          image={images.static}
          frame={pixelStyle(staticWidth, staticHeight)}
          pending={pendingKinds.has('static')}
          onDownload={dl('static')}
          guides={staticGuides}
        />
        <Tile
          label="Blur"
          image={images.blur}
          frame={pixelStyle(staticWidth, staticHeight)}
          pending={pendingKinds.has('blur')}
          onDownload={dl('blur')}
        />
        <Tile
          label="History"
          image={history}
          frame={history ? pixelStyle(history.width, history.height) : pixelStyle(100, 80)}
          pending={pendingKinds.has('history')}
          onDownload={dl('history')}
        />
      </div>
    </div>
  )
}
