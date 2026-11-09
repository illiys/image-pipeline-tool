# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Fully client-side Spine symbol exporter (React 19 + TypeScript + Vite + Tailwind v4). Users drop Spine exports of slot symbols, set the root position per animation and pick a frame. The tool renders the frame with WebGL and produces three images per symbol (static, blur, history), then downloads a ZIP laid out like the game repo. There is no backend.

## Commands

Node version is pinned in `.nvmrc` (CI uses Node 24).

```bash
npm run dev        # Vite dev server
npm run build      # tsc -b (type check) + vite build → dist/
npm run lint       # oxlint (config: .oxlintrc.json)
npm run preview    # serve built dist
npm run mcp        # MCP server over stdio (normally started by the MCP client, not by hand)
```

There is no test suite; `npm run build` is the type-check gate.

`vite.config.ts` sets `base` from `VITE_BASE_PATH`, defaulting to `/image-pipeline-tool/` (GitHub Pages). Pushing to `main` deploys via `.github/workflows/deploy-pages.yml`. Vercel deploys use `vercel.json` (SPA rewrite). Because of the base-path default, a root-hosted deploy needs `VITE_BASE_PATH=/`.

## Architecture

### Data (`src/core/types.ts`)
- `SpineSymbol` is the per-symbol state. It holds:
  - `name`: the skeleton file name, used as the unique key.
  - `key`: the symbol id, e.g. `09_14` → `symbol_09_14`.
  - `historyIds`: `null` means the ids are generated from the key's numbers (`09_14` → `9`, `14`).
  - `own`: the symbol's own values for whole settings sections (static size, cell, blur, history); missing keys come from the project settings (`settingsFor`). Sections: static size, cell, quality, blur, history. Toggled per section with the "own" checkboxes in the general settings panel (`SettingsPanel` `own` prop), not in the inspector.
  - `variantOf`: the original's `name` for a variant (+ Variant in the inspector), else `null`.
    - A variant shares the original's `SpineSource` object and starts as a copy of its settings, named `<name> (n)` with key `<key>_vn`. It is listed nested under the original.
    - It exports only static/blur/history (no `animations/` folder). Its `historyIds: null` means none, not ids from the key.
    - Removing or re-uploading the original removes or re-sources its variants. The source is released only with the original.
  - `animationName`, `frame`.
  - `root` and `animRoots`: the export root, as an offset from the root bone's **setup** position in px (x right, y down).
    - `root` is shared by all animations. `animRoots` only holds animations that have their own root.
    - This point is (0,0) of every exported image and becomes the skeleton origin in the exported JSON (`spine/bakeRoot.ts`). `root` is written into the root bone's setup x/y; each `animRoots` entry adds the difference to that animation's root-bone translate keys. Binary `.skel` files are exported unchanged.
    - In `SpinePreview` the root is set with two independent guides; the root is their intersection. The frame's right/bottom edges resize the static canvas: the symbol's own static size if it has one, otherwise the project's.
    - The preview pans by dragging empty space and zooms with ⌘/Ctrl + wheel or pinch; plain wheel scrolls the page.
    - The view is fitted once per symbol (the first preview) and again only with Fit; frame or animation changes never move it.
    - Frames are drawn straight into an HTML canvas layered under the SVG. It is positioned with the same mapping as the SVG `viewBox`, because Safari ignores `viewBox` transforms for `foreignObject`. Frames render at the on-screen resolution (× devicePixelRatio) in power-of-two steps.
    - ▶ plays the animation locally at its fps (latest-only rendering); pausing commits the shown frame to the symbol.
  - Copy / Paste / Paste to all (inspector) copy a symbol's `root`, `animRoots` (pasted only for animations the target has), and `own`.
- `GlobalSettings` (`config/settings.ts`) holds the project's static size, the game cell size (a guide drawn centered in the static frame on the preview; not exported; 0 = hidden), the quality params (quality 0–100, sharpen), the blur params (squeeze, angle, distance) and the history params (max side, image scale). It is persisted in localStorage. `SETTINGS_SECTIONS` drives the settings UI and clamping.

