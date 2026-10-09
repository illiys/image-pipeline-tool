import {
  AnimationState,
  AnimationStateData,
  GLTexture,
  ManagedWebGLRenderingContext,
  Physics,
  SceneRenderer,
  Skeleton,
  TextureAtlas,
  TextureFilter,
  type SkeletonData,
} from '@esotericsoftware/spine-webgl'
import { createCanvas, loadImageFromFile } from '../core/canvas'
import type { RootOffset, SpineSource } from '../core/types'
import { frameToTime, readSkeletonData } from './skeletonData'

/**
 * One WebGL context for the whole app: browsers cap live contexts (~16) and
 * force-lose the oldest, so creating one per render produces blank frames.
 */
type Gpu = {
  canvas: HTMLCanvasElement
  context: ManagedWebGLRenderingContext
  scene: SceneRenderer
}

type Prepared = {
  atlas: TextureAtlas
  skeletonData: SkeletonData
}

let gpu: Gpu | null = null
/** Atlas (with GPU textures) + skeleton data per source, valid for the current `gpu` only. */
let prepared = new Map<SpineSource, Promise<Prepared>>()
/** Sources whose symbols are gone; a late render must not cache their textures again. */
const released = new WeakSet<SpineSource>()
/** Renders are serialized: they share one canvas. */
let queue: Promise<unknown> = Promise.resolve()

function getGpu(): Gpu {
  if (gpu && !gpu.context.gl.isContextLost()) return gpu
  if (gpu) resetGpu()

  const canvas = createCanvas(1, 1)
  const context = new ManagedWebGLRenderingContext(canvas, {
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    antialias: true,
  })
  if (!context.gl) throw new Error('WebGL is not available in this browser')
  // twoColorTint keeps slot dark colors ("tint black"); PMA is handled per texture.
  const scene = new SceneRenderer(canvas, context, true)
  // Default pmaAdditiveBatching: additive slots add color without alpha. The
  // alpha is rebuilt from brightness in readFrame (see there).
  gpu = { canvas, context, scene }
  return gpu
}

function resetGpu() {
  for (const p of prepared.values()) {
    void p.then(({ atlas }) => atlas.dispose()).catch(() => {})
  }
  prepared = new Map()
  gpu = null
}

async function prepare(g: Gpu, source: SpineSource): Promise<Prepared> {
  const atlas = new TextureAtlas(source.atlasText)
  try {
    for (const page of atlas.pages) {
      const file = source.textures.get(page.name)
      if (!file) throw new Error(`Missing texture for atlas page: ${page.name}`)
      const img = await loadImageFromFile(file)
      page.setTexture(new GLTexture(g.context, img, page.pma))
      // Trilinear + mipmaps: attachments are often drawn much smaller than their atlas
      // region (e.g. a 0.25-scaled root bone); plain linear sampling would alias.
      page.texture?.setFilters(TextureFilter.MipMapLinearLinear, TextureFilter.Linear)
    }
    const skeletonData = readSkeletonData(
      atlas,
      source.skeletonJson,
      source.skeletonBinary,
    )
    return { atlas, skeletonData }
  } catch (e) {
    atlas.dispose()
    throw e
  }
}

function getPrepared(g: Gpu, source: SpineSource): Promise<Prepared> {
  if (released.has(source)) throw new Error('Spine source was released')
  let p = prepared.get(source)
  if (!p) {
    p = prepare(g, source)
    p.catch(() => prepared.delete(source))
    prepared.set(source, p)
  }
  return p
}

/** Free GPU textures of a source that is no longer used. */
export function releaseSpineSource(source: SpineSource) {
  released.add(source)
  const p = prepared.get(source)
  if (!p) return
  prepared.delete(source)
  void p.then(({ atlas }) => atlas.dispose()).catch(() => {})
}

export type PoseRequest = {
  /** '' = setup pose */
  animationName: string
  frame: number
  fps: number
}

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn)
  queue = run.catch(() => {})
  return run
}

function posedSkeleton(skeletonData: SkeletonData, req: PoseRequest): Skeleton {
  const skeleton = new Skeleton(skeletonData)
  skeleton.setupPose()
  if (req.animationName) {
    const anim = skeletonData.findAnimation(req.animationName)
    if (!anim) throw new Error(`Animation not found: ${req.animationName}`)
    const state = new AnimationState(new AnimationStateData(skeletonData))
    state.setAnimation(0, anim, false).trackTime = frameToTime(req.frame, req.fps)
    state.update(0)
    state.apply(skeleton)
  }
  skeleton.x = 0
  skeleton.y = 0
  skeleton.updateWorldTransform(Physics.update)
  return skeleton
}

const setupRootCache = new WeakMap<SkeletonData, { x: number; y: number }>()

/**
 * Root bone position in the setup pose (skeleton at 0,0). Export roots are measured
 * from here — not from the animated pose — so images match the origin baked into
 * the exported skeleton even when an animation moves the root bone.
 */
function setupRootWorld(skeletonData: SkeletonData): { x: number; y: number } {
  let p = setupRootCache.get(skeletonData)
  if (!p) {
    const skeleton = new Skeleton(skeletonData)
    skeleton.setupPose()
    skeleton.updateWorldTransform(Physics.none)
    const bone = skeleton.getRootBone()
    p = bone ? { x: bone.appliedPose.worldX, y: bone.appliedPose.worldY } : { x: 0, y: 0 }
    setupRootCache.set(skeletonData, p)
  }
  return p
}

/**
 * Draws the skeleton into a w×h canvas. Camera looks at world (cx, cy) with y up;
 * `zoom` = world units per pixel.
 */
