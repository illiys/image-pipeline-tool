import type { ImagePipelineModule } from '../core/types'
import { motionBlurModule } from './motionBlur'
import { verticalCenterSqueezeModule } from './verticalCenterSqueeze'

/** All registered modules — add new ones here */
export const allModules: ImagePipelineModule[] = [
  verticalCenterSqueezeModule,
  motionBlurModule,
]

export function getModulesForRelease(
  enabledIds: readonly string[],
): ImagePipelineModule[] {
  const set = new Set(enabledIds)
  return allModules.filter((m) => set.has(m.id))
}

export function getModuleById(id: string): ImagePipelineModule | undefined {
  return allModules.find((m) => m.id === id)
}
