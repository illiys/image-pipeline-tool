import type { FrameSize, GlobalSettings, RootOffset, SpineSource, SpineSymbol } from '../core/types'
import { normalizeOwn, normalizeSettings } from '../config/settings'
import { sourceFromFiles } from '../spine/upload'

/**
 * Spine Symbols Project (.ssproj) — one self-contained binary file:
 *
 *   offset 0   8 bytes   magic "SSPROJ" + format version (u16 LE)
 *   offset 8   4 bytes   manifest length N (u32 LE)
 *   offset 12  N bytes   manifest (UTF-8): settings, symbols, file table
 *   offset 12+N          file payloads back to back, raw (skeletons, atlases, textures, images)
 *
 * The file table stores each payload's offset (relative to the payload start), size,
 * name and type, so files are restored byte-for-byte without re-encoding.
 */
export const PROJECT_EXT = '.ssproj'
const MAGIC = 'SSPROJ'
const FORMAT_VERSION = 1

type FileRef = number

type FileEntry = { name: string; type: string; lastModified: number; offset: number; size: number }

type SpineEntry = {
  name: string
  key: string
  historyIds: string[] | null
  /** The symbol's own settings sections; missing in older projects */
  own?: Partial<GlobalSettings>
  /** Older projects: own static size (now `own.staticWidth/Height`) */
  size?: FrameSize | null
  /** Variant's original (its Spine files are referenced, not duplicated); missing = null */
  variantOf?: string | null
  animationName: string
  frame: number
  root: RootOffset
  animRoots: Record<string, RootOffset>
  skeleton: FileRef
  /** true = skeleton is JSON (else binary .skel) */
  json: boolean
  atlas: FileRef
  textures: Record<string, FileRef>
}

/** Unused since raster images left projects; kept so the manifest shape stays stable. */
type RasterEntry = { file: FileRef; historyIds: string[] | null }

type Manifest = {
  app: 'spine-symbol-export'
  savedAt: string
  settings: GlobalSettings
  spine: SpineEntry[]
  raster: RasterEntry[]
  files: FileEntry[]
}

/** A Spine project (Static → Blur/History work is not part of projects). */
export type ProjectData = {
  settings: GlobalSettings
  symbols: SpineSymbol[]
}

export function isProjectFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(PROJECT_EXT)
}

export function saveProject(data: ProjectData): Blob {
  const files: File[] = []
  const ids = new Map<File, FileRef>()
  const ref = (f: File): FileRef => {
    let id = ids.get(f)
    if (id == null) {
      id = files.length
      files.push(f)
      ids.set(f, id)
    }
    return id
  }

  const spine: SpineEntry[] = data.symbols.map((s) => ({
    name: s.name,
    key: s.key,
    historyIds: s.historyIds,
    own: s.own,
    variantOf: s.variantOf,
    animationName: s.animationName,
    frame: s.frame,
    root: s.root,
    animRoots: s.animRoots,
    skeleton: ref(s.source.skeletonFile),
    json: s.source.skeletonJson != null,
    atlas: ref(s.source.atlasFile),
    textures: Object.fromEntries([...s.source.textures].map(([page, f]) => [page, ref(f)])),
  }))

  let offset = 0
  const table: FileEntry[] = files.map((f) => {
    const e = { name: f.name, type: f.type, lastModified: f.lastModified, offset, size: f.size }
    offset += f.size
    return e
  })
  const manifest: Manifest = {
    app: 'spine-symbol-export',
    savedAt: new Date().toISOString(),
    settings: data.settings,
    spine,
    raster: [],
    files: table,
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))

  const header = new ArrayBuffer(12)
  const view = new DataView(header)
  for (let i = 0; i < MAGIC.length; i++) view.setUint8(i, MAGIC.charCodeAt(i))
  view.setUint16(6, FORMAT_VERSION, true)
  view.setUint32(8, manifestBytes.byteLength, true)

  return new Blob([header, manifestBytes, ...files], { type: 'application/octet-stream' })
}

