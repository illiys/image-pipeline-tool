import {
  AnimationState,
  AnimationStateData,
  GLTexture,
  ManagedWebGLRenderingContext,
  MeshAttachment,
  Physics,
  RegionAttachment,
  SceneRenderer,
  Skeleton,
  TextureAtlas,
  TextureFilter,
  type SkeletonData,
} from '@esotericsoftware/spine-webgl'
import { createCanvas, loadImageFromFile } from '../core/canvas'
import type { RenderInfo, RootOffset, SpineSource } from '../core/types'
import {
  LANCZOS_SUPPORT,
  putLinear,
  resample,
  sharpen,
  toImageData,
  type RowReader,
} from '../effects/resample'
import { frameToTime, readSkeletonData } from './skeletonData'

/**
 * One WebGL context for the whole app: browsers cap live contexts (~16) and
 * force-lose the oldest, so creating one per render produces blank frames.
 */
type Gpu = {
  canvas: HTMLCanvasElement
  context: ManagedWebGLRenderingContext
  scene: SceneRenderer
  /** 16-bit float export target; null = not supported (8-bit canvas fallback) */
  float: FloatTarget | null
}

/** Multisampled RGBA16F renderbuffer, resolved into a single-sample one for readPixels. */
type FloatTarget = {
  gl: WebGL2RenderingContext
  msFbo: WebGLFramebuffer
  msRb: WebGLRenderbuffer
  fbo: WebGLFramebuffer
  rb: WebGLRenderbuffer
  samples: number
  width: number
  height: number
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
  // alpha is rebuilt from brightness after readPixels (readFrame, renderSpineFrame).
  gpu = { canvas, context, scene, float: createFloatTarget(context.gl) }
  return gpu
}

function createFloatTarget(gl: WebGLRenderingContext): FloatTarget | null {
  if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
    return null
  }
  if (!gl.getExtension('EXT_color_buffer_float')) return null
  const msFbo = gl.createFramebuffer()
  const msRb = gl.createRenderbuffer()
  const fbo = gl.createFramebuffer()
  const rb = gl.createRenderbuffer()
  if (!msFbo || !msRb || !fbo || !rb) return null
  const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number)
  return { gl, msFbo, msRb, fbo, rb, samples, width: 0, height: 0 }
}

/** Sizes the float target; false when the GPU rejects it (fall back to 8-bit). */
function bindFloatTarget(t: FloatTarget, w: number, h: number): boolean {
  const { gl } = t
  if (t.width !== w || t.height !== h) {
    gl.bindRenderbuffer(gl.RENDERBUFFER, t.msRb)
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, t.samples, gl.RGBA16F, w, h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.msFbo)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, t.msRb)
    gl.bindRenderbuffer(gl.RENDERBUFFER, t.rb)
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA16F, w, h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, t.rb)
    gl.bindRenderbuffer(gl.RENDERBUFFER, null)
    t.width = w
    t.height = h
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.msFbo)
  if (ok && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) return true
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  t.width = 0
  t.height = 0
  return false
}

/** Resolves MSAA into the single-sample float buffer and leaves it bound for reading. */
function resolveFloatTarget(t: FloatTarget) {
  const { gl } = t
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.msFbo)
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fbo)
  gl.blitFramebuffer(0, 0, t.width, t.height, 0, 0, t.width, t.height, gl.COLOR_BUFFER_BIT, gl.NEAREST)
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
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
 * Reads the premultiplied w×h framebuffer into a straight-alpha canvas.
 *
 * Additive slots add color without alpha, which a transparent PNG cannot hold.
 * alpha = max(a, r, g, b) turns their brightness into opacity: black parts of an
 * additive texture stay transparent, glows stay visible.
 */
function readFrame(g: Gpu, w: number, h: number): HTMLCanvasElement {
  const gl = g.context.gl
  const px = new Uint8Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
  const out = new ImageData(w, h)
  const dst = out.data
  for (let y = 0; y < h; y++) {
    // GL rows are bottom-up.
    for (let x = 0, i = (h - 1 - y) * w * 4, d = y * w * 4; x < w; x++, i += 4, d += 4) {
      const a = Math.max(px[i + 3], px[i], px[i + 1], px[i + 2])
      if (a === 0) continue
      dst[d] = Math.min(255, Math.round((px[i] * 255) / a))
      dst[d + 1] = Math.min(255, Math.round((px[i + 1] * 255) / a))
      dst[d + 2] = Math.min(255, Math.round((px[i + 2] * 255) / a))
      dst[d + 3] = a
    }
  }
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.putImageData(out, 0, 0)
  return canvas
}