### Spine (`src/spine/`)
- `lib/dropFiles.ts`: dropped folders are walked recursively (`webkitGetAsEntry`), and the folder picker uses `webkitdirectory`. Relative paths are kept in a WeakMap (`filePath`), and junk files (`.DS_Store`, `__MACOSX`) are skipped.
- `upload.ts` `parseSpineUpload`: unzips while keeping folder paths. It makes one symbol per `.json`/`.skel`, and the atlas is matched in the same folder first. Errors are collected per symbol, so valid symbols still load. Same-named skeletons from different folders get the first differing folder as a prefix (`desktop_symbol_01`, `mobile_symbol_01`).
- `renderer.ts`: there is one shared WebGL context for the whole app, because browsers force-lose contexts beyond about 16. Atlas, GPU textures and skeleton data are cached per `SpineSource`; release them with `releaseSpineSource`. Renders are serialized.
  - Additive slots: the runtime's default `pmaAdditiveBatching` adds color without alpha. `readFrame` (preview) and `framebufferRows` (export) set alpha = max(a, r, g, b) on readback, so a glow becomes semi-transparent and an additive texture's black background (e.g. JPG pages) stays transparent. Turning `pmaAdditiveBatching` off makes those backgrounds render black.
  - `twoColorTint` is on (tint black); PMA is handled per texture by `GLTexture`.
  - `renderSpineFrame` renders the export canvas larger, then reduces it with Lanczos3 in linear light (`effects/resample.ts`), optionally unsharp-masks it and dithers the 8-bit output.
    - Render scale: Quality (0–100) goes from 1× to the full scale, which is 1.5× the skeleton's texture density (texels per world unit from attachment triangle areas), at least 2×, at most 8×, within GPU limits and about 16 Mpx. A filter margin is rendered around the frame.
    - It draws into a multisampled RGBA16F framebuffer when WebGL2 + `EXT_color_buffer_float` allow (else the 8-bit canvas) and reads it back in row bands.
    - It returns `RenderInfo` (texture density, render scale, 16/8-bit), shown under the outputs; textures below ~3.5× are flagged as a low-res atlas.
  - Atlas textures use trilinear filtering with mipmaps.
  - `renderSpinePreview` renders the whole skeleton (bounds plus root bone) for the root editor, without supersampling, for speed.
- `skeletonData.ts`: shared skeleton loading and frame math. Frames run 0..floor(duration·fps), so an animation's end pose is reachable.

### Export (`src/lib/`, `src/effects/`)
- `exportSymbol.ts` builds one key per output (`static`, `blur`, `history`), and only stale outputs are re-rendered. The Spine frame is rendered once per static key and cached. `effects/` derive blur (squeeze + motion blur) and history (fit to max side, then zoom by image scale; Lanczos3) from it.
- `exportBundle.ts` builds the ZIP layout:
  - `animations/symbol_XX/` (original skeleton and atlas renamed to `symbol_XX.*`; textures keep their atlas page names)
  - `symbols/big/symbol_XX.png`
  - `symbols/blur/symbol_XX.png`
  - `assets/history/symbols/<id>.png`, one file per history id, plus `.gitkeep` and the game's `README.md`
- `symbolIdProblems` blocks export on duplicate or invalid ids.
- oxipng (`lib/optimizePng`, lazy-loaded) runs only at download time.

### Modes and project tabs (`src/App.tsx`, `src/Workspace.tsx`, `src/tools/`)
- **Spine mode** works in project tabs. Each tab is a `Workspace` (one Spine project) that stays mounted while hidden.
  - A workspace holds its own `SpineTool`, settings, title, Save and unsaved state.
  - The title is "Untitled" by default and is renamed by double-clicking the tab (`WorkspaceApi.rename`). Save (`<title>.ssproj`) and the export ZIP (`<title>.zip`) use it as the file name.
  - Open… accepts several `.ssproj` files at once, one tab each. An empty, untouched active tab is reused.
  - Closing a tab with unsaved changes asks first, in-page (`ConfirmDialog`).
- **Static → Blur / Static → History** are project-less. `App` holds them: one shared image list (`useRasterImages`) with its own settings (`RASTER_SETTINGS_KEY`).
  - Blur writes `symbols/blur/<file name>.png` (`blur.zip`).
  - History writes `assets/history/symbols/<id>.png` (`history.zip`). Ids come from the file name's numbers (`symbol_09_14` → 9, 14) and are editable.
