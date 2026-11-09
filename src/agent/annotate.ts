import { createCanvas } from '../core/canvas'
import type { FrameSize, RootOffset } from '../core/types'
import type { PreviewResult } from '../spine/renderer'
import type { Background, Box } from './protocol'

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

/** 1, 2 or 5 × 10^n closest above `raw`. */
function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p
  return 10 * p
}

const DARK = new Set<Background>(['dark'])

/** Fills the canvas with the background (checker = light gray squares). */
export function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, bg: Background) {
  if (bg === 'none') return
  if (bg === 'checker') {
    const cell = 10
    ctx.fillStyle = '#e9e9e9'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#c9c9c9'
    for (let y = 0; y < h; y += cell) {
      for (let x = (y / cell) % 2 === 0 ? 0 : cell; x < w; x += cell * 2) ctx.fillRect(x, y, cell, cell)
    }
    return
  }
  ctx.fillStyle = bg === 'dark' ? '#1d1d1f' : '#f5f5f5'
  ctx.fillRect(0, 0, w, h)
}

/** The image composited on a background, for viewing (exports stay transparent). */
export function onBackground(image: CanvasImageSource & { width: number; height: number }, bg: Background) {
  const out = createCanvas(image.width, image.height)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  paintBackground(ctx, out.width, out.height, bg)
  ctx.drawImage(image, 0, 0)
  return out
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.strokeText(text, x, y)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

export type Annotated = { canvas: HTMLCanvasElement; view: Box; scale: number }

/**
 * The whole-skeleton preview with what the root editor shows: root bone (gray cross),
 * root guides (red), static frame (blue, dashed), game cell (orange) and a labeled grid
 * in root-bone-relative pixels, so positions can be read off the image.
 */
export function annotatePreview(
  preview: PreviewResult,
  o: { root: RootOffset; size: FrameSize; cell: FrameSize; maxSide: number; background: Background },
): Annotated {
  const frame: Box = { x: o.root.x, y: o.root.y, width: o.size.width, height: o.size.height }
  const content = union(union(preview.bounds, frame), { x: 0, y: 0, width: 0, height: 0 })
  const pad = Math.max(content.width, content.height) * 0.06 + 8
  const view: Box = {
    x: content.x - pad,
    y: content.y - pad,
    width: content.width + 2 * pad,
    height: content.height + 2 * pad,
  }
  const scale = o.maxSide / Math.max(view.width, view.height)
  const W = Math.max(1, Math.round(view.width * scale))
  const H = Math.max(1, Math.round(view.height * scale))
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  const sx = (x: number) => (x - view.x) * scale
  const sy = (y: number) => (y - view.y) * scale
  const dark = DARK.has(o.background)

  paintBackground(ctx, W, H, o.background)

  // Grid with labels every step (root-bone-relative px).
  const step = niceStep(Math.max(view.width, view.height) / 10)
  ctx.lineWidth = 1
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.13)'
  ctx.beginPath()
  for (let x = Math.ceil(view.x / step) * step; x <= view.x + view.width; x += step) {
    ctx.moveTo(Math.round(sx(x)) + 0.5, 0)
    ctx.lineTo(Math.round(sx(x)) + 0.5, H)
  }
  for (let y = Math.ceil(view.y / step) * step; y <= view.y + view.height; y += step) {
    ctx.moveTo(0, Math.round(sy(y)) + 0.5)
    ctx.lineTo(W, Math.round(sy(y)) + 0.5)
  }
  ctx.stroke()

  ctx.imageSmoothingQuality = 'high'
  const b = preview.bounds
  ctx.drawImage(preview.canvas, sx(b.x), sy(b.y), b.width * scale, b.height * scale)

  ctx.font = '11px ui-monospace, Menlo, monospace'
  ctx.textBaseline = 'top'
  const gridLabel = dark ? '#c8c8c8' : '#555'
  for (let x = Math.ceil(view.x / step) * step; x <= view.x + view.width; x += step) {
    label(ctx, String(x), sx(x) + 2, 2, gridLabel)
  }
  for (let y = Math.ceil(view.y / step) * step; y <= view.y + view.height; y += step) {
    if (sy(y) > 14) label(ctx, String(y), 2, sy(y) + 2, gridLabel)
  }

  // Game cell, centered in the static frame.
  if (o.cell.width > 0 && o.cell.height > 0) {
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = '#f08c00'
    ctx.lineWidth = 1.5
    ctx.strokeRect(
      sx(frame.x + (frame.width - o.cell.width) / 2),
      sy(frame.y + (frame.height - o.cell.height) / 2),
      o.cell.width * scale,
      o.cell.height * scale,
    )
  }

  // Static frame: top-left corner is the root.
  ctx.setLineDash([6, 4])
  ctx.strokeStyle = '#1c7ed6'
  ctx.lineWidth = 1.5
  ctx.strokeRect(sx(frame.x), sy(frame.y), frame.width * scale, frame.height * scale)
  ctx.setLineDash([])
  ctx.textBaseline = 'bottom'
  label(ctx, `static ${o.size.width}×${o.size.height}`, sx(frame.x) + 4, sy(frame.y + frame.height) - 3, '#1c7ed6')

  // Root bone (setup position): gray cross.
  ctx.strokeStyle = '#777'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(sx(0) - 8, sy(0))
  ctx.lineTo(sx(0) + 8, sy(0))
  ctx.moveTo(sx(0), sy(0) - 8)
  ctx.lineTo(sx(0), sy(0) + 8)
  ctx.stroke()
  ctx.textBaseline = 'top'
  label(ctx, 'bone', sx(0) + 4, sy(0) + 4, '#666')

  // Root guides and point.
  ctx.strokeStyle = 'rgba(224,49,49,0.75)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(Math.round(sx(frame.x)) + 0.5, 0)
  ctx.lineTo(Math.round(sx(frame.x)) + 0.5, H)
  ctx.moveTo(0, Math.round(sy(frame.y)) + 0.5)
  ctx.lineTo(W, Math.round(sy(frame.y)) + 0.5)
  ctx.stroke()
  ctx.fillStyle = '#e03131'
  ctx.beginPath()
  ctx.arc(sx(frame.x), sy(frame.y), 3.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.textBaseline = 'bottom'
  label(ctx, `root ${o.root.x},${o.root.y}`, sx(frame.x) + 5, sy(frame.y) - 3, '#e03131')

  return { canvas, view, scale }
}
