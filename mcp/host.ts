import { createServer, type Server } from 'node:http'
import { readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright-core'
import type { EngineApi } from '../src/agent/protocol.ts'

/**
 * Runs the engine page (mcp/page.html → src/agent) in Chrome and calls its API.
 *
 * The page is a production Vite build of this repo, rebuilt when sources change, served
 * from 127.0.0.1. Local files reach the page only through an intercepted URL, and only
 * the files a tool call handed over (`offer`).
 */

export const ROOT = resolve(import.meta.dirname, '..')
/** One build folder per source state: servers of other sessions keep their own build. */
const CACHE_DIR = join(ROOT, 'node_modules', '.cache', 'ssp-mcp')
const PAGE_PATH = '/mcp/page.html'
const FS_PATH = '/__ssp/fs'
/** Sources whose change requires a rebuild of the engine page */
const SOURCES = ['src', 'mcp/page.html', 'vite.config.ts', 'package-lock.json']

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

const log = (...args: unknown[]) => console.error('[ssp-mcp]', ...args)

async function newestMtime(path: string): Promise<number> {
  const s = await stat(path).catch(() => null)
  if (!s) return 0
  if (!s.isDirectory()) return s.mtimeMs
  let newest = s.mtimeMs
  for (const e of await readdir(path)) newest = Math.max(newest, await newestMtime(join(path, e)))
  return newest
}

/**
 * The engine page built from the current sources: reused when that source state was built
 * before, else built into a temporary folder that is then renamed into place.
 */
async function ensureBuilt(): Promise<string> {
  const stamp = Math.max(...(await Promise.all(SOURCES.map((s) => newestMtime(join(ROOT, s)))))).toFixed(0)
  const dir = join(CACHE_DIR, stamp)
  if (await stat(join(dir, PAGE_PATH.slice(1))).catch(() => null)) return dir
  log('building the engine page…')
  const started = Date.now()
  const tmp = `${dir}.tmp-${process.pid}`
  const { build } = await import('vite')
  await build({
    root: ROOT,
    configFile: join(ROOT, 'vite.config.ts'),
    base: '/',
    logLevel: 'error',
    publicDir: false,
    build: {
      outDir: tmp,
      emptyOutDir: true,
      reportCompressedSize: false,
      rollupOptions: { input: join(ROOT, PAGE_PATH.slice(1)) },
    },
  })
  // Another session may have finished the same build first: then use that one.
  await rename(tmp, dir).catch(() => rm(tmp, { recursive: true, force: true }))
  log(`built in ${Date.now() - started} ms`)
  // Old builds go after a day (a long-running server of another session may still use one).
  for (const name of await readdir(CACHE_DIR)) {
    const old = join(CACHE_DIR, name)
    const s = await stat(old).catch(() => null)
    if (old !== dir && s && Date.now() - s.mtimeMs > 86_400_000) await rm(old, { recursive: true, force: true })
  }
  return dir
}

/** Static server for the built page (127.0.0.1 only, so the page is a secure context). */
function serveBuild(dir: () => string): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const root = dir()
    const file = resolve(root, `.${decodeURIComponent(url.pathname)}`)
    if (!file.startsWith(root + sep)) {
      res.writeHead(403).end()
      return
    }
    readFile(file).then(
      (body) => {
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
        res.end(body)
      },
      () => res.writeHead(404).end(),
    )
  })
  return new Promise((resolveServer, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') return reject(new Error('no server address'))
      resolveServer({ server, origin: `http://127.0.0.1:${addr.port}` })
    })
  })
}

type Method = keyof EngineApi
type Arg<M extends Method> = Parameters<EngineApi[M]>[0]
type Result<M extends Method> = Awaited<ReturnType<EngineApi[M]>>

/** Playwright's "page.evaluate: Error: msg\n    at …" → "msg" */
function cleanError(e: unknown): Error {
  const raw = e instanceof Error ? e.message : String(e)
  const msg = raw
    .replace(/^page\.evaluate:\s*/, '')
    .replace(/^Error:\s*/, '')
    .split(/\n\s+at /)[0]
    .trim()
  return new Error(msg)
}

