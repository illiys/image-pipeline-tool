import { createCanvas, getImageData } from '../core/canvas'
import { premultiply, resample, rowsOf, toImageData } from './resample'

/**
 * Scales the source so max(width, height) == maxSide (aspect preserved, tight canvas),
 * then zooms the image inside that canvas by `imageScale` around the center
 * (edges cropped when > 1). Resampled with Lanczos3 in linear light.
 */
export function historyThumbnail(
  source: HTMLCanvasElement,
  maxSide: number,
  imageScale: number,
): HTMLCanvasElement {
  const srcW = source.width
  const srcH = source.height
  const fit = Math.max(1, Math.round(maxSide)) / Math.max(srcW, srcH)
  const outW = Math.max(1, Math.round(srcW * fit))
  const outH = Math.max(1, Math.round(srcH * fit))

  const s = fit * (imageScale > 0 ? imageScale : 1)
  const p = resample(
    rowsOf(premultiply(getImageData(source)), srcW),
    srcW,
    srcH,
    outW,
    outH,
    s,
    (outW - srcW * s) / 2,
    (outH - srcH * s) / 2,
  )
  const out = createCanvas(outW, outH)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.putImageData(toImageData(p, outW, outH), 0, 0)
  return out
}
