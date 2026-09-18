import { cloneCanvas, createCanvas } from '../core/canvas'
import type { ImagePipelineModule } from '../core/types'

/** Share of canvas height removed by center squeeze (0–100). */
export function shrinkPxFromPercent(canvasHeight: number, squeezePercent: number): number {
  const p = Math.min(100, Math.max(0, squeezePercent))
  return (canvasHeight * p) / 100
}

/**
 * Keeps canvas size (e.g. 320×260).
 * Squeezes content vertically toward the center by a % of height.
 */
export const verticalCenterSqueezeModule: ImagePipelineModule = {
  id: 'vertical-center-squeeze',
  name: 'Vertical center squeeze',
  description:
    'Canvas size unchanged; image is compressed on Y and centered (transparent bands top/bottom in PNG).',
  order: 10,
  defaultParams: {
    squeezePercent: 20,
  },
  paramDefs: [
    {
      key: 'squeezePercent',
      label: 'Height squeeze',
      kind: 'number',
      min: 0,
      max: 80,
      step: 1,
      unit: '%',
      hint: 'Preset: 20% (~50 px at 260 px height)',
    },
  ],
  process(sourceCanvas, params) {
    const squeezePercent = Number(params.squeezePercent) || 0
    const w = sourceCanvas.width
    const h = sourceCanvas.height
    const shrinkPx = shrinkPxFromPercent(h, squeezePercent)
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
  squeezePercent: number,
): HTMLCanvasElement {
  const shrinkPx = shrinkPxFromPercent(canvas.height, squeezePercent)
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
