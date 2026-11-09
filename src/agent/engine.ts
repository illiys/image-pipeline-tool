import {
  DEFAULT_SETTINGS,
  isOwnSection,
  normalizeOwn,
  normalizeSettings,
  SETTINGS_SECTIONS,
} from '../config/settings'
import { canvasToBlob } from '../core/canvas'
import type { GlobalSettings, OutputKind, RootOffset, SpineSymbol, SymbolOutputs } from '../core/types'
import { setFilePath } from '../lib/dropFiles'
import { buildExportBundle, symbolIdProblems } from '../lib/exportBundle'
import {
  cellFor,
  forgetSymbolCache,
  historyIdsFor,
  OUTPUT_KINDS,
  outputKeys,
  outputPaths,
  outputsAreCurrent,
  renderSymbolOutputs,
  revokeOutputs,
  revokeUnshared,
  rootFor,
  sizeFor,
  symbolSlug,
} from '../lib/exportSymbol'
import { getOptimizedPng } from '../lib/optimizePng'
import { openProject, PROJECT_EXT, projectFingerprint, saveProject } from '../lib/project'
import { cleanTitle } from '../lib/projectTitle'
import { addVariant, clampFrame, mergeUpload, withVariants } from '../lib/symbolOps'
import { measureSpineBounds, releaseSpineSource, renderSpinePreview } from '../spine/renderer'
import { maxFrameIndex } from '../spine/skeletonData'
import { parseSpineUpload } from '../spine/upload'
import { annotatePreview, onBackground } from './annotate'
import type {
  EngineApi,
  FileRef,
  PngImage,
  ProjectInfo,
  ProjectSummary,
  SymbolPatch,
  SymbolSummary,
} from './protocol'

/**
 * Headless counterpart of a project tab: the same symbol model, renders and export,
 * driven through `EngineApi` instead of the UI. Projects live only in this page.
 */
type Project = {
  id: string
  title: string
  path: string | null
  settings: GlobalSettings
  symbols: SpineSymbol[]
  outputs: Record<string, SymbolOutputs>
  /** Fingerprint at the last open/save (dirty when it differs) */
  saved: string
}

const UNTITLED = 'Untitled'
const projects = new Map<string, Project>()
let projectCounter = 0
const blobs = new Map<string, Blob>()
let blobCounter = 0
/** In-flight renders per symbol state, so parallel calls share one render */
const inflight = new Map<string, Promise<SymbolOutputs>>()

function getProject(id: string): Project {
  const p = projects.get(id)
  if (!p) {
    const open = [...projects.keys()]
    throw new Error(`No project "${id}" (open: ${open.length ? open.join(', ') : 'none'})`)
  }
  return p
}

function getSymbol(p: Project, name: string): SpineSymbol {
  const s = p.symbols.find((x) => x.name === name)
  if (s) return s
  // Also accept the slug or key, which is what the exported files are called.
  const byKey = p.symbols.filter((x) => x.key === name || symbolSlug(x.key) === name)
  if (byKey.length === 1) return byKey[0]
  throw new Error(`No symbol "${name}" in ${p.id} (symbols: ${p.symbols.map((x) => x.name).join(', ') || 'none'})`)
}

function fingerprint(p: Project): string {
  return projectFingerprint({ settings: p.settings, symbols: p.symbols })
}

function info(p: Project): ProjectInfo {
  return {
    project: p.id,
    title: p.title,
    path: p.path,
    dirty: p.symbols.length > 0 && fingerprint(p) !== p.saved,
    symbols: p.symbols.length,
  }
}

