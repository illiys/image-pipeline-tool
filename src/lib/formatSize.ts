/** Human-readable size in kilobytes (matches typical Finder-style rounding). */
export function formatSizeKb(bytes: number): string {
  const kb = bytes / 1024
  if (kb < 1) return '<1 KB'
  if (kb < 10) return `${kb.toFixed(1)} KB`
  return `${Math.round(kb)} KB`
}