- **Unsaved tracking:** `projectFingerprint` (settings plus symbol state plus file name/size/mtime) is compared with the fingerprint at the last save/open. `beforeunload` warns if any tab is dirty or static images are loaded (they are never saved).
- **Use `ConfirmDialog`, not `window.confirm`, before opening a file dialog:** Safari drops the user gesture after `window.confirm`, so the file dialog would silently fail to open.

### Projects (`src/lib/project.ts`)
- **`.ssproj` format:** a single binary file, not a zip.
  - Bytes 0–7: the magic `SSPROJ` plus the format version (u16).
  - Then a u32 manifest length and the UTF-8 manifest, which holds the settings, the Spine symbols (key, history ids, own settings, animation, frame, roots) and a file table of offsets and sizes. `raster` is always empty: static images are not part of projects.
  - Then the raw source files back to back.
- Open is in the App header and Save is in the active project's header slot. `.ssproj` files dropped on the Spine drop zone open in tabs.
- `SpineTool` exposes `snapshot`/`load` through `apiRef`.
- Spine sources are rebuilt with `sourceFromFiles` (shared with uploads). Variants store `variantOf` and reuse their original's source on open; shared files are stored once. `own`/`variantOf` are optional in the manifest; older projects' `size` is migrated into `own` on open. Bump `FORMAT_VERSION` when the manifest changes incompatibly.

### App flow (`src/tools/SpineTool.tsx`)
- Symbol-list operations (upload merge/re-source, variants, removal with variants, paste, own sections) are pure functions in `lib/symbolOps.ts`, shared with the automation engine.
- Symbols and outputs live in refs (the source of truth for async code) that are mirrored to state.
- A debounced effect (250 ms) renders stale outputs, selected symbol first; any newer change cancels the pass.
- "Rendering" is derived, not stored: a symbol is pending while its output keys differ from the wanted keys, so it cannot get stuck.
- Revoke object URLs only for images that are not carried over between outputs (`revokeUnshared`).

`config/release.ts` `APP_VERSION` is shown in the header. Bump it together with `package.json` `version`.

### Automation: MCP server (`mcp/`, `src/agent/`)
- `mcp/server.ts` is an MCP server (stdio) that lets an agent create/open/save `.ssproj` projects, add Spine exports from disk, set keys/history/animation/frame/roots/own settings, add variants, preview, measure and export (ZIP or straight into a folder). Registered for Claude Code at user scope as `spine-symbols` (`claude mcp add -s user spine-symbols -- node <repo>/mcp/server.ts`). Run directly by Node 24 (type stripping): only erasable TS, imports with `.ts`.
- **Engine page:** `mcp/page.html` → `src/agent/main.ts` exposes `window.__ssp` (`EngineApi` in `src/agent/protocol.ts`). It is a headless counterpart of a project tab built on the same modules (upload, `symbolOps`, `renderSymbolOutputs`, `buildExportBundle`, `project.ts`); no React. Projects live only in that page.
- **Host (`mcp/host.ts`):** builds the engine page with Vite into `node_modules/.cache/ssp-mcp/<source mtime>/` when `src/`, `mcp/page.html`, `vite.config.ts` or `package-lock.json` changed, serves it on 127.0.0.1 and opens it in headless Chrome (`playwright-core`, system Chrome; `SSP_CHROME_PATH` / `SSP_CHROME_CHANNEL` override, `SSP_HEADED=1` shows the window). Started lazily on the first tool call; restarted after a crash (open projects are lost).
- **File transfer:** the page reads local files only through the intercepted `/__ssp/fs?p=` URL, and only paths a tool call offered (`EngineHost.offer`). Outputs (.ssproj, export files) come back as page blobs pulled in base64 chunks (`readBlob`).
- `src/agent/` is type-checked with the app; `mcp/` with `tsconfig.node.json` (no DOM: code evaluated in the page is passed as strings). `src/agent/protocol.ts` must stay free of DOM types since both sides import it.
- Tool output: `preview_skeleton` returns an annotated image (grid in root-bone px, root guides, static frame, cell) plus the view mapping; `measure_bounds` returns visible-attachment bounds (`measureSpineBounds` in `renderer.ts`) and the root that centers them.
