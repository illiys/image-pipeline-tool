export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(source.width, source.height)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.drawImage(source, 0, 0)
  return c
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      type,
      quality,
    )
  })
}

export async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error(`Failed to load ${file.name}`))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = createCanvas(img.naturalWidth, img.naturalHeight)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.drawImage(img, 0, 0)
  return c
}

export function getImageData(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

export function putImageData(
  canvas: HTMLCanvasElement,
  data: ImageData,
): HTMLCanvasElement {
  const c = cloneCanvas(canvas)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.putImageData(data, 0, 0)
  return c
}