export class EngineHost {
  private starting: Promise<Page> | null = null
  private browser: Browser | null = null
  private server: Server | null = null
  private origin = ''
  /** Build folder being served */
  private buildDir = ''
  /** Absolute paths the page may read (handed over by tool calls) */
  private readonly allowed = new Set<string>()
  /** Times the engine was started; > 1 means earlier projects were lost */
  starts = 0

  /** URL the page fetches to read `abs` (allowed from now on). */
  offer(abs: string): string {
    this.allowed.add(abs)
    return `${FS_PATH}?p=${encodeURIComponent(abs)}`
  }

  private async start(): Promise<Page> {
    this.buildDir = await ensureBuilt()
    if (!this.server) {
      const { server, origin } = await serveBuild(() => this.buildDir)
      this.server = server
      this.origin = origin
    }
    const executablePath = process.env.SSP_CHROME_PATH || undefined
    try {
      this.browser = await chromium.launch({
        channel: executablePath ? undefined : (process.env.SSP_CHROME_CHANNEL ?? 'chrome'),
        executablePath,
        headless: process.env.SSP_HEADED !== '1',
        args: ['--ignore-gpu-blocklist'],
      })
    } catch (e) {
      throw new Error(
        `Could not start Chrome (${cleanError(e).message.split('\n')[0]}). Install Google Chrome, or set ` +
          'SSP_CHROME_PATH to a Chromium-based browser executable.',
      )
    }
    const browser = this.browser
    browser.on('disconnected', () => {
      if (this.browser === browser) this.reset()
    })
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    page.on('crash', () => {
      log('engine page crashed')
      this.reset()
    })
    page.on('pageerror', (e) => log('page error:', e.message))
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') log(`page ${m.type()}:`, m.text())
    })
    await page.route(
      (url) => url.pathname === FS_PATH,
      async (route) => {
        const p = new URL(route.request().url()).searchParams.get('p') ?? ''
        if (!this.allowed.has(p)) {
          await route.fulfill({ status: 403, body: `not offered: ${p}` })
          return
        }
        await route.fulfill({ path: p }).catch(async (e: unknown) => {
          await route.fulfill({ status: 404, body: cleanError(e).message })
        })
      },
    )
    await page.goto(this.origin + PAGE_PATH)
    await page.waitForFunction("document.body.dataset.ready === 'true'", null, { timeout: 30_000 })
    this.starts++
    log(`engine ready (${await page.evaluate<string>(GPU_NAME)})`)
    return page
  }

  private reset() {
    const browser = this.browser
    this.browser = null
    this.starting = null
    void browser?.close().catch(() => {})
  }

  private page(): Promise<Page> {
    if (!this.starting) {
      this.starting = this.start()
      this.starting.catch(() => this.reset())
    }
    return this.starting
  }

  async call<M extends Method>(method: M, arg: Arg<M>): Promise<Result<M>> {
    const page = await this.page()
    try {
      return (await page.evaluate(
        ([m, a]) => {
          const api = (globalThis as unknown as { __ssp: Record<string, (x: unknown) => unknown> }).__ssp
          return api[m](a)
        },
        [method, arg] as [string, unknown],
      )) as Result<M>
    } catch (e) {
      throw cleanError(e)
    }
  }

  /** Bytes of a blob prepared by the page, pulled in chunks; the blob is dropped afterwards. */
  async pull(blob: string, size: number): Promise<Buffer> {
    const CHUNK = 4 * 1024 * 1024
    const parts: Buffer[] = []
    for (let offset = 0; offset < size; offset += CHUNK) {
      const b64 = await this.call('readBlob', { blob, offset, length: Math.min(CHUNK, size - offset) })
      parts.push(Buffer.from(b64, 'base64'))
    }
    return Buffer.concat(parts)
  }

  async close() {
    await this.browser?.close().catch(() => {})
    this.server?.close()
  }
}

/** Which GPU WebGL runs on (logged at start); evaluated in the page. */
const GPU_NAME = `(() => {
  const gl = document.createElement('canvas').getContext('webgl2')
  if (!gl) return 'no WebGL2'
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown GPU'
  return name + ', float buffers: ' + (gl.getExtension('EXT_color_buffer_float') ? 'yes' : 'no')
})()`
