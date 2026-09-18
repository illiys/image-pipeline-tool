import type { ModuleParams } from '../core/types'
import { allModules } from '../modules/registry'

export type PipelinePreset = {
  id: string
  name: string
  description: string
  /** moduleId -> params */
  moduleParams: Record<string, ModuleParams>
}

/** Builds default preset from each module’s defaultParams */
function buildBlurSymbolPreset(): PipelinePreset {
  const moduleParams: Record<string, ModuleParams> = {}
  for (const m of allModules) {
    moduleParams[m.id] = { ...m.defaultParams }
  }
  return {
    id: 'blur-symbol',
    name: 'Symbol blur',
    description: '50 px vertical squeeze + blur 90° / 50 px',
    moduleParams,
  }
}

export const presets: PipelinePreset[] = [buildBlurSymbolPreset()]

export const defaultPresetId = presets[0].id

export function getPresetById(id: string): PipelinePreset | undefined {
  return presets.find((p) => p.id === id)
}
