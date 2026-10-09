import { createCanvas } from '../core/canvas'

/**
 * Scales the source so max(width, height) == maxSide (aspect preserved, tight canvas),
 * then zooms the image inside that canvas by `imageScale` around the center
 * (edges cropped when > 1).
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
  const drawW = srcW * s
  const drawH = srcH * s

  // Halve step by step until within 2× of the target: one big drawImage jump skips
  // source pixels and looks soft/aliased.
  let src: HTMLCanvasElement = source
  while (src.width / 2 >= drawW && src.height / 2 >= drawH) {
    src = scaleTo(src, Math.round(src.width / 2), Math.round(src.height / 2))
  }

  const out = createCanvas(outW, outH)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, (outW - drawW) / 2, (outH - drawH) / 2, drawW, drawH)
  return out
}

function scaleTo(source: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = createCanvas(Math.max(1, w), Math.max(1, h))
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, c.width, c.height)
  return c
}