function symbolSummary(p: Project, s: SpineSymbol, problems: Map<string, string>): SymbolSummary {
  const out = p.outputs[s.name]
  const current = outputsAreCurrent(out, outputKeys(s, p.settings))
  return {
    name: s.name,
    key: s.key,
    slug: symbolSlug(s.key),
    variantOf: s.variantOf,
    history: historyIdsFor(s),
    historyAuto: s.historyIds == null,
    animation: s.animationName,
    frame: s.frame,
    root: s.root,
    animRoots: s.animRoots,
    activeRoot: rootFor(s),
    static: sizeFor(s, p.settings),
    own: s.own,
    format: s.source.skeletonJson != null ? 'json' : 'skel',
    fps: s.source.fps,
    animations: s.source.animations.map((a) => ({
      name: a.name,
      frames: maxFrameIndex(a.duration, s.source.fps) + 1,
      duration: Math.round(a.duration * 1000) / 1000,
    })),
    status: current ? (out?.error ? 'error' : 'rendered') : 'stale',
    error: current ? (out?.error ?? null) : null,
    render: current ? (out?.render ?? null) : null,
    problem: problems.get(s.name) ?? null,
  }
}

function summary(p: Project, only?: string[]): ProjectSummary {
  const problems = symbolIdProblems(p.symbols)
  const list = only ? only.map((n) => getSymbol(p, n)) : p.symbols
  return {
    ...info(p),
    settings: p.settings,
    symbolList: list.map((s) => symbolSummary(p, s, problems)),
  }
}

function newProject(title: string, settings: GlobalSettings, symbols: SpineSymbol[], path: string | null) {
  const id = `p${++projectCounter}`
  const p: Project = { id, title, path, settings, symbols, outputs: {}, saved: '' }
  p.saved = fingerprint(p)
  projects.set(id, p)
  return p
}

/** Variants share their original's source; it is released with the original. */
function dropSymbolResources(s: SpineSymbol) {
  if (s.variantOf == null) releaseSpineSource(s.source)
  forgetSymbolCache(s.name)
}

function removeFromProject(p: Project, names: Set<string>) {
  for (const s of p.symbols) {
    if (!names.has(s.name)) continue
    dropSymbolResources(s)
    revokeOutputs(p.outputs[s.name])
    delete p.outputs[s.name]
  }
  p.symbols = p.symbols.filter((s) => !names.has(s.name))
}

async function fetchFile(ref: FileRef): Promise<File> {
  const res = await fetch(ref.url)
  if (!res.ok) throw new Error(`Could not read ${ref.path}: ${res.status} ${await res.text()}`)
  const blob = await res.blob()
  const file = new File([blob], ref.name, { type: blob.type, lastModified: ref.lastModified })
  setFilePath(file, ref.path)
  return file
}

/** Renders the symbol's stale outputs (or reuses current ones). */
async function ensureOutputs(p: Project, s: SpineSymbol): Promise<SymbolOutputs> {
  const keys = outputKeys(s, p.settings)
  const prev = p.outputs[s.name]
  if (outputsAreCurrent(prev, keys)) return prev!
  const flightKey = JSON.stringify([p.id, s.name, keys])
  let job = inflight.get(flightKey)
  if (!job) {
    job = (async () => {
      const next = await renderSymbolOutputs(s, p.settings, prev, () => false)
      const stillLoaded = p.symbols.some((x) => x.name === s.name && x.source === s.source)
      if (!stillLoaded || !projects.has(p.id)) {
        revokeUnshared(next, p.outputs[s.name])
        throw new Error(`${s.name} was removed or replaced while rendering`)
      }
      // Newer outputs may have landed meanwhile; keep whichever matches the current state.
      const current = p.outputs[s.name]
      if (current && current !== prev && outputsAreCurrent(current, outputKeys(getSymbol(p, s.name), p.settings))) {
        revokeUnshared(next, current)
        return current
      }
      revokeUnshared(current, next)
      p.outputs[s.name] = next
      return next
    })().finally(() => inflight.delete(flightKey))
    inflight.set(flightKey, job)
  }
  return job
}

async function blobToBase64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(blob)
  })
  return url.slice(url.indexOf(',') + 1)
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<PngImage> {
  return {
    png: await blobToBase64(await canvasToBlob(canvas, 'image/png')),
    width: canvas.width,
    height: canvas.height,
  }
}

