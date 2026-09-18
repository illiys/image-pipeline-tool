import { cloneCanvas, createCanvas } from '../core/canvas'
import type { ImagePipelineModule } from '../core/types'

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
export const verticalCenterSqueezeModule: ImagePipelineModule = {
  id: 'vertical-center-squeeze',
  name: 'Vertical center squeeze',
  description:
    'Canvas size unchanged; image is compressed on Y and centered (transparent bands top/bottom in PNG).',
  order: 10,
  defaultParams: {
    squeezePixels: 50,
  },
  paramDefs: [
    {
      key: 'squeezePixels',
      label: 'Height squeeze',
      kind: 'number',
      min: 0,
      max: 400,
      step: 1,
      unit: 'px',
      hint: 'Total pixels removed (25 px top + 25 px bottom at 50).',
    },
  ],
  process(sourceCanvas, params) {
    const w = sourceCanvas.width
    const h = sourceCanvas.height
    const shrinkPx = clampSqueezePixels(Number(params.squeezePixels), h)
    const out = createCanvas(w, h)
    const ctx = out.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')

    ctx.clearRect(0, 0, w, h)

    const targetH = Math.max(1, h - shrinkPx)
    const scaleY = targetH / h
    const drawH = h * scaleY
    const offsetY = (h - drawH) / 2

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(sourceCanvas, 0, 0, w, h, 0, offsetY, w, drawH)

    return out
  },
}

/** Layout guide overlay for before preview */
export function drawLayoutGuide(
  canvas: HTMLCanvasElement,
  squeezePixels: number,
): HTMLCanvasElement {
  const shrinkPx = clampSqueezePixels(squeezePixels, canvas.height)
  const c = cloneCanvas(canvas)
  const ctx = c.getContext('2d')
  if (!ctx || shrinkPx <= 0) return c
  const h = c.height
  const half = shrinkPx / 2
  ctx.save()
  ctx.strokeStyle = 'rgba(110, 231, 183, 0.55)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.strokeRect(0.5, half + 0.5, c.width - 1, h - shrinkPx - 1)
  ctx.restore()
  return c
}
