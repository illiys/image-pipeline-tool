/**
 * Files from a drop or picker, including the contents of dropped folders.
 * Folder-relative paths are kept (see `filePath`) so uploads can pair files by folder.
 */

const paths = new WeakMap<File, string>()

/** Path inside the dropped/picked folder ('anim/symbol_01/symbol_01.json'), or the file name. */
export function filePath(file: File): string {
  return paths.get(file) ?? (file.webkitRelativePath || file.name)
}

/** macOS/OS junk: hidden files, __MACOSX, Thumbs.db */
export function isJunkPath(path: string): boolean {
  return path
    .split('/')
    .some((p) => p.startsWith('.') || p === '__MACOSX' || p.toLowerCase() === 'thumbs.db')
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await entryFile(entry as FileSystemFileEntry)
    const path = entry.fullPath.replace(/^\//, '')
    if (isJunkPath(path)) return
    paths.set(file, path)
    out.push(file)
    return
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // readEntries returns results in batches until an empty batch.
    for (;;) {
      const batch = await readEntries(reader)
      if (batch.length === 0) break
      for (const child of batch) await walk(child, out)
    }
  }
}

/**
 * Must be called synchronously inside the drop handler (items are only readable
 * during the event); the returned promise resolves with all files.
 */
export function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items)
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry())
  if (entries.length === 0 || entries.some((e) => e == null)) {
    // No entry API (or synthetic drop): plain files only.
    return Promise.resolve(Array.from(dt.files).filter((f) => !isJunkPath(f.name)))
  }
  return (async () => {
    const out: File[] = []
    for (const e of entries) await walk(e!, out)
    return out
  })()
}

/** Files from <input type=file> (with or without webkitdirectory). */
export function filesFromInput(list: FileList | null): File[] {
  return Array.from(list ?? []).filter((f) => !isJunkPath(filePath(f)))
}
