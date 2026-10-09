import type { CSSProperties } from 'react'

const MAX_H = '36vh'

/** True pixel size, shrunk only if it does not fit. */
export function pixelStyle(w: number, h: number): CSSProperties {
  return { width: w, height: h, maxWidth: '100%', maxHeight: MAX_H, aspectRatio: `${w} / ${h}` }
}
