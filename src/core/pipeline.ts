import type { ImagePipelineModule, ModuleParams, PipelineContext } from './types'
import { cloneCanvas } from './canvas'

export type ModuleRuntimeState = {
  moduleId: string
  enabled: boolean
  params: ModuleParams
}

export function mergeParams(
  module: ImagePipelineModule,
  overrides: ModuleParams,
): ModuleParams {
  return { ...module.defaultParams, ...overrides }
}

export async function runPipeline(
  inputCanvas: HTMLCanvasElement,
  modules: ImagePipelineModule[],
  runtime: ModuleRuntimeState[],
  context: PipelineContext,
): Promise<HTMLCanvasElement> {
  let current = cloneCanvas(inputCanvas)

  const sorted = [...modules].sort((a, b) => a.order - b.order)

  for (const mod of sorted) {
    const state = runtime.find((r) => r.moduleId === mod.id)
    if (!state?.enabled) continue

    const params = mergeParams(mod, state.params)
    const next = await mod.process(current, params, context)
    current = next
  }

  return current
}
