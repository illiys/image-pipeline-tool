import { createCanvas } from '../core/canvas'
import type { ImagePipelineModule } from '../core/types'

export const thumbnailModule: ImagePipelineModule = {
  id: 'thumbnail',
  name: 'Thumbnail',
  description:
    'Scale so max(width, height) matches Fit; output size is tight (aspect preserved).',
  order: 30,
  defaultParams: {
    fitSize: 100,
  },
  paramDefs: [
    {
      key: 'fitSize',
      label: 'Fit size',
      kind: 'number',
      min: 1,
      max: 2048,
      step: 1,
      unit: 'px',
      hint: 'Box side for scale: s = fitSize / max(w, h). Output is w×s by h×s (e.g. 100×80).',
    },
  ],
  process(sourceCanvas, params) {
    const fitSize = Math.max(1, Math.round(Number(params.fitSize) || 100))
    const origW = sourceCanvas.width
    const origH = sourceCanvas.height
    const longSide = Math.max(origW, origH)
    const s = fitSize / longSide

    const outW = Math.max(1, Math.round(origW * s))
    const outH = Math.max(1, Math.round(origH * s))

    const out = createCanvas(outW, outH)
    const ctx = out.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(sourceCanvas, 0, 0, origW, origH, 0, 0, outW, outH)
    return out
  },
}
