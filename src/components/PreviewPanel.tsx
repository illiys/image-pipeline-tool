import type { CSSProperties, ReactNode } from 'react'
import { formatSizeKb } from '../lib/formatSize'
import { Spinner } from './Spinner'

type Props = {
  beforeUrl: string | null
  afterUrl: string | null
  fileName: string | null
  width: number
  height: number
  inputBytes: number
  outputBytes: number | null
  processing: boolean
}

const PREVIEW_MAX_HEIGHT = '42vh'

function previewFrameStyle(imageWidth: number, imageHeight: number): CSSProperties {
  return {
    aspectRatio: `${imageWidth} / ${imageHeight}`,
    width: `min(100%, calc(${PREVIEW_MAX_HEIGHT} * ${imageWidth} / ${imageHeight}))`,
    height: 'auto',
    maxWidth: '100%',
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
  width,
  height,
  inputBytes,
  outputBytes,
  processing,
}: Props) {
  if (!beforeUrl || width <= 0 || height <= 0) {
    return null
  }

  const sizeMeta =
    outputBytes != null
      ? `${formatSizeKb(inputBytes)} → ${formatSizeKb(outputBytes)}`
      : formatSizeKb(inputBytes)

  const meta = fileName
    ? `${fileName} · ${width}×${height} · ${sizeMeta}`
    : `${width}×${height} · ${sizeMeta}`

  const frameStyle = previewFrameStyle(width, height)

  return (
    <div className="rounded-lg border border-border bg-surface-elevated/50 p-2">
      <div className="mb-1.5 flex min-w-0 items-center gap-2 text-[10px] text-muted">
        <span className="shrink-0 font-medium text-muted">Preview</span>
        <span className="truncate font-mono">{meta}</span>
        {processing ? <Spinner size={12} /> : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PreviewFrame label="Original" frameStyle={frameStyle}>
          <img
            src={beforeUrl}
            alt="Before"
            className="size-full object-contain"
            width={width}
            height={height}
          />
        </PreviewFrame>
        <PreviewFrame label="Result" frameStyle={frameStyle}>
          {afterUrl ? (
            <>
              <img
                src={afterUrl}
                alt="After"
                className={`size-full object-contain ${processing ? 'opacity-40' : ''}`}
                width={width}
                height={height}
              />
              {processing ? (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/60"
                  aria-busy="true"
                >
                  <Spinner size={22} />
                  <span className="text-[10px] font-medium text-foreground">
                    Processing…
                  </span>
                </div>
              ) : null}
            </>
          ) : processing ? (
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
