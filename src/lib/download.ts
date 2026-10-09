import JSZip from 'jszip'
import type { BundleFile } from './exportBundle'
import { getOptimizedPng } from './optimizePng'

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Lossless oxipng pass happens here, at export time, not on every re-render. */
export async function downloadPng(blob: Blob, fileName: string) {
  downloadBlob(await getOptimizedPng(blob), fileName)
}

export async function downloadZip(
  files: BundleFile[],
  zipName: string,
  onProgress?: (done: number, total: number) => void,
) {
  const zip = new JSZip()
  let done = 0
  for (const f of files) {
    zip.file(f.path, f.optimizePng ? await getOptimizedPng(f.blob) : f.blob)
    onProgress?.(++done, files.length)
  }
  downloadBlob(await zip.generateAsync({ type: 'blob' }), zipName)
}