export async function openProject(file: File): Promise<ProjectData> {
  const notProject = new Error(`${file.name} is not a ${PROJECT_EXT} project`)
  if (file.size < 12) throw notProject
  const head = new DataView(await file.slice(0, 12).arrayBuffer())
  const magic = String.fromCharCode(...Array.from({ length: 6 }, (_, i) => head.getUint8(i)))
  if (magic !== MAGIC) throw notProject
  const version = head.getUint16(6, true)
  if (version > FORMAT_VERSION) {
    throw new Error(`${file.name} was saved by a newer version (format ${version})`)
  }
  const manifestLength = head.getUint32(8, true)
  const manifest = JSON.parse(
    new TextDecoder().decode(await file.slice(12, 12 + manifestLength).arrayBuffer()),
  ) as Manifest
  if (manifest.app !== 'spine-symbol-export') throw new Error(`${file.name}: unknown project`)

  const payloadStart = 12 + manifestLength
  const files = manifest.files.map(
    (e) =>
      new File([file.slice(payloadStart + e.offset, payloadStart + e.offset + e.size)], e.name, {
        type: e.type,
        lastModified: e.lastModified,
      }),
  )
  const get = (id: FileRef): File => {
    const f = files[id]
    if (!f) throw new Error(`${file.name} is damaged (missing file #${id})`)
    return f
  }

  // Originals first, so variants share their source (one parse, one set of GPU textures).
  const sources = new Map<string, SpineSource>()
  const loadSource = async (e: SpineEntry): Promise<SpineSource> => {
    const skeletonFile = get(e.skeleton)
    return sourceFromFiles(
      skeletonFile,
      e.json ? await skeletonFile.text() : null,
      get(e.atlas),
      (page) => {
        const id = e.textures[page]
        if (id == null) throw new Error(`${e.name}: texture "${page}" missing in project`)
        return get(id)
      },
    )
  }
  for (const e of manifest.spine) {
    if (e.variantOf == null) sources.set(e.name, await loadSource(e))
  }

  const symbols: SpineSymbol[] = []
  for (const e of manifest.spine) {
    const original = e.variantOf != null ? sources.get(e.variantOf) : undefined
    const source = sources.get(e.name) ?? original ?? (await loadSource(e))
    const animNames = new Set(source.animations.map((a) => a.name))
    symbols.push({
      name: e.name,
      key: e.key,
      historyIds: e.historyIds,
      own: normalizeOwn(
        e.own ?? (e.size ? { staticWidth: e.size.width, staticHeight: e.size.height } : null),
      ),
      // A variant whose original is missing becomes a regular symbol
      variantOf: original ? e.variantOf! : null,
      source,
      animationName: animNames.has(e.animationName) ? e.animationName : (source.animations[0]?.name ?? ''),
      frame: e.frame,
      root: e.root,
      animRoots: Object.fromEntries(Object.entries(e.animRoots).filter(([a]) => animNames.has(a))),
    })
  }

  return {
    settings: normalizeSettings(manifest.settings as unknown as Record<string, unknown>),
    symbols,
  }
}

/**
 * Cheap identity of everything a project stores. Equal fingerprints ⇒ nothing to save.
 * Files are identified by name/size/mtime, so a freshly opened project matches itself.
 */
export function projectFingerprint(data: ProjectData): string {
  const file = (f: File) => [f.name, f.size, f.lastModified]
  return JSON.stringify([
    data.settings,
    data.symbols.map((s) => [
      s.name,
      s.key,
      s.historyIds,
      // Canonical key order, so toggling a section off and on again is not a change
      normalizeOwn(s.own),
      s.variantOf,
      s.animationName,
      s.frame,
      s.root,
      s.animRoots,
      file(s.source.skeletonFile),
      file(s.source.atlasFile),
      [...s.source.textures].map(([page, f]) => [page, file(f)]),
    ]),
  ])
}
