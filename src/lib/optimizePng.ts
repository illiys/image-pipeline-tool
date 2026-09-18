/** Lossless 32-bit RGBA PNG recompression (oxipng via WASM). */
const OXIPNG_OPTIONS = {
  level: 4,
  interlace: false,
  optimiseAlpha: false,
}

type OptimiseFn = (
  data: ArrayBuffer,
  options?: typeof OXIPNG_OPTIONS,
) => Promise<ArrayBuffer>

let optimisePng: OptimiseFn | null = null

async function getOptimise(): Promise<OptimiseFn> {
  if (!optimisePng) {
    const mod = await import('@jsquash/oxipng/optimise')
    optimisePng = mod.default as OptimiseFn
  }
  return optimisePng
}

export async function optimizePngBlob(blob: Blob): Promise<Blob> {
  const input = await blob.arrayBuffer()
  const optimise = await getOptimise()
  const output = await optimise(input, OXIPNG_OPTIONS)
  if (output.byteLength >= input.byteLength) {
    return blob
  }
  return new Blob([output], { type: 'image/png' })
}