function putBlob(blob: Blob): string {
  const id = `b${++blobCounter}`
  blobs.set(id, blob)
  return id
}

function finiteRoot(r: RootOffset, what: string): RootOffset {
  const x = Number(r?.x)
  const y = Number(r?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${what}: x and y must be numbers`)
  return { x: Math.round(x), y: Math.round(y) }
}

function hasAnimation(s: SpineSymbol, name: string): boolean {
  return s.source.animations.some((a) => a.name === name)
}

function animationError(s: SpineSymbol, name: string): Error {
  return new Error(
    `${s.name} has no animation "${name}" (has: ${s.source.animations.map((a) => a.name).join(', ') || 'none'})`,
  )
}

function applyOwnPatch(
  own: Partial<GlobalSettings>,
  patch: NonNullable<SymbolPatch['own']>,
  settings: GlobalSettings,
): Partial<GlobalSettings> {
  const known = new Set(SETTINGS_SECTIONS.flatMap((x) => x.params.map((p) => p.key as string)))
  for (const k of Object.keys(patch)) if (!known.has(k)) throw new Error(`Unknown setting "${k}"`)
  const next: Partial<GlobalSettings> = { ...own }
  for (const section of SETTINGS_SECTIONS) {
    const given = section.params.filter((p) => p.key in patch)
    if (given.length === 0) continue
    if (given.some((p) => patch[p.key] === null)) {
      for (const p of section.params) delete next[p.key]
      continue
    }
    const base = isOwnSection(own, section) ? own : settings
    for (const p of section.params) next[p.key] = (patch[p.key] as number | undefined) ?? base[p.key]
  }
  return normalizeOwn(next)
}

function applyPatch(s: SpineSymbol, patch: SymbolPatch, settings: GlobalSettings): SpineSymbol {
  const next: SpineSymbol = { ...s }
  if (patch.key !== undefined) next.key = String(patch.key).trim()
  if (patch.historyIds !== undefined) {
    next.historyIds = patch.historyIds == null ? null : patch.historyIds.map((h) => String(h).trim())
  }
  if (patch.animation !== undefined) {
    if (patch.animation !== '' && !hasAnimation(s, patch.animation)) throw animationError(s, patch.animation)
    next.animationName = patch.animation
  }
  if (patch.animation !== undefined || patch.frame !== undefined) {
    next.frame = clampFrame(next, next.animationName, patch.frame ?? next.frame)
  }
  if (patch.root) next.root = finiteRoot(patch.root, `${s.name} root`)
  if (patch.animRoots) {
    const roots = { ...next.animRoots }
    for (const [anim, r] of Object.entries(patch.animRoots)) {
      if (!hasAnimation(s, anim)) throw animationError(s, anim)
      if (r == null) delete roots[anim]
      else roots[anim] = finiteRoot(r, `${s.name} root of ${anim}`)
    }
    next.animRoots = roots
  }
  if (patch.own) next.own = applyOwnPatch(next.own, patch.own, settings)
  return next
}

/** Frames 0..last of an animation ('' / setup pose: just 0). */
function allFrames(s: SpineSymbol, animation: string): number[] {
  const anim = s.source.animations.find((a) => a.name === animation)
  const last = anim ? maxFrameIndex(anim.duration, s.source.fps) : 0
  return Array.from({ length: last + 1 }, (_, i) => i)
}

function sanitizeSettings(patch: Partial<GlobalSettings> | undefined, base: GlobalSettings): GlobalSettings {
  if (!patch) return base
  const known = new Set(Object.keys(DEFAULT_SETTINGS))
  for (const k of Object.keys(patch)) if (!known.has(k)) throw new Error(`Unknown setting "${k}"`)
  return normalizeSettings({ ...base, ...patch })
}

export const engine: EngineApi = {
  async createProject({ title, settings }) {
    const p = newProject(
      cleanTitle(title ?? '') || UNTITLED,
      sanitizeSettings(settings, { ...DEFAULT_SETTINGS }),
      [],
      null,
    )
    return summary(p)
  },

  async openProject({ file, path }) {
    const data = await openProject(await fetchFile(file))
    const title = cleanTitle(file.name.replace(/\.ssproj$/i, '')) || UNTITLED
    const p = newProject(title, data.settings, data.symbols, path)
    return summary(p)
  },

  async closeProject({ project, discard }) {
    const p = getProject(project)
    if (info(p).dirty && !discard) {
      throw new Error(`${p.id} (${p.title}) has unsaved changes: save it first or close with discard`)
    }
    removeFromProject(p, new Set(p.symbols.map((s) => s.name)))
    projects.delete(p.id)
    return { closed: p.id }
  },

  async listProjects() {
    return [...projects.values()].map(info)
  },

  async getProject({ project, symbols }) {
    return summary(getProject(project), symbols)
  },

  async updateProject({ project, title, settings }) {
    const p = getProject(project)
    if (title != null) p.title = cleanTitle(title) || UNTITLED
    p.settings = sanitizeSettings(settings, p.settings)
    return summary(p)
  },

  async addSpine({ project, files }) {
    const p = getProject(project)
    const parsedFiles = await Promise.all(files.map(fetchFile))
    const { symbols: parsed, errors } = await parseSpineUpload(parsedFiles)
    const merged = mergeUpload(p.symbols, parsed)
    for (const old of merged.replaced) dropSymbolResources(old)
    p.symbols = merged.symbols
    return { added: merged.added, updated: merged.updated, errors, project: summary(p) }
  },

  async updateSymbols({ project, symbols, patch }) {
    const p = getProject(project)
    const targets = symbols === 'all' ? p.symbols.map((s) => s.name) : symbols.map((n) => getSymbol(p, n).name)
    const set = new Set(targets)
    if (patch.key !== undefined && set.size > 1) throw new Error('A key can only be set on one symbol at a time')
    // All patches are validated before anything changes.
    const next = p.symbols.map((s) => (set.has(s.name) ? applyPatch(s, patch, p.settings) : s))
    p.symbols = next
    const problems = symbolIdProblems(p.symbols)
    return {
      changed: next.filter((s) => set.has(s.name)).map((s) => symbolSummary(p, s, problems)),
      problems: Object.fromEntries(problems),
    }
  },

  async addVariant({ project, symbol }) {
    const p = getProject(project)
    const original = getSymbol(p, symbol)
    if (original.variantOf != null) throw new Error(`${original.name} is a variant; add variants to ${original.variantOf}`)
    const result = addVariant(p.symbols, original.name)!
    p.symbols = result.symbols
    return { variant: symbolSummary(p, result.variant, symbolIdProblems(p.symbols)) }
  },

  async removeSymbols({ project, symbols }) {
    const p = getProject(project)
    const names = withVariants(
      p.symbols,
      symbols.map((n) => getSymbol(p, n).name),
    )
    removeFromProject(p, names)
    return { removed: [...names] }
  },

  async render({ project, symbol, outputs, background = 'checker' }) {
    const p = getProject(project)
    const s = getSymbol(p, symbol)
    const out = await ensureOutputs(p, s)
    if (out.error) throw new Error(`${s.name} failed to render: ${out.error}`)
    const kinds: OutputKind[] = outputs?.length ? outputs : [...OUTPUT_KINDS]
    const images = []
    for (const kind of kinds) {
      const img = out.images[kind]
      if (!img) continue
      const bitmap = await createImageBitmap(img.blob)
      try {
        images.push({ kind, paths: outputPaths(s, kind), ...(await canvasPng(onBackground(bitmap, background))) })
      } finally {
        bitmap.close()
      }
    }
    return { symbol: symbolSummary(p, s, symbolIdProblems(p.symbols)), images }
  },

  async preview({ project, symbol, animation, frame, maxSide = 900, background = 'checker' }) {
    const p = getProject(project)
    const s = getSymbol(p, symbol)
    const anim = animation ?? s.animationName
    if (anim !== '' && !hasAnimation(s, anim)) throw animationError(s, anim)
    const f = clampFrame(s, anim, frame ?? (anim === s.animationName ? s.frame : 0))
    const side = Math.min(2048, Math.max(256, Math.round(maxSide)))
    const pose = { animationName: anim, frame: f, fps: s.source.fps }
    const root = rootFor(s, anim)
    const size = sizeFor(s, p.settings)
    // Rendered larger than the output: the composite adds the frame and margins.
    const rendered = await renderSpinePreview(s.source, pose, side)
    const measured = await measureSpineBounds(s.source, anim, [f], s.source.fps)
    const a = annotatePreview(rendered, { root, size, cell: cellFor(s, p.settings), maxSide: side, background })
    return {
      ...(await canvasPng(a.canvas)),
      animation: anim,
      frame: f,
      view: a.view,
      scale: a.scale,
      root,
      static: size,
      bounds: measured.union,
    }
  },

  async measure({ project, symbol, animation, frames = 'all' }) {
    const p = getProject(project)
    const s = getSymbol(p, symbol)
    const anim = animation ?? s.animationName
    if (anim !== '' && !hasAnimation(s, anim)) throw animationError(s, anim)
    const list =
      frames === 'all'
        ? allFrames(s, anim)
        : frames === 'current'
          ? [anim === s.animationName ? s.frame : 0]
          : frames.map((f) => clampFrame(s, anim, f))
    const m = await measureSpineBounds(s.source, anim, list, s.source.fps)
    const root = rootFor(s, anim)
    const size = sizeFor(s, p.settings)
    const b = m.union
    return {
      animation: anim,
      frames: list,
      bounds: b,
      inStatic: b && { ...b, x: b.x - root.x, y: b.y - root.y },
      root,
      static: size,
      centeredRoot: b && {
        x: Math.round(b.x + b.width / 2 - size.width / 2),
        y: Math.round(b.y + b.height / 2 - size.height / 2),
      },
    }
  },

  async saveProject({ project }) {
    const p = getProject(project)
    const blob = saveProject({ settings: p.settings, symbols: p.symbols })
    return { blob: putBlob(blob), size: blob.size, fileName: `${p.title}${PROJECT_EXT}` }
  },

  async markSaved({ project, path }) {
    const p = getProject(project)
    p.path = path
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.ssproj$/i, '')
    p.title = cleanTitle(name) || p.title
    p.saved = fingerprint(p)
    return info(p)
  },

  async prepareExport({ project, optimize = true }) {
    const p = getProject(project)
    if (p.symbols.length === 0) throw new Error(`${p.id} has no symbols`)
    const problems = symbolIdProblems(p.symbols)
    if (problems.size > 0) {
      throw new Error(`Fix symbol ids first:\n${[...problems].map(([n, m]) => `- ${n}: ${m}`).join('\n')}`)
    }
    const failed: string[] = []
    for (const s of p.symbols) {
      const out = await ensureOutputs(p, s)
      if (out.error) failed.push(`- ${s.name}: ${out.error}`)
    }
    if (failed.length > 0) throw new Error(`Some symbols failed to render:\n${failed.join('\n')}`)
    const files = []
    for (const f of buildExportBundle(p.symbols, p.outputs)) {
      const blob = f.optimizePng && optimize ? await getOptimizedPng(f.blob) : f.blob
      files.push({ path: f.path, blob: putBlob(blob), size: blob.size })
    }
    return { fileName: `${p.title}.zip`, files }
  },

  async readBlob({ blob, offset, length }) {
    const b = blobs.get(blob)
    if (!b) throw new Error(`No blob ${blob}`)
    return blobToBase64(b.slice(offset, offset + length))
  },

  async dropBlobs({ blobs: ids }) {
    for (const id of ids) blobs.delete(id)
  },
}
