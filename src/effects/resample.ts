/**
 * Lanczos3 resampling of premultiplied RGBA in linear light (0–1). Downscales are sharper
 * than box/bilinear averaging, and linear light keeps small bright details (highlights,
 * pearls, gold) from turning dull the way sRGB averaging does.
 */

const LOBES = 3
/** Filter reach in source pixels per destination pixel when downscaling */
export const LANCZOS_SUPPORT = LOBES

function lanczos(x: number): number {
  if (x === 0) return 1
  if (x <= -LOBES || x >= LOBES) return 0
  const px = Math.PI * x
  return (LOBES * Math.sin(px) * Math.sin(px / LOBES)) / (px * px)
}

// sRGB ↔ linear. Decoding runs on every supersampled pixel, so it uses a table.
const DECODE_STEPS = 4096
const decodeTable = new Float32Array(DECODE_STEPS + 2)
for (let i = 0; i <= DECODE_STEPS + 1; i++) {
  const c = Math.min(1, i / DECODE_STEPS)
  decodeTable[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** sRGB 0–1 → linear 0–1 */
export function srgbToLinear(c: number): number {
  const x = Math.min(1, Math.max(0, c)) * DECODE_STEPS
  const i = x | 0
  return decodeTable[i] + (decodeTable[i + 1] - decodeTable[i]) * (x - i)
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
}

/**
 * One straight sRGB pixel (0–1) → premultiplied linear, written at `d`.
 */
export function putLinear(out: Float32Array, d: number, r: number, g: number, b: number, a: number) {
  out[d] = srgbToLinear(r) * a
  out[d + 1] = srgbToLinear(g) * a
  out[d + 2] = srgbToLinear(b) * a
  out[d + 3] = a
}

type Taps = {
  /** Taps per destination pixel */
  count: number
  /** Source index per tap (count per destination pixel) */
  index: Int32Array
  weight: Float32Array
}

/**
 * Taps for one axis, mapping dst = src · scale + offset (pixel edges). Taps outside the
 * source get weight 0 but still count in the normalization, so outside reads as transparent.
 */
function axisTaps(srcLen: number, dstLen: number, scale: number, offset: number): Taps {
  // Downscaling stretches the kernel over 1/scale source pixels.
  const stretch = Math.max(1, 1 / scale)
  const support = LOBES * stretch
  const count = Math.ceil(support * 2) + 1
  const index = new Int32Array(dstLen * count)
  const weight = new Float32Array(dstLen * count)
  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5 - offset) / scale
    const first = Math.floor(center - support - 0.5) + 1
    let sum = 0
    for (let k = 0; k < count; k++) {
      const w = lanczos((first + k + 0.5 - center) / stretch)
      weight[i * count + k] = w
      sum += w
    }
    for (let k = 0; k < count; k++) {
      const j = first + k
      const o = i * count + k
      if (j < 0 || j >= srcLen) {
        weight[o] = 0
        continue
      }
      weight[o] = sum ? weight[o] / sum : 0
      index[o] = j
    }
  }
  return { count, index, weight }
}

/**
 * Source rows in bands, top-down, as premultiplied linear RGBA (0–1):
 * rows y0..y0+count-1, `count` × sw × 4 floats. Lets large renders be read piecewise.
 */
export type RowReader = (y0: number, count: number) => Float32Array

const BAND_ROWS = 128

/** Reader over an image that is already in memory. */
export function rowsOf(p: Float32Array, sw: number): RowReader {
  return (y0, count) => p.subarray(y0 * sw * 4, (y0 + count) * sw * 4)
}

