import { useCallback, useMemo, useState } from 'react'
import { activeRelease } from '../config/release'
import { defaultPresetId, getPresetById } from '../config/presets'
import type { ModuleRuntimeState } from '../core/pipeline'
import { getModulesForRelease } from '../modules/registry'

export function usePipelineState() {
  const modules = useMemo(
    () => getModulesForRelease(activeRelease.enabledModuleIds),
    [],
  )

  const [presetId, setPresetId] = useState(defaultPresetId)
  const [runtime, setRuntime] = useState<ModuleRuntimeState[]>(() =>
    buildRuntimeFromPreset(defaultPresetId, modules),
  )

  const applyPreset = useCallback(
    (id: string) => {
      setPresetId(id)
      setRuntime(buildRuntimeFromPreset(id, modules))
    },
    [modules],
  )

  const setModuleEnabled = useCallback((moduleId: string, enabled: boolean) => {
    setRuntime((prev) =>
      prev.map((r) => (r.moduleId === moduleId ? { ...r, enabled } : r)),
    )
  }, [])

  const setModuleParam = useCallback(
    (moduleId: string, key: string, value: number | boolean | string) => {
      setRuntime((prev) =>
        prev.map((r) =>
          r.moduleId === moduleId
            ? { ...r, params: { ...r.params, [key]: value } }
            : r,
        ),
      )
    },
    [],
  )

  const resetModuleToPreset = useCallback(
    (moduleId: string) => {
      const preset = getPresetById(presetId)
      const params = preset?.moduleParams[moduleId]
      if (!params) return
      setRuntime((prev) =>
        prev.map((r) =>
          r.moduleId === moduleId ? { ...r, params: { ...params } } : r,
        ),
      )
    },
    [presetId],
  )

  return {
    modules,
    release: activeRelease,
    presetId,
    applyPreset,
    runtime,
    setModuleEnabled,
    setModuleParam,
    resetModuleToPreset,
  }
}

function buildRuntimeFromPreset(
  presetId: string,
  modules: ReturnType<typeof getModulesForRelease>,
): ModuleRuntimeState[] {
  const preset = getPresetById(presetId)
  const enabledSet = new Set(
    preset?.enabledModuleIds ?? modules.map((m) => m.id),
  )
  return modules.map((m) => ({
    moduleId: m.id,
    enabled: enabledSet.has(m.id),
    params: {
      ...m.defaultParams,
      ...(preset?.moduleParams[m.id] ?? {}),
    },
  }))
}
