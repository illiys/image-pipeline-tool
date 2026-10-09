export type ParamDef = {
  key: string
  label: string
  min: number
  max: number
  step: number
  unit?: string
  hint?: string
}

export type SpineAnimationInfo = {
  name: string
  /** Seconds */
  duration: number
}

/** Parsed Spine export. Immutable; a re-upload creates a new object. */
export type SpineSource = {
  /** Original export files, re-packed into animations/symbol_XX/ on export */
  skeletonFile: File
  atlasFile: File
  atlasText: string
  /** Atlas page name (as written in the .atlas) → texture file */
  textures: Map<string, File>
  skeletonJson: string | null
  skeletonBinary: Uint8Array | null
  animations: SpineAnimationInfo[]
  /** Dopesheet fps from the export (30 when not exported) */
  fps: number
}

export type RootOffset = { x: number; y: number }

export type FrameSize = { width: number; height: number }

export type SpineSymbol = {
  /** Unique key; name of the uploaded skeleton */
  name: string
  /** Symbol key: '09_14' → animations/symbol_09_14, symbols/big/symbol_09_14.png */
  key: string
  /** History file names without .png ('9', '14'); null = derived from the key */
  historyIds: string[] | null
  /**
   * The symbol's own values for whole settings sections (static size, cell, blur, history);
   * missing keys come from the project settings.
   */
  own: Partial<GlobalSettings>
  /**
   * Name of the symbol this one is a variant of (same Spine source, own settings), or null.
   * Variants export only static/blur/history, no animations; their history ids default to none.
   */
  variantOf: string | null
  source: SpineSource
  /** '' = setup pose (skeleton without animations) */
  animationName: string
  /** 0-based frame of the selected animation */
  frame: number
  /**
   * Export root: offset from the root bone's setup position in px (x right, y down).
   * This point is (0,0) of the exported images and becomes the skeleton origin in the
   * exported JSON. Shared by all animations…
   */
  root: RootOffset
  /** …except these, which have their own root (written into their root-bone keys). */
  animRoots: Record<string, RootOffset>
}

export type GlobalSettings = {
  /** Default static canvas size for symbols without their own size */
  staticWidth: number
  staticHeight: number
  squeezePixels: number
  blurAngle: number
  blurDistance: number
  historyMaxSide: number
  /** Zoom of the image inside the history canvas (1 = fit) */
  historyScale: number
  /** Game cell drawn centered in the static frame on the Spine preview (guide only; 0 = hidden) */
  cellWidth: number
  cellHeight: number
}

export type OutputKind = 'static' | 'blur' | 'history'

export type OutputImage = {
  blob: Blob
  url: string
  width: number
  height: number
}

export type SymbolOutputs = {
  /** Keys the outputs were rendered for; stale when they differ from the wanted keys */
  keys: Record<OutputKind, string>
  images: Partial<Record<OutputKind, OutputImage>>
  error: string | null
}
