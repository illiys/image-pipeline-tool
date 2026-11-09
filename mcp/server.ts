#!/usr/bin/env node
// stdout carries the MCP protocol: route stray console output to stderr before anything loads.
import './stdio-guard.ts'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import JSZip from 'jszip'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { PngImage } from '../src/agent/protocol.ts'
import { absPath, collectFiles, targetFile, writeInside } from './files.ts'
import { EngineHost } from './host.ts'

const host = new EngineHost()

const INSTRUCTIONS = `
Spine Symbol Export: builds slot-symbol assets from Spine exports, like the web app in this repo.
Per symbol it renders a static image, a blur image and history thumbnails, and exports a game-repo
layout (animations/symbol_XX/…, symbols/big/symbol_XX.png, symbols/blur/symbol_XX.png,
assets/history/symbols/<id>.png). Projects are .ssproj files, the same format the app's Open/Save uses,
so the user can open what you save and vice versa.

Workflow: create_project or open_project → add_spine (folders/zips/files) → inspect with get_project,
preview_skeleton, measure_bounds → set roots/frames/keys with update_symbols → check with render_outputs
→ save_project and/or export_project.

Coordinates: px relative to the root bone's setup position, x right, y down. A symbol's root is the
top-left corner of its static image (its 0,0); the static image covers root.x … root.x+width,
root.y … root.y+height. The exported JSON skeleton gets this root as its origin. measure_bounds returns
visible bounds over an animation and the root that would center them (centeredRoot).

A symbol is addressed by its name (the skeleton file name), key ("09_14") or slug ("symbol_09_14").
The engine runs in a headless Chrome; projects live there until closed, so save what should persist.
`.trim()

const server = new McpServer({ name: 'spine-symbol-export', version: '1.0.0' }, { instructions: INSTRUCTIONS })

const json = (x: unknown) => JSON.stringify(x, null, 1)
const text = (x: unknown): CallToolResult => ({ content: [{ type: 'text', text: typeof x === 'string' ? x : json(x) }] })
const image = (img: PngImage) => ({ type: 'image' as const, data: img.png, mimeType: 'image/png' })

/** Tool errors are returned as results so the model sees the message. */
function tool<A>(fn: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args)
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e)
      if (/^No project /.test(msg) && host.starts > 1) {
        msg += '\n(The engine was restarted; projects that were open before are gone. Reopen them from disk.)'
      }
      return { isError: true, content: [{ type: 'text', text: msg }] }
    }
  }
}

const project = z.string().describe('Project id from create_project / open_project, e.g. "p1"')
const symbolRef = z.string().describe('Symbol name (skeleton file name), key ("09_14") or slug ("symbol_09_14")')
const background = z
  .enum(['checker', 'dark', 'light', 'none'])
  .optional()
  .describe('Background behind transparent pixels in the returned image (default checker); files are unaffected')
const root = z.object({ x: z.number(), y: z.number() })

const SETTING_DOCS = {
  staticWidth: 'Static image width, px (1–2048)',
  staticHeight: 'Static image height, px (1–2048)',
  cellWidth: 'Game cell guide width, px (preview only, not exported; 0 = hidden)',
  cellHeight: 'Game cell guide height, px (0 = hidden)',
  quality: 'Render quality 0–100: render scale from 1× to the full auto scale (default 80)',
  sharpenPercent: 'Unsharp mask after the reduction, 0–100 %',
  squeezePixels: 'Blur: total px removed by the vertical center squeeze (0–400)',
  blurAngle: 'Blur: motion blur angle, ° (0–360)',
  blurDistance: 'Blur: motion blur distance, px (0–200)',
  historyMaxSide: 'History: longest side of the thumbnail, px (1–1024)',
  historyScale: 'History: zoom of the image inside the thumbnail (0.5–3; 1 = fit)',
} as const
type SettingKey = keyof typeof SETTING_DOCS
const settingKeys = Object.keys(SETTING_DOCS) as SettingKey[]

const settingsSchema = z
  .object(Object.fromEntries(settingKeys.map((k) => [k, z.number().optional().describe(SETTING_DOCS[k])])))
  .strict()
  .describe('Project settings (any subset; values are clamped to their ranges)')