function draw(g: Gpu, skeleton: Skeleton, w: number, h: number, cx: number, cy: number, zoom: number) {
  const { canvas, context, scene } = g
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const gl = context.gl
  scene.camera.position.set(cx, cy, 0)
  scene.camera.zoom = zoom
  scene.camera.setViewport(w, h)
  gl.viewport(0, 0, w, h)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  scene.begin()
  scene.drawSkeleton(skeleton)
  scene.end()
  if (gl.isContextLost()) throw new Error('WebGL context lost while rendering')
}

/**
 * Reads the premultiplied framebuffer (w·ss × h·ss) into a straight-alpha w×h canvas,
 * averaging each ss×ss block (supersampling) in premultiplied space so soft edges
 * don't darken.
 *
 * Additive slots add color without alpha, which a transparent PNG cannot hold.
 * alpha = max(a, r, g, b) turns their brightness into opacity: black parts of an
 * additive texture stay transparent, glows stay visible.
 */
function readFrame(g: Gpu, w: number, h: number, ss = 1): HTMLCanvasElement {
  const gl = g.context.gl
  const W = w * ss
  const H = h * ss
  const px = new Uint8Array(W * H * 4)
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px)
  const out = new ImageData(w, h)
  const dst = out.data
  const n = ss * ss
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let gg = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ss; sy++) {
        // GL rows are bottom-up.
        let i = ((H - 1 - (y * ss + sy)) * W + x * ss) * 4
        for (let sx = 0; sx < ss; sx++, i += 4) {
          const pr = px[i]
          const pg = px[i + 1]
          const pb = px[i + 2]
          r += pr
          gg += pg
          b += pb
          a += Math.max(px[i + 3], pr, pg, pb)
        }
      }
      if (a === 0) continue
      const d = (y * w + x) * 4
      dst[d] = Math.min(255, Math.round((r * 255) / a))
      dst[d + 1] = Math.min(255, Math.round((gg * 255) / a))
      dst[d + 2] = Math.min(255, Math.round((b * 255) / a))
      dst[d + 3] = Math.round(a / n)
    }
  }
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.putImageData(out, 0, 0)
  return canvas
}

/** Export supersampling: up to 4×, within GPU limits and ~16 Mpx of framebuffer. */
function supersampleFor(g: Gpu, w: number, h: number): number {
  const gl = g.context.gl
  const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array
  const maxSide = Math.min(
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
    dims[0],
    dims[1],
    8192,
  )
  let ss = 4
  while (ss > 1 && (Math.max(w, h) * ss > maxSide || w * h * ss * ss > 16_777_216)) ss--
  return ss
}

export type FrameRequest = PoseRequest & {
  width: number
  height: number
  /**
   * Export root, relative to the skeleton's root bone in pixels (x right, y down).
   * This point becomes canvas (0,0).
   */
  root: RootOffset
}

/** Export frame (supersampled): the chosen root point is the top-left corner of the canvas. */
export function renderSpineFrame(
  source: SpineSource,
  req: FrameRequest,
): Promise<HTMLCanvasElement> {
  return serialized(async () => {
    const g = getGpu()
    const { skeletonData } = await getPrepared(g, source)
    const w = Math.max(1, Math.round(req.width))
    const h = Math.max(1, Math.round(req.height))
    const skeleton = posedSkeleton(skeletonData, req)
    const bone = setupRootWorld(skeletonData)
    // Canvas center in world: root point + half the canvas (y up in world).
    const cx = bone.x + req.root.x + w / 2
    const cy = bone.y - req.root.y - h / 2
    // Draw ss× larger (zoom = world units per framebuffer pixel), then box-downsample.
    const ss = supersampleFor(g, w, h)
    draw(g, skeleton, w * ss, h * ss, cx, cy, 1 / ss)
    return readFrame(g, w, h, ss)
  })
}

export type PreviewResult = {
  canvas: HTMLCanvasElement
  /** Area shown by the canvas, in root-bone-relative pixels (x right, y down) */
  bounds: { x: number; y: number; width: number; height: number }
}

/** Whole skeleton (attachment bounds + root bone) rendered so its longest side is maxSide pixels. */
export function renderSpinePreview(
  source: SpineSource,
  req: PoseRequest,
  maxSide: number,
): Promise<PreviewResult> {
  return serialized(async () => {
    const g = getGpu()
    const { skeletonData } = await getPrepared(g, source)
    const skeleton = posedSkeleton(skeletonData, req)
    const bone = setupRootWorld(skeletonData)
    const r = skeleton.getBoundsRect()
    // World y-up → root-relative y-down; always include the root bone itself.
    let x0 = Math.min(r.x - bone.x, 0)
    let x1 = Math.max(r.x + r.width - bone.x, 0)
    let y0 = Math.min(bone.y - (r.y + r.height), 0)
    let y1 = Math.max(bone.y - r.y, 0)
    if (!Number.isFinite(x0 + x1 + y0 + y1)) {
      x0 = -100
      y0 = -100
      x1 = 100
      y1 = 100
    }
    const pad = Math.max(16, 0.05 * Math.max(x1 - x0, y1 - y0))
    x0 -= pad
    y0 -= pad
    x1 += pad
    y1 += pad
    const bw = x1 - x0
    const bh = y1 - y0
    // May exceed 1: zoomed-in previews are rendered sharper than 1:1.
    const scale = maxSide / Math.max(bw, bh)
    const w = Math.max(1, Math.round(bw * scale))
    const h = Math.max(1, Math.round(bh * scale))
    const cx = bone.x + (x0 + x1) / 2
    const cy = bone.y - (y0 + y1) / 2
    draw(g, skeleton, w, h, cx, cy, bw / w)
    return {
      canvas: readFrame(g, w, h),
      bounds: { x: x0, y: y0, width: bw, height: bh },
    }
  })
}
