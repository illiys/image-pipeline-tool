import type { RootOffset } from '../core/types'

/**
 * Writes the chosen export root into a Spine JSON skeleton (4.x format), so the
 * skeleton's origin (0,0) becomes that point — the same point that is (0,0) of the
 * exported images.
 *
 * Root offsets are px from the root bone's setup position, x right / y down.
 * - `root` (shared): moves the root bone's setup position by (-x, +y) (Spine is y-up).
 * - `animRoots` (per animation): the difference to the shared root is added to that
 *   animation's root-bone translate keys (a constant key is created when there are none).
 */
export function bakeRootIntoJson(
  json: string,
  root: RootOffset,
  animRoots: Record<string, RootOffset>,
): string {
  const data = JSON.parse(json) as SpineJson
  const rootBone = data.bones?.find((b) => b.parent == null)
  if (!rootBone) throw new Error('Spine JSON has no root bone')

  const dx = -root.x
  const dy = root.y
  rootBone.x = round((rootBone.x ?? 0) + dx)
  rootBone.y = round((rootBone.y ?? 0) + dy)
  if (data.skeleton && typeof data.skeleton.x === 'number' && typeof data.skeleton.y === 'number') {
    // Nonessential setup-pose bounds move with the skeleton.
    data.skeleton.x = round(data.skeleton.x + dx)
    data.skeleton.y = round(data.skeleton.y + dy)
  }

  for (const [name, own] of Object.entries(animRoots)) {
    const anim = data.animations?.[name]
    if (!anim) continue
    const ax = -(own.x - root.x)
    const ay = own.y - root.y
    if (ax === 0 && ay === 0) continue
    anim.bones ??= {}
    const timelines = (anim.bones[rootBone.name] ??= {})
    offsetRootTranslate(timelines, ax, ay)
  }

  return JSON.stringify(data)
}

/**
 * Before its first key a timeline leaves the bone at the setup pose, which now lacks the
 * offset. A stepped key at 0 holds the offset (and nothing else) until the first key.
 */
function holdOffsetUntilFirstKey(keys: { time?: number; curve?: CurveField }[]) {
  if (keys.length > 0 && (keys[0].time ?? 0) > 0) keys.unshift({ curve: 'stepped' })
}

function offsetRootTranslate(t: BoneTimelines, ax: number, ay: number) {
  if (t.translate) {
    holdOffsetUntilFirstKey(t.translate)
    for (const key of t.translate) {
      key.x = round((key.x ?? 0) + ax)
      key.y = round((key.y ?? 0) + ay)
      // Bezier curve values are absolute: [cx1, cy1, cx2, cy2] for x, then for y.
      if (Array.isArray(key.curve)) {
        key.curve = key.curve.map((v, i) => (i % 2 === 1 ? round(v + (i < 4 ? ax : ay)) : v))
      }
    }
  } else if (t.translatex || t.translatey) {
    if (ax !== 0) offsetSingle((t.translatex ??= [{}]), ax)
    if (ay !== 0) offsetSingle((t.translatey ??= [{}]), ay)
  } else {
    t.translate = [{ x: ax, y: ay }]
  }
}

function offsetSingle(keys: ValueKey[], d: number) {
  holdOffsetUntilFirstKey(keys)
  for (const key of keys) {
    key.value = round((key.value ?? 0) + d)
    if (Array.isArray(key.curve)) key.curve = key.curve.map((v, i) => (i % 2 === 1 ? round(v + d) : v))
  }
}

/** Keeps the JSON free of float noise like 12.000000001. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

type CurveField = number[] | string | undefined

type TranslateKey = { time?: number; x?: number; y?: number; curve?: CurveField }
type ValueKey = { time?: number; value?: number; curve?: CurveField }
type BoneTimelines = {
  translate?: TranslateKey[]
  translatex?: ValueKey[]
  translatey?: ValueKey[]
  [other: string]: unknown
}
type SpineJson = {
  skeleton?: { x?: number; y?: number; [k: string]: unknown }
  bones?: { name: string; parent?: string; x?: number; y?: number; [k: string]: unknown }[]
  animations?: Record<string, { bones?: Record<string, BoneTimelines>; [k: string]: unknown }>
  [k: string]: unknown
}