const ownSchema = z
  .object(
    Object.fromEntries(settingKeys.map((k) => [k, z.number().nullable().optional().describe(SETTING_DOCS[k])])),
  )
  .strict()
  .describe(
    "The symbol's own settings. They override whole sections (static size, cell, quality, blur, history): " +
      'keys you give override, the rest of their section is copied from the project; null for any key of a ' +
      'section returns that section to the project values.',
  )

server.registerTool(
  'create_project',
  {
    title: 'Create project',
    description: 'Creates an empty Spine symbols project in the engine and returns its id and settings.',
    inputSchema: {
      title: z.string().optional().describe('Project title (used as the default file name); default "Untitled"'),
      settings: settingsSchema.optional(),
    },
  },
  tool(async ({ title, settings }) => text(await host.call('createProject', { title, settings }))),
)

server.registerTool(
  'open_project',
  {
    title: 'Open .ssproj',
    description: 'Opens a .ssproj project file (as saved by the app or save_project) and returns its contents.',
    inputSchema: { path: z.string().describe('Absolute path of the .ssproj file') },
  },
  tool(async ({ path }) => {
    if (!path.toLowerCase().endsWith('.ssproj')) throw new Error(`Not a .ssproj file: ${path}`)
    const [file] = await collectFiles([path])
    const result = await host.call('openProject', {
      file: { url: host.offer(file.abs), path: file.name, name: file.name, lastModified: file.mtime },
      path: file.abs,
    })
    return text(result)
  }),
)

server.registerTool(
  'save_project',
  {
    title: 'Save .ssproj',
    description:
      'Saves the project (settings, symbols and all Spine files) as a .ssproj file the app can open. ' +
      'Overwrites the file if it exists.',
    inputSchema: {
      project,
      path: z
        .string()
        .optional()
        .describe('File path (.ssproj) or folder (<title>.ssproj inside). Default: where it was opened/saved.'),
    },
  },
  tool(async ({ project: id, path }) => {
    const target = path ?? (await host.call('listProjects', {})).find((p) => p.project === id)?.path
    if (!target) throw new Error(`${id} was never saved: give a path`)
    const saved = await host.call('saveProject', { project: id })
    const dest = await targetFile(target, '.ssproj', saved.fileName)
    const bytes = await host.pull(saved.blob, saved.size)
    await host.call('dropBlobs', { blobs: [saved.blob] })
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, bytes)
    const info = await host.call('markSaved', { project: id, path: dest })
    return text({ saved: dest, bytes: bytes.length, ...info })
  }),
)

server.registerTool(
  'close_project',
  {
    title: 'Close project',
    description: 'Closes a project and frees its GPU resources. Refuses unsaved changes unless discard is true.',
    inputSchema: { project, discard: z.boolean().optional().describe('Close even with unsaved changes') },
  },
  tool(async ({ project: id, discard }) => text(await host.call('closeProject', { project: id, discard }))),
)

