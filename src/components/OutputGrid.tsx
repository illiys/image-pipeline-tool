import type { CSSProperties } from 'react'
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
}: {
  label: string
  image: OutputImage | undefined
  frame: CSSProperties
  pending: boolean
  onDownload: (() => void) | null
  /** 'export' = size after oxipng (computed in the background); 'file' = blob as is */
  sizeOf?: 'export' | 'file'
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
        {pending ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner size={18} />
          </div>
        ) : null}
      </div>
    </figure>
  )
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
