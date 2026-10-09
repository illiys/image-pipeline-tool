import JSZip from 'jszip'
import { TextureAtlas } from '@esotericsoftware/spine-webgl'
import type { SpineAnimationInfo, SpineSource } from '../core/types'
import { filePath, isJunkPath } from '../lib/dropFiles'
import { normalizeFps, readSkeletonData } from './skeletonData'

export const SPINE_UPLOAD_ACCEPT = '.json,.skel,.atlas,.zip,.png,.jpg,.jpeg,.webp,.ssproj'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp'])

/** A file with its path inside the drop (folder structure from ZIPs is kept). */
type Entry = { path: string; file: File }

export type ParsedSymbol = { name: string; source: SpineSource }

export type UploadResult = {
  symbols: ParsedSymbol[]
  /** Human-readable problems; valid symbols are still returned */
  errors: string[]
}

function ext(path: string): string {
  const i = path.lastIndexOf('.')
  return i > path.lastIndexOf('/') ? path.slice(i + 1).toLowerCase() : ''
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i) : ''
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function stem(path: string): string {
  const b = basename(path)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(0, i) : b
}

function joinPath(dir: string, rel: string): string {
  const parts = dir ? dir.split('/') : []
  for (const p of rel.split('/')) {
    if (p === '..') parts.pop()
    else if (p && p !== '.') parts.push(p)
  }
  return parts.join('/')
}

async function expandEntries(files: File[]): Promise<{ entries: Entry[]; skipped: string[] }> {
  const entries: Entry[] = []
  const skipped: string[] = []
  for (const file of files) {
    const path = filePath(file).replace(/\\/g, '/')
    if (isJunkPath(path)) continue
    if (ext(path) !== 'zip') {
      entries.push({ path, file })
      continue
    }
    const zip = await JSZip.loadAsync(file)
    for (const [inner, entry] of Object.entries(zip.files)) {
      const p = inner.replace(/\\/g, '/')
      if (entry.dir || isJunkPath(p)) continue
      if (ext(p) === 'spine') {
        skipped.push(`${basename(p)} (Spine project file — export JSON/skel instead)`)
        continue
      }
      const blob = await entry.async('blob')
      entries.push({
        path: `${path}/${p}`,
        file: new File([blob], basename(p), { lastModified: entry.date.getTime() }),
      })
    }
  }
  return { entries, skipped }
}

async function isSpineJson(file: File): Promise<string | null> {
  try {
    const text = await file.text()
    const parsed = JSON.parse(text) as Record<string, unknown>
    return Array.isArray(parsed.bones) || parsed.skeleton != null ? text : null
  } catch {
    return null
  }
}

/** Atlas for a skeleton: same folder + same name, the only atlas in the folder, or the only one with that name. */
function findAtlas(skeletonPath: string, atlases: Entry[]): Entry | null {
  const dir = dirname(skeletonPath)
  const name = stem(skeletonPath)
  const sameDir = atlases.filter((a) => dirname(a.path) === dir)
  const exact = sameDir.find((a) => stem(a.path) === name)
  if (exact) return exact
  if (sameDir.length === 1) return sameDir[0]
  const sameName = atlases.filter((a) => stem(a.path) === name)
  if (sameName.length === 1) return sameName[0]
  if (atlases.length === 1) return atlases[0]
  return null
}

function findTexture(atlasPath: string, page: string, images: Entry[]): Entry | null {
  const wanted = joinPath(dirname(atlasPath), page)
  const exact = images.find((i) => i.path === wanted)
  if (exact) return exact
  const name = basename(page)
  const sameDir = images.find(
    (i) => dirname(i.path) === dirname(wanted) && basename(i.path) === name,
  )
  if (sameDir) return sameDir
  const byName = images.filter((i) => basename(i.path) === name)
  return byName.length === 1 ? byName[0] : null
}

async function buildSource(
  skeleton: Entry,
  skeletonJson: string | null,
  atlasEntry: Entry,
  images: Entry[],
): Promise<SpineSource> {
  return sourceFromFiles(skeleton.file, skeletonJson, atlasEntry.file, (page) => {
    const tex = findTexture(atlasEntry.path, page, images)
    if (!tex) throw new Error(`texture "${page}" for ${basename(atlasEntry.path)} not found`)
    return tex.file
  })
}

