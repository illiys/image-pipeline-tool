/**
 * Automation API of the engine page (window.__ssp), called by the MCP server (mcp/).
 * Types only: shared by the page (DOM) and the Node server, so nothing here may need DOM types.
 */
import type { GlobalSettings, OutputKind, RenderInfo, RootOffset } from '../core/types.ts'

/** A local file the page may fetch: `url` is answered by the server from disk. */
export type FileRef = {
  url: string
  /** Path inside the "drop" (folder structure, used to pair skeletons with atlases) */
  path: string
  name: string
  lastModified: number
}

/** Root-bone-relative pixels: x right, y down (same space as `root`). */
export type Box = { x: number; y: number; width: number; height: number }

/** How images are composited for viewing (exported files stay transparent). */
export type Background = 'checker' | 'dark' | 'light' | 'none'

export type SymbolPatch = {
  key?: string
  /** null = derived from the key (none for variants) */
  historyIds?: string[] | null
  /** '' = setup pose */
  animation?: string
  frame?: number
  /** Shared root (all animations without their own root) */
  root?: RootOffset
  /** Per-animation roots: a root sets it, null removes it (back to the shared root) */
  animRoots?: Record<string, RootOffset | null>
  /**
   * Own settings: per section, the given keys override (the rest of the section starts
   * from the project values); a key set to null removes that whole section.
   */
  own?: Partial<Record<keyof GlobalSettings, number | null>>
}

export type AnimationInfo = { name: string; frames: number; duration: number }

export type SymbolSummary = {
  name: string
  key: string
  /** Export file base name: symbol_<key> */
  slug: string
  variantOf: string | null
  /** History ids written (one <id>.png each) */
  history: string[]
  /** history follows the key (no explicit ids) */
  historyAuto: boolean
  animation: string
  frame: number
  root: RootOffset
  animRoots: Record<string, RootOffset>
  /** Root of the selected animation (its own root, else the shared one) */
  activeRoot: RootOffset
  /** Effective static canvas size */
  static: { width: number; height: number }
  /** The symbol's own settings values (whole sections); the rest come from the project */
  own: Partial<GlobalSettings>
  format: 'json' | 'skel'
  fps: number
  animations: AnimationInfo[]
  status: 'rendered' | 'stale' | 'error'
  error: string | null
  render: RenderInfo | null
  /** Id problem that blocks export (duplicate / invalid key or history id) */
  problem: string | null
}

export type ProjectInfo = {
  project: string
  title: string
  /** .ssproj on disk (last open/save), null if never saved */
  path: string | null
  dirty: boolean
  symbols: number
}

export type ProjectSummary = ProjectInfo & {
  settings: GlobalSettings
  symbolList: SymbolSummary[]
}

export type PngImage = { png: string; width: number; height: number }

export type RenderResult = {
  symbol: SymbolSummary
  images: (PngImage & { kind: OutputKind; paths: string[] })[]
}

export type PreviewResult = PngImage & {
  animation: string
  frame: number
  /** World box shown by the image; image px (u, v) ↔ x = view.x + u / scale, y = view.y + v / scale */
  view: Box
  /** Image pixels per skeleton pixel */
  scale: number
  root: RootOffset
  static: { width: number; height: number }
  /** Visible attachment bounds of this frame */
  bounds: Box | null
}

export type MeasureResult = {
  animation: string
  frames: number[]
  /** Union of visible bounds over the frames, root-bone-relative */
  bounds: Box | null
  /** The same box relative to the active root (= static image coordinates) */
  inStatic: Box | null
  root: RootOffset
  static: { width: number; height: number }
  /** Root that centers `bounds` in the static frame */
  centeredRoot: RootOffset | null
}

export type BlobInfo = { blob: string; size: number }

export interface EngineApi {
  createProject(a: { title?: string; settings?: Partial<GlobalSettings> }): Promise<ProjectSummary>
  openProject(a: { file: FileRef; path: string }): Promise<ProjectSummary>
  closeProject(a: { project: string; discard?: boolean }): Promise<{ closed: string }>
  listProjects(a: Record<string, never>): Promise<ProjectInfo[]>
  getProject(a: { project: string; symbols?: string[] }): Promise<ProjectSummary>
  updateProject(a: {
    project: string
    title?: string
    settings?: Partial<GlobalSettings>
  }): Promise<ProjectSummary>
  addSpine(a: { project: string; files: FileRef[] }): Promise<{
    added: string[]
    updated: string[]
    errors: string[]
    project: ProjectSummary
  }>
  updateSymbols(a: {
    project: string
    symbols: string[] | 'all'
    patch: SymbolPatch
  }): Promise<{ changed: SymbolSummary[]; problems: Record<string, string> }>
  addVariant(a: { project: string; symbol: string }): Promise<{ variant: SymbolSummary }>
  removeSymbols(a: { project: string; symbols: string[] }): Promise<{ removed: string[] }>
  render(a: {
    project: string
    symbol: string
    outputs?: OutputKind[]
    background?: Background
  }): Promise<RenderResult>
  preview(a: {
    project: string
    symbol: string
    animation?: string
    frame?: number
    maxSide?: number
    background?: Background
  }): Promise<PreviewResult>
  measure(a: {
    project: string
    symbol: string
    animation?: string
    /** Default: every frame of the animation */
    frames?: 'current' | 'all' | number[]
  }): Promise<MeasureResult>
  /** The .ssproj bytes, to be pulled with readBlob and then confirmed with markSaved */
  saveProject(a: { project: string }): Promise<BlobInfo & { fileName: string }>
  markSaved(a: { project: string; path: string }): Promise<ProjectInfo>
  /** Renders what is stale and returns the export files (PNGs optimized unless optimize=false) */
  prepareExport(a: {
    project: string
    optimize?: boolean
  }): Promise<{ fileName: string; files: (BlobInfo & { path: string })[] }>
  /** Base64 of a byte range of a prepared blob */
  readBlob(a: { blob: string; offset: number; length: number }): Promise<string>
  dropBlobs(a: { blobs: string[] }): Promise<void>
}