/** Largest framebuffer side and pixel count for export renders. */
function framebufferLimits(g: Gpu): { maxSide: number; maxPixels: number } {
  const gl = g.context.gl
  const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array
  const maxSide = Math.min(
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
    dims[0],
    dims[1],
    8192,
  )
  return { maxSide, maxPixels: 16_777_216 }
}

export const MAX_RENDER_SCALE = 8
/**
 * Auto scale renders this much above the texture density: textures are then magnified
 * rather than resampled near 1:1, which loses less detail before the Lanczos reduction.
 */
const AUTO_OVERSAMPLE = 1.5

/**
 * Texels per world unit of the posed skeleton: the scale at which its textures are drawn
 * 1:1 (e.g. 4 when the root bone is scaled 0.25). Per attachment from triangle areas
 * (world vs. texture); the densest attachments covering 10% of the drawn area win, so a
 * tiny over-shrunk detail doesn't blow up the render size.
 */
function textureDensity(skeleton: Skeleton): number {
  const items: { density: number; area: number }[] = []
  let verts = new Float32Array(64)
  for (const slot of skeleton.drawOrder.appliedPose) {
    if (!slot.bone.active) continue
    const pose = slot.appliedPose
    const attachment = pose.attachment
    if (pose.color.a <= 0) continue
    let triangles: number[]
    let count: number
    let sequence
    if (attachment instanceof RegionAttachment) {
      attachment.computeWorldVertices(slot, attachment.getOffsets(pose), verts, 0, 2)
      triangles = [0, 1, 2, 2, 3, 0]
      count = 8
      sequence = attachment.sequence
    } else if (attachment instanceof MeshAttachment) {
      count = attachment.worldVerticesLength
      if (verts.length < count) verts = new Float32Array(count)
      attachment.computeWorldVertices(skeleton, slot, 0, count, verts, 0, 2)
      triangles = attachment.triangles
      sequence = attachment.sequence
    } else continue
    const index = sequence.resolveIndex(pose)
    const image = sequence.regions[index]?.texture?.getImage() as
      | { width: number; height: number }
      | undefined
    if (!image?.width || !image.height) continue
    const uvs = sequence.getUVs(index)
    let world = 0
    let texels = 0
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t] * 2
      const b = triangles[t + 1] * 2
      const c = triangles[t + 2] * 2
      if (c >= count || b >= count || a >= count) continue
      world += Math.abs(
        (verts[b] - verts[a]) * (verts[c + 1] - verts[a + 1]) -
          (verts[c] - verts[a]) * (verts[b + 1] - verts[a + 1]),
      )
      texels += Math.abs(
        (uvs[b] - uvs[a]) * (uvs[c + 1] - uvs[a + 1]) - (uvs[c] - uvs[a]) * (uvs[b + 1] - uvs[a + 1]),
      )
    }
    texels *= image.width * image.height
    if (world > 1e-6 && texels > 0) items.push({ density: Math.sqrt(texels / world), area: world })
  }
  if (items.length === 0) return 1
  items.sort((x, y) => y.density - x.density)
  const total = items.reduce((sum, it) => sum + it.area, 0)
  let acc = 0
  for (const it of items) {
    acc += it.area
    if (acc >= total * 0.1) return it.density
  }
  return items[items.length - 1].density
}

export type FrameRequest = PoseRequest & {
  width: number
  height: number
  /**
   * Export root, relative to the skeleton's root bone in pixels (x right, y down).
   * This point becomes canvas (0,0).
   */
  root: RootOffset
  /** 0–1: render scale from 1× (0) to the full auto scale (1), set by the texture density */
  quality: number
  /** Unsharp mask after the reduction (1 = +100%) */
  sharpen: number
}

export type FrameResult = {
  canvas: HTMLCanvasElement
  info: RenderInfo
}