/** Resamples so that dst = src · scale + offset. */
export function resample(
  read: RowReader,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  scale: number,
  offsetX = 0,
  offsetY = 0,
): Float32Array {
  const tx = axisTaps(sw, dw, scale, offsetX)
  const ty = axisTaps(sh, dh, scale, offsetY)

  // Only source rows that some destination row reads.
  const rowUsed = new Uint8Array(sh)
  for (let i = 0; i < ty.index.length; i++) if (ty.weight[i] !== 0) rowUsed[ty.index[i]] = 1

  // Horizontal pass: sh × dw
  const mid = new Float32Array(dw * sh * 4)
  for (let y0 = 0; y0 < sh; y0 += BAND_ROWS) {
    const count = Math.min(BAND_ROWS, sh - y0)
    let any = false
    for (let y = y0; y < y0 + count; y++) any ||= rowUsed[y] === 1
    if (!any) continue
    const band = read(y0, count)
    for (let y = y0; y < y0 + count; y++) {
      if (!rowUsed[y]) continue
      const row = (y - y0) * sw * 4
      for (let x = 0; x < dw; x++) {
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        for (let k = 0, t = x * tx.count; k < tx.count; k++, t++) {
          const w = tx.weight[t]
          if (w === 0) continue
          const s = row + tx.index[t] * 4
          r += band[s] * w
          g += band[s + 1] * w
          b += band[s + 2] * w
          a += band[s + 3] * w
        }
        const d = (y * dw + x) * 4
        mid[d] = r
        mid[d + 1] = g
        mid[d + 2] = b
        mid[d + 3] = a
      }
    }
  }

  // Vertical pass: dh × dw
  const out = new Float32Array(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    for (let k = 0, t = y * ty.count; k < ty.count; k++, t++) {
      const w = ty.weight[t]
      if (w === 0) continue
      const s = ty.index[t] * dw * 4
      const d = y * dw * 4
      for (let i = 0; i < dw * 4; i++) out[d + i] += mid[s + i] * w
    }
  }
  return out
}

/**
 * Unsharp mask (3×3 Gaussian) on premultiplied RGBA; `amount` 1 = +100% of the detail.
 */
export function sharpen(p: Float32Array, w: number, h: number, amount: number): Float32Array {
  if (!(amount > 0)) return p
  const out = new Float32Array(p.length)
  const at = (x: number, y: number) =>
    (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = (y * w + x) * 4
      const n = [at(x - 1, y - 1), at(x, y - 1), at(x + 1, y - 1)]
      const m = [at(x - 1, y), c, at(x + 1, y)]
      const s = [at(x - 1, y + 1), at(x, y + 1), at(x + 1, y + 1)]
      for (let ch = 0; ch < 4; ch++) {
        const blur =
          (p[n[0] + ch] + 2 * p[n[1] + ch] + p[n[2] + ch] +
            2 * (p[m[0] + ch] + 2 * p[m[1] + ch] + p[m[2] + ch]) +
            p[s[0] + ch] + 2 * p[s[1] + ch] + p[s[2] + ch]) /
          16
        out[c + ch] = p[c + ch] + amount * (p[c + ch] - blur)
      }
    }
  }
  return out
}

/** Straight-alpha image data → premultiplied linear floats (0–1). */
export function premultiply(img: ImageData): Float32Array {
  const s = img.data
  const p = new Float32Array(s.length)
  for (let i = 0; i < s.length; i += 4) {
    putLinear(p, i, s[i] / 255, s[i + 1] / 255, s[i + 2] / 255, s[i + 3] / 255)
  }
  return p
}

/** Deterministic noise in [-0.5, 0.5): same image → same bytes, so outputs stay stable. */
function noise(i: number): number {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296 - 0.5
}

/**
 * Premultiplied linear floats → straight-alpha sRGB image data. Lanczos overshoot is
 * clamped; quantization to 8 bits is dithered so smooth gradients don't band (values
 * that are already whole 8-bit levels are left as they are).
 */
export function toImageData(p: Float32Array, w: number, h: number): ImageData {
  const out = new ImageData(w, h)
  const d = out.data
  const q = (v: number, i: number) => Math.min(255, Math.max(0, Math.round(v * 255 + noise(i))))
  for (let i = 0; i < d.length; i += 4) {
    const a = Math.min(1, p[i + 3])
    const qa = q(a, i + 3)
    if (qa === 0) continue
    for (let ch = 0; ch < 3; ch++) {
      d[i + ch] = q(linearToSrgb(Math.min(a, Math.max(0, p[i + ch])) / a), i + ch)
    }
    d[i + 3] = qa
  }
  return out
}
