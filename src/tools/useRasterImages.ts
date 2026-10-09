import { useCallback, useRef, useState } from 'react'
import { imageToCanvas, loadImageFromFile } from '../core/canvas'

export const RASTER_ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp'
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i

export type RasterItem = {
  /** File name without extension; unique, output base name */
  name: string
  file: File
  /** Object URL of the uploaded file (source preview) */
  url: string
  width: number
  height: number
  /** History file names; null = numbers from the name (symbol_09_14 → 9, 14) */
  historyIds: string[] | null
}

/** Decoded source canvases, so param changes do not decode the file again. */
const decoded = new Map<File, HTMLCanvasElement>()

export async function sourceCanvas(file: File): Promise<HTMLCanvasElement> {
  let c = decoded.get(file)
  if (!c) {
    c = imageToCanvas(await loadImageFromFile(file))
    decoded.set(file, c)
  }
  return c
}

export type RasterImages = ReturnType<typeof useRasterImages>

/**
 * Uploaded static images, shared by the Static → Blur and Static → History tools
 * (upload once, export both).
 */
export function useRasterImages() {
  const [items, setItemsState] = useState<RasterItem[]>([])
  const itemsRef = useRef(items)
  const [uploading, setUploading] = useState(false)
  const [messages, setMessages] = useState<string[]>([])

  const setItems = useCallback((next: RasterItem[]) => {
    itemsRef.current = next
    setItemsState(next)
  }, [])

  /** Returns the name of the first added image (to select it). */
  const addFiles = useCallback(
    async (files: File[]): Promise<string | null> => {
      setUploading(true)
      setMessages([])
      const errors: string[] = []
      const byName = new Map(itemsRef.current.map((i) => [i.name, i]))
      let first: string | null = null
      for (const file of files) {
        if (!IMAGE_EXT.test(file.name)) {
          errors.push(`Skipped ${file.name} (only PNG, JPEG, WebP)`)
          continue
        }
        try {
          const canvas = await sourceCanvas(file)
          const name = file.name.replace(IMAGE_EXT, '')
          const old = byName.get(name)
          if (old) {
            URL.revokeObjectURL(old.url)
            decoded.delete(old.file)
          }
          byName.set(name, {
            name,
            file,
            url: URL.createObjectURL(file),
            width: canvas.width,
            height: canvas.height,
            historyIds: old?.historyIds ?? null,
          })
          first ??= name
        } catch (e) {
          errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      setItems(Array.from(byName.values()))
      setMessages(errors)
      setUploading(false)
      return first
    },
    [setItems],
  )

  const removeItems = useCallback(
    (names: Set<string>) => {
      for (const i of itemsRef.current) {
        if (!names.has(i.name)) continue
        URL.revokeObjectURL(i.url)
        decoded.delete(i.file)
      }
      setItems(itemsRef.current.filter((i) => !names.has(i.name)))
    },
    [setItems],
  )

  const setHistoryIds = useCallback(
    (name: string, historyIds: string[] | null) => {
      setItems(itemsRef.current.map((i) => (i.name === name ? { ...i, historyIds } : i)))
    },
    [setItems],
  )

  return {
    items,
    itemsRef,
    uploading,
    messages,
    setMessages,
    addFiles,
    removeItems,
    setHistoryIds,
  }
}
