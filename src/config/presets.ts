import type { ModuleParams } from '../core/types'
import { allModules } from '../modules/registry'

export type PipelinePreset = {
  id: string
  name: string
  description: string
  /** ZIP download filename without extension (e.g. blur → blur.zip) */
  exportArchiveName: string
  enabledModuleIds: readonly string[]
  /** moduleId -> params */
  moduleParams: Record<string, ModuleParams>
}

function moduleParamsFromDefaults(moduleIds: readonly string[]): Record<string, ModuleParams> {
  const moduleParams: Record<string, ModuleParams> = {}
  for (const m of allModules) {
    if (moduleIds.includes(m.id)) {
      moduleParams[m.id] = { ...m.defaultParams }
    }
  }
  return moduleParams
}

const symbolBlurEnabled = ['vertical-center-squeeze', 'motion-blur'] as const

const blurSymbolPreset: PipelinePreset = {
  id: 'blur-symbol',
  name: 'Symbol blur',
  description: '50 px vertical squeeze + blur 90° / 50 px',
  exportArchiveName: 'blur',
  enabledModuleIds: symbolBlurEnabled,
  moduleParams: moduleParamsFromDefaults(symbolBlurEnabled),
}

const thumbnailEnabled = ['thumbnail'] as const

const thumbnailPreset: PipelinePreset = {
  id: 'thumbnail',
  name: 'History symbols',
  description: 'Longest side 100 px (e.g. 500×400 → 100×80)',
  exportArchiveName: 'history',
  enabledModuleIds: thumbnailEnabled,
  moduleParams: moduleParamsFromDefaults(thumbnailEnabled),
}

export const presets: PipelinePreset[] = [blurSymbolPreset, thumbnailPreset]

export const defaultPresetId = presets[0].id

export function getPresetById(id: string): PipelinePreset | undefined {
  return presets.find((p) => p.id === id)
}

export function getPresetExportZipFileName(presetId: string): string {
  const base = getPresetById(presetId)?.exportArchiveName ?? 'export'
  return `${base}.zip`
}
