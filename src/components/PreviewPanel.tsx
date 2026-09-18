import type { CSSProperties, ReactNode } from 'react'
import { formatSizeKb } from '../lib/formatSize'
import { Spinner } from './Spinner'

type Props = {
  beforeUrl: string | null
  afterUrl: string | null
  fileName: string | null
  inputWidth: number
  inputHeight: number
  outputWidth: number | null
  outputHeight: number | null
  inputBytes: number
  outputBytes: number | null
  processing: boolean
  /** Hide result image for this asset while it is being reprocessed */
  reprocessingSelected: boolean
}

const PREVIEW_MAX_HEIGHT = '42vh'

/** Fits large originals in the preview area (Original + blur result at same size). */
function adaptiveFrameStyle(imageWidth: number, imageHeight: number): CSSProperties {
  return {
    aspectRatio: `${imageWidth} / ${imageHeight}`,
    width: `min(100%, calc(${PREVIEW_MAX_HEIGHT} * ${imageWidth} / ${imageHeight}))`,
    height: 'auto',
    maxWidth: '100%',
  }
}

/** Thumbnail / smaller export at true pixel size. */
function exportFrameStyle(imageWidth: number, imageHeight: number): CSSProperties {
  return {
    width: `${imageWidth}px`,
    height: `${imageHeight}px`,
    maxWidth: '100%',
    maxHeight: PREVIEW_MAX_HEIGHT,
    aspectRatio: `${imageWidth} / ${imageHeight}`,
  }
}

function PreviewFrame({
  label,
  frameStyle,
  children,
}: {
  label: string
  frameStyle: CSSProperties
  children: ReactNode
}) {
  return (
    <figure className="flex min-w-0 flex-col items-center gap-1">
      <figcaption className="w-full truncate text-center text-[10px] text-muted">
        {label}
      </figcaption>
      <div
        className="checkerboard relative mx-auto max-w-full overflow-hidden rounded-md border border-border"
        style={frameStyle}
      >
        <div className="flex size-full items-center justify-center">{children}</div>
      </div>
    </figure>
  )
}

export function PreviewPanel({
  beforeUrl,
  afterUrl,
  fileName,
  inputWidth,
  inputHeight,
  outputWidth,
  outputHeight,
  inputBytes,
  outputBytes,
  processing,
  reprocessingSelected,
}: Props) {
  if (!beforeUrl || inputWidth <= 0 || inputHeight <= 0) {
    return null
  }

  const hasOutput = outputWidth != null && outputHeight != null
  const outputMatchesInput =
    hasOutput && outputWidth === inputWidth && outputHeight === inputHeight

  const outW = outputWidth ?? inputWidth
  const outH = outputHeight ?? inputHeight

  const sizeMeta =
    hasOutput && outputBytes != null
      ? `${formatSizeKb(inputBytes)} · ${inputWidth}×${inputHeight} → ${outputWidth}×${outputHeight} · ${formatSizeKb(outputBytes)}`
      : `${formatSizeKb(inputBytes)} · ${inputWidth}×${inputHeight}`

  const meta = fileName ? `${fileName} · ${sizeMeta}` : sizeMeta

  const originalFrame = adaptiveFrameStyle(inputWidth, inputHeight)
  const resultUsesInputFrame = !hasOutput || outputMatchesInput
  const resultFrame = resultUsesInputFrame
    ? adaptiveFrameStyle(inputWidth, inputHeight)
    : exportFrameStyle(outW, outH)

  const showResultImage =
    afterUrl != null && hasOutput && !reprocessingSelected

  return (
    <div className="rounded-lg border border-border bg-surface-elevated/50 p-2">
      <div className="mb-1.5 flex min-w-0 items-center gap-2 text-[10px] text-muted">
        <span className="shrink-0 font-medium text-muted">Preview</span>
        <span className="truncate font-mono">{meta}</span>
        {processing ? <Spinner size={12} /> : null}
      </div>

      <div className="grid grid-cols-2 items-start gap-2">
        <PreviewFrame label="Original" frameStyle={originalFrame}>
          <img
            src={beforeUrl}
            alt="Before"
            className="size-full object-contain"
            width={inputWidth}
            height={inputHeight}
          />
        </PreviewFrame>
        <PreviewFrame
          label={hasOutput ? `Result · ${outputWidth}×${outputHeight}` : 'Result'}
          frameStyle={resultFrame}
        >
          {showResultImage ? (
            <img
              src={afterUrl}
              alt="After"
              className="size-full object-contain"
              width={outW}
              height={outH}
            />
          ) : reprocessingSelected ? (
            <div className="flex flex-col items-center justify-center gap-2 py-6">
              <Spinner size={22} />
              <span className="text-[10px] text-muted">Processing…</span>
            </div>
          ) : null}
        </PreviewFrame>
      </div>
    </div>
  )
}