server.registerTool(
  'list_projects',
  {
    title: 'List projects',
    description: 'Projects open in the engine: id, title, file path, unsaved state, symbol count.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  tool(async () => text(await host.call('listProjects', {}))),
)

server.registerTool(
  'get_project',
  {
    title: 'Get project',
    description:
      'Project settings and its symbols: key/slug, history ids, animations (with frame counts), selected ' +
      'animation/frame, roots, own settings, render status and id problems that block export.',
    inputSchema: {
      project,
      symbols: z.array(symbolRef).optional().describe('Only these symbols (default all)'),
    },
    annotations: { readOnlyHint: true },
  },
  tool(async ({ project: id, symbols }) => text(await host.call('getProject', { project: id, symbols }))),
)

server.registerTool(
  'update_project',
  {
    title: 'Update project',
    description: 'Renames the project and/or changes project settings (they apply to every symbol without own values).',
    inputSchema: { project, title: z.string().optional(), settings: settingsSchema.optional() },
  },
  tool(async ({ project: id, title, settings }) =>
    text(await host.call('updateProject', { project: id, title, settings })),
  ),
)

server.registerTool(
  'add_spine',
  {
    title: 'Add Spine exports',
    description:
      'Adds Spine exports to the project, like dropping them on the app: folders (searched recursively), ' +
      '.zip files, or .json/.skel + .atlas + texture files. One symbol per skeleton, named after the file; ' +
      'atlases are matched by folder. A skeleton with an existing symbol name re-sources that symbol ' +
      '(settings kept). Problems are returned per skeleton; valid ones are still added.',
    inputSchema: {
      project,
      paths: z.array(z.string()).min(1).describe('Absolute paths of folders, zips or files'),
    },
  },
  tool(async ({ project: id, paths }) => {
    const files = await collectFiles(paths)
    if (files.length === 0) throw new Error('No Spine files (.json/.skel/.atlas/images/.zip) found there')
    const result = await host.call('addSpine', {
      project: id,
      files: files.map((f) => ({ url: host.offer(f.abs), path: f.rel, name: f.name, lastModified: f.mtime })),
    })
    return text(result)
  }),
)

server.registerTool(
  'update_symbols',
  {
    title: 'Update symbols',
    description:
      'Changes symbols. Give only what should change. root moves the shared root (used by animations ' +
      'without their own); anim_roots sets a per-animation root (null removes it). animation/frame choose the ' +
      'pose that is rendered into the images. Applies to every listed symbol ("all" = every symbol), except ' +
      'key, which must be unique. Returns the changed symbols and any id problems.',
    inputSchema: {
      project,
      symbols: z.union([z.array(symbolRef).min(1), z.literal('all')]),
      key: z.string().optional().describe('Symbol id: "09_14" → symbol_09_14 (letters, digits, _)'),
      history_ids: z
        .array(z.string())
        .nullable()
        .optional()
        .describe('History file names without .png; [] = none; null = numbers of the key (none for variants)'),
      animation: z.string().optional().describe('Animation to render ("" = setup pose)'),
      frame: z.number().int().optional().describe('0-based frame of the animation (clamped)'),
      root: root.optional().describe('Shared root: top-left of the static image, px from the root bone (y down)'),
      anim_roots: z
        .record(z.string(), root.nullable())
        .optional()
        .describe('Per-animation roots: { "<animation>": {x, y} } sets, null removes'),
      own: ownSchema.optional(),
    },
  },
  tool(async ({ project: id, symbols, key, history_ids, animation, frame, root: r, anim_roots, own }) =>
    text(
      await host.call('updateSymbols', {
        project: id,
        symbols,
        patch: { key, historyIds: history_ids, animation, frame, root: r, animRoots: anim_roots, own },
      }),
    ),
  ),
)

server.registerTool(
  'add_variant',
  {
    title: 'Add variant',
    description:
      'Adds a variant of a symbol: same Spine files, its own settings (starting as a copy), key <key>_vN. ' +
      'Variants export only static/blur/history (no animations folder) and have no history ids by default.',
    inputSchema: { project, symbol: symbolRef },
  },
  tool(async ({ project: id, symbol }) => text(await host.call('addVariant', { project: id, symbol }))),
)

server.registerTool(
  'remove_symbols',
  {
    title: 'Remove symbols',
    description: 'Removes symbols from the project (removing an original removes its variants too).',
    inputSchema: { project, symbols: z.array(symbolRef).min(1) },
  },
  tool(async ({ project: id, symbols }) => text(await host.call('removeSymbols', { project: id, symbols }))),
)

server.registerTool(
  'preview_skeleton',
  {
    title: 'Preview skeleton',
    description:
      'Image of the whole skeleton at a frame, like the app\'s root editor: grid labeled in root-bone px, ' +
      'root bone (gray cross, "bone"), root guides (red), static frame (blue dashed) and game cell (orange). ' +
      'Use it to choose roots; image px (u, v) maps to x = view.x + u / scale, y = view.y + v / scale.',
    inputSchema: {
      project,
      symbol: symbolRef,
      animation: z.string().optional().describe('Default: the symbol\'s animation ("" = setup pose)'),
      frame: z.number().int().optional().describe("Default: the symbol's frame (frame 0 for another animation)"),
      max_side: z.number().int().optional().describe('Longest side of the image, px (256–2048, default 900)'),
      background,
    },
    annotations: { readOnlyHint: true },
  },
  tool(async ({ project: id, symbol, animation, frame, max_side, background: bg }) => {
    const r = await host.call('preview', { project: id, symbol, animation, frame, maxSide: max_side, background: bg })
    const { png: _png, ...meta } = r
    return { content: [image(r), { type: 'text', text: json(meta) }] }
  }),
)

server.registerTool(
  'render_outputs',
  {
    title: 'Render outputs',
    description:
      'Renders the symbol\'s export images (static, blur, history) with the current settings and returns them, ' +
      'with the render details (texture density, render scale, 16/8-bit) and the paths they export to.',
    inputSchema: {
      project,
      symbol: symbolRef,
      outputs: z.array(z.enum(['static', 'blur', 'history'])).optional().describe('Default all three'),
      background,
    },
    annotations: { readOnlyHint: true },
  },
  tool(async ({ project: id, symbol, outputs, background: bg }) => {
    const r = await host.call('render', { project: id, symbol, outputs, background: bg })
    const content: CallToolResult['content'] = []
    for (const img of r.images) {
      content.push({ type: 'text', text: `${img.kind} ${img.width}×${img.height} → ${img.paths.join(', ') || '(no history ids)'}` })
      content.push(image(img))
    }
    content.push({ type: 'text', text: json(r.symbol) })
    return { content }
  }),
)

server.registerTool(
  'measure_bounds',
  {
    title: 'Measure bounds',
    description:
      'Visible attachment bounds (root-bone px, y down) over frames of an animation, the same box in static ' +
      'image coordinates for the current root, and centeredRoot: the root that centers the bounds in the static frame.',
    inputSchema: {
      project,
      symbol: symbolRef,
      animation: z.string().optional().describe('Default: the symbol\'s animation ("" = setup pose)'),
      frames: z
        .union([z.enum(['all', 'current']), z.array(z.number().int())])
        .optional()
        .describe('Frames to measure (default all)'),
    },
    annotations: { readOnlyHint: true },
  },
  tool(async ({ project: id, symbol, animation, frames }) => {
    const r = await host.call('measure', { project: id, symbol, animation, frames })
    const shown = r.frames.length > 12 ? `${r.frames[0]}…${r.frames[r.frames.length - 1]}` : r.frames
    return text({ ...r, frames: shown })
  }),
)

server.registerTool(
  'export_project',
  {
    title: 'Export',
    description:
      'Renders whatever is stale and writes the export: a ZIP (like the app\'s export button) or the same ' +
      'files directly into a folder (e.g. a game repo; existing files are overwritten). Blocked by id problems ' +
      'or render errors. PNGs are optimized losslessly (oxipng).',
    inputSchema: {
      project,
      path: z.string().describe('ZIP file path, or a folder (folder format; or <title>.zip inside for zip)'),
      format: z.enum(['zip', 'folder']).optional().describe('Default: zip when path ends in .zip, else folder'),
      optimize: z.boolean().optional().describe('oxipng pass on PNGs (default true)'),
    },
  },
  tool(async ({ project: id, path, format, optimize }) => {
    const fmt = format ?? (path.toLowerCase().endsWith('.zip') ? 'zip' : 'folder')
    const prepared = await host.call('prepareExport', { project: id, optimize })
    const ids = prepared.files.map((f) => f.blob)
    try {
      if (fmt === 'zip') {
        const zip = new JSZip()
        for (const f of prepared.files) zip.file(f.path, await host.pull(f.blob, f.size))
        const dest = await targetFile(path, '.zip', prepared.fileName)
        await mkdir(dirname(dest), { recursive: true })
        const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
        await writeFile(dest, bytes)
        return text({ zip: dest, bytes: bytes.length, files: prepared.files.map((f) => f.path) })
      }
      const dir = absPath(path)
      const s = await stat(dir).catch(() => null)
      if (s && !s.isDirectory()) throw new Error(`${dir} is a file, not a folder`)
      const written: string[] = []
      const replaced: string[] = []
      for (const f of prepared.files) {
        const existed = await writeInside(dir, f.path, await host.pull(f.blob, f.size))
        ;(existed ? replaced : written).push(f.path)
      }
      return text({ folder: dir, created: written, overwritten: replaced })
    } finally {
      await host.call('dropBlobs', { blobs: ids }).catch(() => {})
    }
  }),
)

async function shutdown() {
  await host.close()
  process.exit(0)
}
process.stdin.on('close', () => void shutdown())
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

await server.connect(new StdioServerTransport())
console.error('[ssp-mcp] ready')
