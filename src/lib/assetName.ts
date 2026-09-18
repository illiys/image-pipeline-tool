/** Display name without file extension (e.g. symbol_01.png → symbol_01). */
export function assetBaseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}
