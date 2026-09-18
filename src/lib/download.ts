import JSZip from 'jszip'
import type { ProcessedItem } from '../core/types'

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadAllAsZip(items: ProcessedItem[], zipName = 'blur.zip') {
  const zip = new JSZip()
  for (const item of items) {
    zip.file(item.name, item.blob)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, zipName)
}