/**
 * Builds a SpineSource from known files (`textureFor` maps an atlas page name to its
 * file). Used by uploads and by opening a saved project.
 */
export async function sourceFromFiles(
  skeletonFile: File,
  skeletonJson: string | null,
  atlasFile: File,
  textureFor: (page: string) => File,
): Promise<SpineSource> {
  const atlasText = await atlasFile.text()
  const atlas = new TextureAtlas(atlasText)
  try {
    const textures = new Map<string, File>()
    for (const page of atlas.pages) textures.set(page.name, textureFor(page.name))
    const skeletonBinary =
      skeletonJson == null ? new Uint8Array(await skeletonFile.arrayBuffer()) : null
    // Parsing against the atlas also validates that every attachment has a region.
    const data = readSkeletonData(atlas, skeletonJson, skeletonBinary)
    // findSliderAnimations appends into the array it is given.
    const sliderOnly = new Set(data.findSliderAnimations([]))
    const animations: SpineAnimationInfo[] = data.animations
      .filter((a) => !sliderOnly.has(a))
      .map((a) => ({ name: a.name, duration: Math.max(0, a.duration) }))
    return {
      skeletonFile,
      atlasFile,
      atlasText,
      textures,
      skeletonJson,
      skeletonBinary,
      animations,
      fps: normalizeFps(data.fps),
    }
  } finally {
    atlas.dispose()
  }
}

/**
 * Turns a drop (loose files and/or ZIPs) into Spine symbols: one symbol per
 * skeleton file (.json / .skel), named after it.
 */
export async function parseSpineUpload(files: File[]): Promise<UploadResult> {
  const errors: string[] = []
  const { entries, skipped } = await expandEntries(files)
  for (const s of skipped) errors.push(`Skipped ${s}`)

  const atlases = entries.filter((e) => ext(e.path) === 'atlas')
  const images = entries.filter((e) => IMAGE_EXT.has(ext(e.path)))
  const skeletons: { entry: Entry; json: string | null }[] = []
  for (const e of entries) {
    const x = ext(e.path)
    if (x === 'skel') skeletons.push({ entry: e, json: null })
    else if (x === 'json') {
      const json = await isSpineJson(e.file)
      if (json != null) skeletons.push({ entry: e, json })
    } else if (x === 'spine') {
      errors.push(`Skipped ${basename(e.path)} (Spine project file — export JSON/skel instead)`)
    }
  }

  if (skeletons.length === 0) {
    errors.push('No Spine skeleton (.json or .skel) found in the drop.')
    return { symbols: [], errors }
  }

  // Same skeleton name from different folders (e.g. desktop/… and mobile/…) → prefix
  // the first folder that differs between them: desktop_symbol_01, mobile_symbol_01.
  const sameName = new Map<string, string[][]>()
  for (const s of skeletons) {
    const n = stem(s.entry.path)
    const dirs = dirname(s.entry.path).replace(/\.zip(?=\/|$)/gi, '').split('/').filter(Boolean)
    sameName.set(n, [...(sameName.get(n) ?? []), dirs])
  }
  const prefixFor = (base: string, path: string): string => {
    const group = sameName.get(base) ?? []
    if (group.length < 2) return ''
    const dirs = dirname(path).replace(/\.zip(?=\/|$)/gi, '').split('/').filter(Boolean)
    const depth = Math.max(...group.map((g) => g.length))
    for (let i = 0; i < depth; i++) {
      if (new Set(group.map((g) => g[i])).size > 1) return dirs[i] ?? ''
    }
    return ''
  }

  const symbols: ParsedSymbol[] = []
  const usedNames = new Set<string>()
  for (const s of skeletons) {
    const base = stem(s.entry.path)
    const prefix = prefixFor(base, s.entry.path)
    let name = prefix ? `${prefix}_${base}` : base
    for (let i = 2; usedNames.has(name); i++) name = `${base}_${i}`
    usedNames.add(name)
    const atlas = findAtlas(s.entry.path, atlases)
    if (!atlas) {
      errors.push(`${name}: no matching .atlas`)
      continue
    }
    try {
      symbols.push({ name, source: await buildSource(s.entry, s.json, atlas, images) })
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { symbols, errors }
}
