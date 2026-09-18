import {
  canvasToBlob,
  imageToCanvas,
  loadImageFromFile,
} from '../core/canvas'
import { runPipeline, type ModuleRuntimeState } from '../core/pipeline'
import type {
  ImagePipelineModule,
  LoadedImageItem,
  ProcessedItem,
} from '../core/types'
import { optimizePngBlob } from './optimizePng'

export async function loadFilesAsItems(files: File[]): Promise<LoadedImageItem[]> {
  const items: LoadedImageItem[] = []
  for (const file of files) {
    const img = await loadImageFromFile(file)
    const objectUrl = URL.createObjectURL(file)
    items.push({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      file,
      name: file.name,
      objectUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
    })
  }
  return items
}

export async function processOne(
  item: LoadedImageItem,
  modules: ImagePipelineModule[],
  runtime: ModuleRuntimeState[],
): Promise<ProcessedItem> {
  const img = await loadImageFromFile(item.file)
  const input = imageToCanvas(img)
  const output = await runPipeline(input, modules, runtime, {
    width: item.width,
    height: item.height,
    fileName: item.name,
  })
  const rawBlob = await canvasToBlob(output, 'image/png')
  const blob = await optimizePngBlob(rawBlob)
  const previewUrl = URL.createObjectURL(blob)
  return {
    id: item.id,
    name: item.name.replace(/\.[^.]+$/, '') + '.png',
    blob,
    previewUrl,
    width: output.width,
    height: output.height,
  }
}

export function revokeProcessed(items: ProcessedItem[]) {
  for (const p of items) URL.revokeObjectURL(p.previewUrl)
}

export function revokeLoaded(items: LoadedImageItem[]) {
  for (const i of items) URL.revokeObjectURL(i.objectUrl)
}

export function revokeLoadedItem(item: LoadedImageItem) {
  URL.revokeObjectURL(item.objectUrl)
}

export function revokeProcessedItem(item: ProcessedItem) {
  URL.revokeObjectURL(item.previewUrl)
}
