import { canvasToBlob } from '../core/canvas'
import type {
  FrameSize,
  GlobalSettings,
  OutputImage,
  OutputKind,
  RootOffset,
  SpineSource,
  SpineSymbol,
  SymbolOutputs,
} from '../core/types'
import { historyThumbnail } from '../effects/history'
import { motionBlur } from '../effects/motionBlur'
import { verticalCenterSqueeze } from '../effects/squeeze'
import { renderSpineFrame } from '../spine/renderer'

export const OUTPUT_KINDS: readonly OutputKind[] = ['static', 'blur', 'history']

/** Game folder/file base name: key '09_14' → 'symbol_09_14'. */
export function symbolSlug(key: string): string {
  return `symbol_${key}`
}

/**
 * Suggested key from the skeleton name: 'symbol_09_14' → '09_14', 'sym_3_wild' → '3_wild'.
 * Names without a number get the next free number ('wild' → '16' when 0–15 are taken).
 */
export function suggestKey(name: string, takenKeys: Iterable<string>): string {
  const cleaned = name.replace(/^symbol_/i, '').replace(/[^A-Za-z0-9_]/g, '_')
  if (/\d/.test(cleaned)) return cleaned.replace(/^\D+_/, '')
  const taken = new Set<number>()
  for (const k of takenKeys) for (const n of historyIdsFromKey(k)) taken.add(Number(n))
  let n = 0
  while (taken.has(n)) n++
  return String(n).padStart(2, '0')
}

export function isValidKey(key: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(key)
}

/** Numeric parts of the key without leading zeros: '09_14' → ['9', '14'], '00_1x3' → ['0']. */
export function historyIdsFromKey(key: string): string[] {
  return key
    .split('_')
    .filter((p) => /^\d+$/.test(p))
    .map((p) => String(Number(p)))
}

export function historyIdsFor(symbol: SpineSymbol): string[] {
  return symbol.historyIds ?? historyIdsFromKey(symbol.key)
}

/** Paths of an output inside the export ZIP (history: one copy per history id). */
export function outputPaths(symbol: SpineSymbol, kind: OutputKind): string[] {
  const slug = symbolSlug(symbol.key)
  if (kind === 'static') return [`symbols/big/${slug}.png`]
  if (kind === 'blur') return [`symbols/blur/${slug}.png`]
  return historyIdsFor(symbol).map((id) => `assets/history/symbols/${id}.png`)
}

export function sizeFor(symbol: SpineSymbol, s: GlobalSettings): FrameSize {
  return symbol.size ?? { width: s.staticWidth, height: s.staticHeight }
}

/** Root used for an animation: its own root, or the symbol's shared root. */
export function rootFor(symbol: SpineSymbol, animationName = symbol.animationName): RootOffset {
  return symbol.animRoots[animationName] ?? symbol.root
}

/** UUID per source object (a counter would restart on hot reload and reuse ids in cache keys). */
const sourceIds = new WeakMap<SpineSource, string>()
function sourceId(source: SpineSource): string {
  let id = sourceIds.get(source)
  if (id == null) {
    id = crypto.randomUUID()
    sourceIds.set(source, id)
  }
  return id
}

/** What each output depends on. Equal keys ⇒ the existing image is still valid. */
export function outputKeys(
  symbol: SpineSymbol,
  s: GlobalSettings,
): Record<OutputKind, string> {
  const root = rootFor(symbol)
  const size = sizeFor(symbol, s)
  const staticKey = JSON.stringify([
    sourceId(symbol.source),
    symbol.animationName,
    symbol.frame,
    root.x,
    root.y,
    size.width,
    size.height,
  ])
  return {
    static: staticKey,
    blur: JSON.stringify([staticKey, s.squeezePixels, s.blurAngle, s.blurDistance]),
    history: JSON.stringify([staticKey, s.historyMaxSide, s.historyScale]),
  }
}

export function outputsAreCurrent(
  outputs: SymbolOutputs | undefined,
  keys: Record<OutputKind, string>,
): boolean {
  return !!outputs && OUTPUT_KINDS.every((k) => outputs.keys[k] === keys[k])
}

async function toImage(canvas: HTMLCanvasElement): Promise<OutputImage> {
  const blob = await canvasToBlob(canvas, 'image/png')
  return { blob, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height }
}

export function revokeOutputs(outputs: SymbolOutputs | undefined) {
  if (!outputs) return
  for (const img of Object.values(outputs.images)) URL.revokeObjectURL(img.url)
}

/** Last rendered static canvas per symbol, so blur/history changes skip the WebGL render. */
const staticCanvasCache = new Map<string, { key: string; canvas: HTMLCanvasElement }>()

export function forgetSymbolCache(name: string) {
  staticCanvasCache.delete(name)
}

export class Cancelled extends Error {}

/**
 * Re-renders only the stale outputs of a symbol. Images that are still current are
 * carried over from `prev` (same object, not revoked). Throws `Cancelled` when
 * `isCancelled()` turns true between steps; new images are revoked in that case.
 */
export async function renderSymbolOutputs(
  symbol: SpineSymbol,
  settings: GlobalSettings,
  prev: SymbolOutputs | undefined,
  isCancelled: () => boolean,
): Promise<SymbolOutputs> {
  const keys = outputKeys(symbol, settings)
  const images: Partial<Record<OutputKind, OutputImage>> = {}
  const created: OutputImage[] = []
  const check = () => {
    if (isCancelled()) throw new Cancelled()
  }

  try {
    let staticCanvas: HTMLCanvasElement | null = null
    const getStatic = async () => {
      if (staticCanvas) return staticCanvas
      const cached = staticCanvasCache.get(symbol.name)
      if (cached?.key === keys.static) {
        staticCanvas = cached.canvas
        return staticCanvas
      }
      staticCanvas = await renderSpineFrame(symbol.source, {
        ...sizeFor(symbol, settings),
        animationName: symbol.animationName,
        frame: symbol.frame,
        fps: symbol.source.fps,
        root: rootFor(symbol),
      })
      staticCanvasCache.set(symbol.name, { key: keys.static, canvas: staticCanvas })
      check()
      return staticCanvas
    }

    for (const kind of OUTPUT_KINDS) {
      const old = prev?.images[kind]
      if (old && prev?.keys[kind] === keys[kind] && !prev.error) {
        images[kind] = old
        continue
      }
      check()
      const base = await getStatic()
      let canvas: HTMLCanvasElement
      if (kind === 'static') {
        canvas = base
      } else if (kind === 'blur') {
        canvas = motionBlur(
          verticalCenterSqueeze(base, settings.squeezePixels),
          settings.blurAngle,
          settings.blurDistance,
        )
      } else {
        canvas = historyThumbnail(base, settings.historyMaxSide, settings.historyScale)
      }
      check()
      const img = await toImage(canvas)
      created.push(img)
      images[kind] = img
    }
    check()
    return { keys, images, error: null }
  } catch (e) {
    for (const img of created) URL.revokeObjectURL(img.url)
    if (e instanceof Cancelled) throw e
    return {
      keys,
      images: {},
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
