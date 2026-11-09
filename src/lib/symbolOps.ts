import type { SettingsSection } from '../config/settings'
import type { GlobalSettings, SpineSource, SpineSymbol } from '../core/types'
import { maxFrameIndex } from '../spine/skeletonData'
import type { ParsedSymbol } from '../spine/upload'
import { suggestKey } from './exportSymbol'

/**
 * Symbol-list operations shared by the Spine tool UI and the automation engine
 * (src/agent). Pure: they return new symbols/lists and never touch GPU resources.
 */

export function clampFrame(symbol: SpineSymbol, animationName: string, frame: number): number {
  const anim = symbol.source.animations.find((a) => a.name === animationName)
  if (!anim) return 0
  return Math.min(Math.max(0, Math.round(frame)), maxFrameIndex(anim.duration, symbol.source.fps))
}

/** The symbol on a new Spine source: root/animation/frame kept where still valid. */
export function withSource(symbol: SpineSymbol, source: SpineSource): SpineSymbol {
  const animations = source.animations
  const animationName = animations.some((a) => a.name === symbol.animationName)
    ? symbol.animationName
    : (animations[0]?.name ?? '')
  const animRoots = Object.fromEntries(
    Object.entries(symbol.animRoots).filter(([a]) => animations.some((x) => x.name === a)),
  )
  const updated = { ...symbol, source, animationName, animRoots }
  return { ...updated, frame: clampFrame(updated, animationName, symbol.frame) }
}

export type MergeResult = {
  symbols: SpineSymbol[]
  /** First added or re-uploaded symbol (to select it) */
  firstName: string | null
  added: string[]
  updated: string[]
  /** Symbols whose source was replaced by a re-upload: release their resources */
  replaced: SpineSymbol[]
}

/**
 * Adds parsed skeletons to the list. A skeleton with an existing symbol's name is a
 * re-upload: that symbol and its variants get the new source, settings kept where valid.
 */
export function mergeUpload(current: SpineSymbol[], parsed: ParsedSymbol[]): MergeResult {
  const byName = new Map(current.map((s) => [s.name, s]))
  const added: string[] = []
  const updated: string[] = []
  const replaced: SpineSymbol[] = []
  let firstName: string | null = null
  for (const p of parsed) {
    let name = p.name
    // A variant's name ('x (2)') is not a re-upload: the skeleton is added under a free name.
    if (byName.get(name)?.variantOf != null) {
      let n = 2
      while (byName.has(`${p.name} (${n})`)) n++
      name = `${p.name} (${n})`
    }
    firstName ??= name
    const old = byName.get(name)
    const animations = p.source.animations
    if (old) {
      replaced.push(old)
      updated.push(name)
      for (const s of byName.values()) {
        if (s.name === p.name || s.variantOf === p.name) byName.set(s.name, withSource(s, p.source))
      }
    } else {
      added.push(name)
      byName.set(name, {
        name,
        key: suggestKey(
          p.name,
          Array.from(byName.values(), (s) => s.key),
        ),
        historyIds: null,
        own: {},
        variantOf: null,
        source: p.source,
        animationName: animations[0]?.name ?? '',
        frame: 0,
        root: { x: 0, y: 0 },
        animRoots: {},
      })
    }
  }
  return { symbols: Array.from(byName.values()), firstName, added, updated, replaced }
}

/**
 * A copy of the symbol on the same Spine source, with all its settings. Placed after
 * the original and its other variants; history ids start empty.
 */
export function addVariant(
  all: SpineSymbol[],
  name: string,
): { symbols: SpineSymbol[]; variant: SpineSymbol } | null {
  const original = all.find((s) => s.name === name)
  if (!original) return null
  const names = new Set(all.map((s) => s.name))
  const keys = new Set(all.map((s) => s.key.toLowerCase()))
  let n = 2
  while (names.has(`${name} (${n})`) || keys.has(`${original.key}_v${n}`.toLowerCase())) n++
  const variant: SpineSymbol = {
    ...structuredClone({ ...original, source: null }),
    source: original.source,
    name: `${name} (${n})`,
    key: `${original.key}_v${n}`,
    historyIds: null,
    variantOf: name,
  }
  let at = all.findIndex((s) => s.name === name) + 1
  while (all[at]?.variantOf === name) at++
  return { symbols: [...all.slice(0, at), variant, ...all.slice(at)], variant }
}

/** The names plus the variants of any original among them (they use its Spine files). */
export function withVariants(all: SpineSymbol[], names: Iterable<string>): Set<string> {
  const out = new Set(names)
  for (const s of all) {
    if (s.variantOf != null && out.has(s.variantOf)) out.add(s.name)
  }
  return out
}

export type SymbolSettingsCopy = Pick<SpineSymbol, 'root' | 'animRoots' | 'own'>

/** Pastes root, per-animation roots (only for animations the target has) and own settings. */
export function pasteSymbolSettings(target: SpineSymbol, copy: SymbolSettingsCopy): SpineSymbol {
  const animRoots = Object.fromEntries(
    Object.entries(copy.animRoots)
      .filter(([a]) => target.source.animations.some((x) => x.name === a))
      .map(([a, r]) => [a, { ...r }]),
  )
  return { ...target, root: { ...copy.root }, animRoots, own: { ...copy.own } }
}

/** Turns a settings section into the symbol's own (starting from the project values) or back. */
export function setOwnSection(
  own: Partial<GlobalSettings>,
  section: SettingsSection,
  on: boolean,
  settings: GlobalSettings,
): Partial<GlobalSettings> {
  const next = { ...own }
  for (const p of section.params) {
    if (on) next[p.key] = settings[p.key]
    else delete next[p.key]
  }
  return next
}
