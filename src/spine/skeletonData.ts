import {
  AtlasAttachmentLoader,
  SkeletonBinary,
  SkeletonJson,
  type SkeletonData,
  type TextureAtlas,
} from '@esotericsoftware/spine-webgl'

export const DEFAULT_FPS = 30

/** Spine stores fps only with nonessential data; fall back to 30. */
export function normalizeFps(fps: number): number {
  return Number.isFinite(fps) && fps >= 1 ? Math.round(fps) : DEFAULT_FPS
}

export function readSkeletonData(
  atlas: TextureAtlas,
  skeletonJson: string | null,
  skeletonBinary: Uint8Array | null,
): SkeletonData {
  const loader = new AtlasAttachmentLoader(atlas)
  if (skeletonJson != null) {
    return new SkeletonJson(loader).readSkeletonData(skeletonJson)
  }
  if (skeletonBinary != null) {
    return new SkeletonBinary(loader).readSkeletonData(skeletonBinary)
  }
  throw new Error('Spine skeleton data missing')
}

/**
 * Last selectable frame index. Frames are 0..N where N = duration × fps, so the
 * animation's end pose is reachable. The epsilon absorbs float32 noise from .skel.
 */
export function maxFrameIndex(durationSeconds: number, fps: number): number {
  if (!(durationSeconds > 0)) return 0
  return Math.max(0, Math.floor(durationSeconds * normalizeFps(fps) + 1e-3))
}

export function frameToTime(frame: number, fps: number): number {
  return Math.max(0, Math.round(frame) || 0) / normalizeFps(fps)
}
