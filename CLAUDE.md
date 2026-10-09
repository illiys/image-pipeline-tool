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
```

There is no test suite; `npm run build` is the type-check gate.

`vite.config.ts` sets `base` from `VITE_BASE_PATH`, defaulting to `/image-pipeline-tool/` (GitHub Pages). Pushing to `main` deploys via `.github/workflows/deploy-pages.yml`. Vercel deploys use `vercel.json` (SPA rewrite). Because of the base-path default, a root-hosted deploy needs `VITE_BASE_PATH=/`.

## Architecture

### Data (`src/core/types.ts`)
- `SpineSymbol` is the per-symbol state. It holds:
  - `name`: the skeleton file name, used as the unique key.
  - `key`: the symbol id, e.g. `09_14` → `symbol_09_14`.
  - `historyIds`: `null` means the ids are generated from the key's numbers (`09_14` → `9`, `14`).
  - `own`: the symbol's own values for whole settings sections (static size, cell, blur, history); missing keys come from the project settings (`settingsFor`). Toggled per section with the "own" checkboxes in the general settings panel (`SettingsPanel` `own` prop), not in the inspector.
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
- `GlobalSettings` (`config/settings.ts`) holds the project's static size, the game cell size (a guide drawn centered in the static frame on the preview; not exported; 0 = hidden), the blur params (squeeze, angle, distance) and the history params (max side, image scale). It is persisted in localStorage. `SETTINGS_SECTIONS` drives the settings UI and clamping.

### Spine (`src/spine/`)
- `lib/dropFiles.ts`: dropped folders are walked recursively (`webkitGetAsEntry`), and the folder picker uses `webkitdirectory`. Relative paths are kept in a WeakMap (`filePath`), and junk files (`.DS_Store`, `__MACOSX`) are skipped.
- `upload.ts` `parseSpineUpload`: unzips while keeping folder paths. It makes one symbol per `.json`/`.skel`, and the atlas is matched in the same folder first. Errors are collected per symbol, so valid symbols still load. Same-named skeletons from different folders get the first differing folder as a prefix (`desktop_symbol_01`, `mobile_symbol_01`).
- `renderer.ts`: there is one shared WebGL context for the whole app, because browsers force-lose contexts beyond about 16. Atlas, GPU textures and skeleton data are cached per `SpineSource`; release them with `releaseSpineSource`. Renders are serialized.
  - Additive slots: the runtime's default `pmaAdditiveBatching` adds color without alpha. `readFrame` reads the framebuffer and sets alpha = max(a, r, g, b), so a glow becomes semi-transparent and an additive texture's black background (e.g. JPG pages) stays transparent. Turning `pmaAdditiveBatching` off makes those backgrounds render black.
  - `twoColorTint` is on (tint black); PMA is handled per texture by `GLTexture`.
  - `renderSpineFrame` renders the export canvas, supersampled: up to 4× within GPU limits and about 16 Mpx. `readFrame` box-downsamples it in premultiplied space.
  - Atlas textures use trilinear filtering with mipmaps.
  - `renderSpinePreview` renders the whole skeleton (bounds plus root bone) for the root editor, without supersampling, for speed.
  - History thumbnails are downscaled in halving steps.
- `skeletonData.ts`: shared skeleton loading and frame math. Frames run 0..floor(duration·fps), so an animation's end pose is reachable.

### Export (`src/lib/`, `src/effects/`)
- `exportSymbol.ts` builds one key per output (`static`, `blur`, `history`), and only stale outputs are re-rendered. The Spine frame is rendered once per static key and cached. `effects/` derive blur (squeeze + motion blur) and history (fit to max side, then zoom by image scale) from it.
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
- Symbols and outputs live in refs (the source of truth for async code) that are mirrored to state.
- A debounced effect (250 ms) renders stale outputs, selected symbol first; any newer change cancels the pass.
- "Rendering" is derived, not stored: a symbol is pending while its output keys differ from the wanted keys, so it cannot get stuck.
- Revoke object URLs only for images that are not carried over between outputs (`revokeUnshared`).

`config/release.ts` `APP_VERSION` is shown in the header. Bump it together with `package.json` `version`.
