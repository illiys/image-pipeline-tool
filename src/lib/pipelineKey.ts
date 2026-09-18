import type { ModuleRuntimeState } from '../core/pipeline'

/** Stable key for “same pipeline settings” comparisons. */
export function buildPipelineKey(runtime: ModuleRuntimeState[]): string {
  return JSON.stringify(runtime)
}
