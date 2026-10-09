import type { GlobalSettings, ParamDef } from '../core/types'

export const DEFAULT_SETTINGS: GlobalSettings = {
  staticWidth: 320,
  staticHeight: 260,
  squeezePixels: 40,
  blurAngle: 90,
  blurDistance: 40,
  historyMaxSide: 100,
  historyScale: 1,
  cellWidth: 0,
  cellHeight: 0,
}

export type SettingsSection = {
  title: string
  description: string
  params: (ParamDef & { key: keyof GlobalSettings })[]
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    title: 'Static default',
    description: 'Canvas size of the static frame for symbols without their own size.',
    params: [
      { key: 'staticWidth', label: 'Width', min: 1, max: 2048, step: 1, unit: 'px' },
      { key: 'staticHeight', label: 'Height', min: 1, max: 2048, step: 1, unit: 'px' },
    ],
  },
  {
    title: 'Cell',
    description:
      'Game cell, drawn centered in the static frame on the skeleton preview (guide only, not exported). 0 = hidden.',
    params: [
      { key: 'cellWidth', label: 'Width', min: 0, max: 2048, step: 1, unit: 'px' },
      { key: 'cellHeight', label: 'Height', min: 0, max: 2048, step: 1, unit: 'px' },
    ],
  },
  {
    title: 'Blur',
    description: 'Vertical squeeze, then motion blur of the static frame.',
    params: [
      {
        key: 'squeezePixels',
        label: 'Squeeze',
        min: 0,
        max: 400,
        step: 1,
        unit: 'px',
        hint: 'Total pixels removed (20 px top + 20 px bottom at 40).',
      },
      { key: 'blurAngle', label: 'Angle', min: 0, max: 360, step: 1, unit: '°' },
      { key: 'blurDistance', label: 'Distance', min: 0, max: 200, step: 1, unit: 'px' },
    ],
  },
  {
    title: 'History',
    description: 'Static frame scaled so its longest side equals Max side.',
    params: [
      {
        key: 'historyMaxSide',
        label: 'Max side',
        min: 1,
        max: 1024,
        step: 1,
        unit: 'px',
        hint: 'e.g. 320×260 → 100×81 at 100.',
      },
      {
        key: 'historyScale',
        label: 'Scale',
        min: 0.5,
        max: 3,
        step: 0.05,
        unit: '×',
        hint: 'Zooms the image inside the history canvas around its center; edges are cropped.',
      },
    ],
  },
]

const PARAM_DEFS = SETTINGS_SECTIONS.flatMap((s) => s.params)

/** Clamp every value into its param range; non-numbers fall back to the default. */
export function normalizeSettings(raw: Partial<Record<string, unknown>>): GlobalSettings {
  const out = { ...DEFAULT_SETTINGS }
  for (const def of PARAM_DEFS) {
    const n = Number(raw[def.key])
    if (raw[def.key] == null || !Number.isFinite(n)) continue
    out[def.key] = Math.min(def.max, Math.max(def.min, n))
  }
  return out
}

const STORAGE_KEY = 'spine-symbol-export.settings'
/** Static → Blur / History keep their own settings (they are not part of Spine projects). */
export const RASTER_SETTINGS_KEY = 'spine-symbol-export.raster-settings'

export function loadSettings(key = STORAGE_KEY): GlobalSettings {
  try {
    const text = localStorage.getItem(key)
    if (text) return normalizeSettings(JSON.parse(text) as Record<string, unknown>)
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(settings: GlobalSettings, key = STORAGE_KEY) {
  try {
    localStorage.setItem(key, JSON.stringify(settings))
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}
