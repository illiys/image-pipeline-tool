import type { SpineSymbol, SymbolOutputs } from '../core/types'
import { bakeRootIntoJson } from '../spine/bakeRoot'
import { OUTPUT_KINDS, historyIdsFor, isValidKey, outputPaths, symbolSlug } from './exportSymbol'

/** A file in the export ZIP; PNG outputs get the oxipng pass, the rest is copied as-is. */
export type BundleFile = { path: string; blob: Blob; optimizePng: boolean }

/** Same README the game keeps in assets/history/symbols/. */
const HISTORY_README = `# History Symbol Assets

Place symbol image files (PNG, JPG, WebP, SVG, GIF) in this directory, named by their numeric symbol ID from the slot paytable (math configs).

Example:
\`\`\`
0.png   ← Symbol ID 0 (e.g., Wild)
1.webp  ← Symbol ID 1 (e.g., HP1)
2.jpg   ← Symbol ID 2 (e.g., HP2)
3.gif   ← Symbol ID 3 (e.g., Scatter)
...
\`\`\`

These images are automatically uploaded to the asset storage on RGS startup
(or on the next player session if the upload status was reset)
and displayed in the game history UI.

Source the images from \`game-ui/assets/desktop/images/src/symbols/big/\`.
`

/**
 * JSON skeletons get the chosen root written in (origin = export root). Binary .skel
 * cannot be edited safely and is copied as is.
 */
function exportedSkeleton(symbol: SpineSymbol): Blob {
  const json = symbol.source.skeletonJson
  if (json == null) return symbol.source.skeletonFile
  return new Blob([bakeRootIntoJson(json, symbol.root, symbol.animRoots)], { type: 'application/json' })
}

function skeletonExt(symbol: SpineSymbol): string {
  return symbol.source.skeletonJson != null ? 'json' : 'skel'
}

/**
 * ZIP layout (matches the game repo):
 *   animations/symbol_XX/symbol_XX.{json|skel,atlas} + atlas textures (JSON with the root written in)
 *   symbols/big/symbol_XX.png
 *   symbols/blur/symbol_XX.png
 *   assets/history/symbols/<history id>.png (one per id) + .gitkeep + README.md
 */
export function buildExportBundle(
  symbols: SpineSymbol[],
  outputs: Record<string, SymbolOutputs>,
): BundleFile[] {
  const files: BundleFile[] = []
  for (const s of symbols) {
    const slug = symbolSlug(s.key)
    const dir = `animations/${slug}`
    files.push(
      { path: `${dir}/${slug}.${skeletonExt(s)}`, blob: exportedSkeleton(s), optimizePng: false },
      { path: `${dir}/${slug}.atlas`, blob: s.source.atlasFile, optimizePng: false },
    )
    // Texture names must stay as the .atlas references them.
    for (const [page, file] of s.source.textures) {
      files.push({ path: `${dir}/${page}`, blob: file, optimizePng: false })
    }
    for (const kind of OUTPUT_KINDS) {
      const img = outputs[s.name]?.images[kind]
      if (!img) continue
      for (const path of outputPaths(s, kind)) {
        files.push({ path, blob: img.blob, optimizePng: true })
      }
    }
  }
  files.push(...historyFolderExtras())
  return files
}

/** .gitkeep + README.md that the game keeps next to the history images. */
export function historyFolderExtras(): BundleFile[] {
  return [
    { path: 'assets/history/symbols/.gitkeep', blob: new Blob([]), optimizePng: false },
    {
      path: 'assets/history/symbols/README.md',
      blob: new Blob([HISTORY_README], { type: 'text/markdown' }),
      optimizePng: false,
    },
  ]
}

export function isValidHistoryId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

/**
 * Problems that would make files overwrite each other or get bad names,
 * keyed by symbol name. Export is blocked while any exist.
 */
export function symbolIdProblems(symbols: SpineSymbol[]): Map<string, string> {
  const problems = new Map<string, string>()
  const keyOwner = new Map<string, string>()
  const historyOwner = new Map<string, string>()
  for (const s of symbols) {
    if (!isValidKey(s.key)) {
      problems.set(s.name, 'id may only contain letters, digits and _')
      continue
    }
    const k = s.key.toLowerCase()
    const other = keyOwner.get(k)
    if (other != null) {
      problems.set(s.name, `id ${s.key} also used by ${other}`)
      problems.set(other, problems.get(other) ?? `id ${s.key} also used by ${s.name}`)
    } else keyOwner.set(k, s.name)
    for (const h of historyIdsFor(s)) {
      if (!isValidHistoryId(h)) {
        problems.set(s.name, problems.get(s.name) ?? `bad history id "${h}"`)
        continue
      }
      const owner = historyOwner.get(h)
      if (owner != null && owner !== s.name) {
        problems.set(s.name, problems.get(s.name) ?? `history ${h}.png also used by ${owner}`)
        problems.set(owner, problems.get(owner) ?? `history ${h}.png also used by ${s.name}`)
      } else historyOwner.set(h, s.name)
    }
  }
  return problems
}
