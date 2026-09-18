import { createCanvas, getImageData, putImageData } from '../core/canvas'
import type { ImagePipelineModule } from '../core/types'

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function srgbChannelToLinear(c: number): number {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

function linearChannelToSrgb(c: number): number {
  const x = Math.max(0, Math.min(1, c))
  const s =
    x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
  return Math.round(s * 255)
}

/**
 * Directional box blur with premultiplied alpha in linear light space.
 * Avoids dark halos when blurring transparent PNGs (straight RGB average pulls in black).
 */
export function motionBlurImageData(
  data: ImageData,
  angleDeg: number,
  distance: number,
): ImageData {
  const { width: w, height: h, data: src } = data
  const out = new Uint8ClampedArray(src.length)
  const len = Math.max(1, Math.round(distance))
  const half = Math.floor(len / 2)
  const rad = degToRad(angleDeg)
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sumLr = 0
      let sumLg = 0
      let sumLb = 0
      let sumA = 0
      let n = 0

      for (let i = -half; i <= half; i++) {
        n++
        const sx = Math.round(x + dx * i)
        const sy = Math.round(y + dy * i)
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue
        const idx = (sy * w + sx) * 4
        const a = src[idx + 3] / 255
        if (a <= 0) continue
        const lr = srgbChannelToLinear(src[idx]) * a
        const lg = srgbChannelToLinear(src[idx + 1]) * a
        const lb = srgbChannelToLinear(src[idx + 2]) * a
        sumLr += lr
        sumLg += lg
        sumLb += lb
        sumA += a
      }

      const o = (y * w + x) * 4
      if (n === 0 || sumA <= 1e-8) {
        out[o] = src[o]
        out[o + 1] = src[o + 1]
        out[o + 2] = src[o + 2]
        out[o + 3] = src[o + 3]
        continue
      }

      const aOut = sumA / n
      const invA = 1 / sumA
      const lrOut = sumLr * invA
      const lgOut = sumLg * invA
      const lbOut = sumLb * invA

      out[o] = linearChannelToSrgb(lrOut)
      out[o + 1] = linearChannelToSrgb(lgOut)
      out[o + 2] = linearChannelToSrgb(lbOut)
      out[o + 3] = Math.round(Math.min(1, aOut) * 255)
    }
  }

  return new ImageData(out, w, h)
}

export const motionBlurModule: ImagePipelineModule = {
  id: 'motion-blur',
  name: 'Motion blur',
  description: 'Blur along a direction (preset: 90°, 40 px).',
  order: 20,
  defaultParams: {
    angle: 90,
    distance: 40,
  },
  paramDefs: [
    {
      key: 'angle',
      label: 'Angle',
      kind: 'number',
      min: 0,
      max: 360,
      step: 1,
      unit: '°',
    },
    {
      key: 'distance',
      label: 'Distance',
      kind: 'number',
      min: 0,
      max: 200,
      step: 1,
      unit: 'px',
    },
  ],
  process(sourceCanvas, params) {
    const angle = Number(params.angle) ?? 90
    const distance = Number(params.distance) ?? 40
    const imageData = getImageData(sourceCanvas)
    const blurred = motionBlurImageData(imageData, angle, distance)
    const out = createCanvas(sourceCanvas.width, sourceCanvas.height)
    return putImageData(out, blurred)
  },
}
