import type { CSSProperties } from 'react'

const MAX_H = '50vh'

/**
 * True pixel size, shrunk only if it does not fit. Only the width is set (height follows
 * the aspect ratio): with both set, the max-height cap squashes tall images.
 */
export function pixelStyle(w: number, h: number): CSSProperties {
  return {
    width: `min(${w}px, calc(${MAX_H} * ${w / h}))`,
    maxWidth: '100%',
    height: 'auto',
    aspectRatio: `${w} / ${h}`,
  }
}
