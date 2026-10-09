import { createCanvas } from '../core/canvas'

/** Total vertical pixels removed (split evenly top and bottom). */
export function clampSqueezePixels(px: number, canvasHeight: number): number {
  const n = Number(px)
  if (!Number.isFinite(n)) return 0
  const max = Math.max(0, canvasHeight - 1)
  return Math.min(max, Math.max(0, Math.round(n)))
}

/**
 * Keeps canvas size (e.g. 320×260).
 * Squeezes content vertically toward the center by a fixed pixel amount.
 */
export function verticalCenterSqueeze(
  source: HTMLCanvasElement,
  squeezePixels: number,
): HTMLCanvasElement {
  const w = source.width
  const h = source.height
  const shrinkPx = clampSqueezePixels(squeezePixels, h)
  const out = createCanvas(w, h)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')

  const drawH = Math.max(1, h - shrinkPx)
  const offsetY = (h - drawH) / 2

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h, 0, offsetY, w, drawH)
  return out
}
