import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'

/** What a Spine drop can use; other files in dropped folders are not sent to the page. */
const SPINE_EXT = new Set(['.json', '.skel', '.atlas', '.png', '.jpg', '.jpeg', '.webp', '.zip'])

export type LocalFile = {
  abs: string
  /** Path inside the "drop": relative to the common parent of the given paths */
  rel: string
  name: string
  mtime: number
}

/** Absolute path; `~` is the home folder, relative paths resolve against the server's cwd. */
export function absPath(p: string): string {
  const expanded = p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
  return resolve(expanded)
}

/** macOS/OS junk, as in the app's drops: hidden files, __MACOSX, Thumbs.db */
function isJunk(name: string): boolean {
  return name.startsWith('.') || name === '__MACOSX' || name.toLowerCase() === 'thumbs.db'
}

function commonDir(paths: string[]): string {
  const split = paths.map((p) => p.split(sep))
  const out: string[] = []
  for (let i = 0; ; i++) {
    const part = split[0][i]
    if (part == null || split.some((s) => s[i] !== part)) break
    out.push(part)
  }
  return out.join(sep) || sep
}

/**
 * Files of the given files/folders, as a drop of them would contain: folders recursively,
 * junk skipped, paths relative to the common parent (a dropped folder keeps its name).
 */
export async function collectFiles(paths: string[]): Promise<LocalFile[]> {
  const roots = paths.map(absPath)
  const base = commonDir(roots.map(dirname))
  const out: LocalFile[] = []
  const walk = async (abs: string, explicit: boolean) => {
    const s = await stat(abs).catch(() => null)
    if (!s) {
      if (explicit) throw new Error(`Not found: ${abs}`)
      return
    }
    if (s.isDirectory()) {
      for (const name of (await readdir(abs)).sort()) {
        if (!isJunk(name)) await walk(join(abs, name), false)
      }
      return
    }
    if (!explicit && !SPINE_EXT.has(extname(abs).toLowerCase())) return
    out.push({ abs, rel: relative(base, abs).split(sep).join('/'), name: basename(abs), mtime: s.mtimeMs })
  }
  for (const r of roots) await walk(r, true)
  return out
}

/** Where a file goes: `path` itself when it has the extension, else `path/<defaultName>`. */
export async function targetFile(path: string, ext: string, defaultName: string): Promise<string> {
  const abs = absPath(path)
  if (abs.toLowerCase().endsWith(ext)) return abs
  const s = await stat(abs).catch(() => null)
  if (s?.isDirectory() || path.endsWith('/')) return join(abs, defaultName)
  return abs + ext
}

/** Writes `rel` under `dir`, refusing paths that leave it. Returns whether it replaced a file. */
export async function writeInside(dir: string, rel: string, data: Uint8Array): Promise<boolean> {
  const dest = resolve(dir, rel)
  if (dest !== dir && !dest.startsWith(dir + sep)) throw new Error(`Refusing to write outside ${dir}: ${rel}`)
  const existed = (await stat(dest).catch(() => null)) != null
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, data)
  return existed
}