/**
 * Reads framebuffer rows top-down as premultiplied linear RGBA. Additive slots add color
 * without alpha, which a transparent PNG cannot hold: alpha = max(a, r, g, b) keeps glows
 * visible and black additive backgrounds clear.
 */
function framebufferRows(gl: WebGLRenderingContext, W: number, H: number, float: boolean): RowReader {
  let raw: Float32Array | Uint8Array = new Float32Array(0)
  let out = new Float32Array(0)
  return (y0, count) => {
    const n = W * count * 4
    if (out.length < n) {
      out = new Float32Array(n)
      raw = float ? new Float32Array(n) : new Uint8Array(n)
    }
    // GL rows are bottom-up: image rows y0.. are GL rows H - y0 - count..
    gl.readPixels(0, H - y0 - count, W, count, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, raw)
    const k = float ? 1 : 1 / 255
    for (let y = 0; y < count; y++) {
      let i = (count - 1 - y) * W * 4
      let d = y * W * 4
      for (let x = 0; x < W; x++, i += 4, d += 4) {
        // Float buffers can exceed 1 where additive slots stack; 8-bit ones clamp.
        const r = Math.min(1, raw[i] * k)
        const g = Math.min(1, raw[i + 1] * k)
        const b = Math.min(1, raw[i + 2] * k)
        const a = Math.max(Math.min(1, raw[i + 3] * k), r, g, b)
        if (a <= 0) {
          out[d] = out[d + 1] = out[d + 2] = out[d + 3] = 0
          continue
        }
        putLinear(out, d, r / a, g / a, b / a, a)
      }
    }
    return out
  }
}

/**
 * Export frame: the chosen root point is the top-left corner of the canvas. Rendered at
 * the render scale (plus a margin for the filter) into a 16-bit float buffer when the GPU
 * allows, then reduced with Lanczos3 in linear light.
 */
export function renderSpineFrame(source: SpineSource, req: FrameRequest): Promise<FrameResult> {
  return serialized(async () => {
    const g = getGpu()
    const { skeletonData } = await getPrepared(g, source)
    const w = Math.max(1, Math.round(req.width))
    const h = Math.max(1, Math.round(req.height))
    const skeleton = posedSkeleton(skeletonData, req)
    const bone = setupRootWorld(skeletonData)

    const density = textureDensity(skeleton)
    // Full scale is at least 2× so edges of 1:1 textures are still supersampled.
    const full = Math.min(MAX_RENDER_SCALE, Math.max(2, density * AUTO_OVERSAMPLE))
    const q = Math.min(1, Math.max(0, req.quality))
    let s = Math.max(1, Math.round((1 + (full - 1) * q) * 20) / 20)
    const { maxSide, maxPixels } = framebufferLimits(g)
    // Margin (framebuffer px) so edge pixels get their full filter footprint.
    const marginFor = (scale: number) => Math.ceil(LANCZOS_SUPPORT * scale) + 1
    const fbSize = (scale: number) => ({
      W: Math.ceil(w * scale) + 2 * marginFor(scale),
      H: Math.ceil(h * scale) + 2 * marginFor(scale),
    })
    for (;;) {
      const { W, H } = fbSize(s)
      if (s <= 1 || (Math.max(W, H) <= maxSide && W * H <= maxPixels)) break
      s = Math.max(1, s * 0.9)
    }
    const m = marginFor(s)
    const { W, H } = fbSize(s)
    // Framebuffer left/top edge is m px before the root; camera looks at its center.
    const cx = bone.x + req.root.x + (W / 2 - m) / s
    const cy = bone.y - req.root.y - (H / 2 - m) / s

    const gl = g.context.gl
    const float = g.float != null && bindFloatTarget(g.float, W, H)
    try {
      draw(g, skeleton, W, H, cx, cy, 1 / s)
      if (float) resolveFloatTarget(g.float!)
      let out = resample(framebufferRows(gl, W, H, float), W, H, w, h, 1 / s, -m / s, -m / s)
      out = sharpen(out, w, h, req.sharpen)
      const canvas = createCanvas(w, h)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('2d context unavailable')
      ctx.putImageData(toImageData(out, w, h), 0, 0)
      return { canvas, info: { textureDensity: density, renderScale: s, floatBuffer: float } }
    } finally {
      if (float) gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }
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
