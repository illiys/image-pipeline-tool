export type ParamKind = 'number' | 'boolean' | 'select'

export type SelectOption = { value: string; label: string }

export type ModuleParamDef = {
  key: string
  label: string
  kind: ParamKind
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: SelectOption[]
  /** Tooltip / hint in UI */
  hint?: string
}

export type ModuleParams = Record<string, number | boolean | string>

export type PipelineContext = {
  width: number
  height: number
  fileName: string
}

export type ImagePipelineModule = {
  id: string
  name: string
  description: string
  order: number
  defaultParams: ModuleParams
  paramDefs: ModuleParamDef[]
  /** Reads/writes canvas; usually same dimensions unless the module resizes */
  process: (
    sourceCanvas: HTMLCanvasElement,
    params: ModuleParams,
    ctx: PipelineContext,
  ) => HTMLCanvasElement | Promise<HTMLCanvasElement>
}

export type LoadedImageItem = {
  id: string
  file: File
  name: string
  objectUrl: string
  width: number
  height: number
}

export type ProcessedItem = {
  id: string
  name: string
  blob: Blob
  previewUrl: string
  width: number
  height: number
}
