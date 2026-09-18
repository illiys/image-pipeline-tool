# Image Pipeline

Client-side image processing (TypeScript + React). Everything runs in the browser.

## Features

- Fixed canvas size (e.g. 320×260) with vertical center squeeze
- Motion blur with adjustable angle and distance
- Default **Symbol blur** preset
- Before/after preview, batch upload, single-file or ZIP download
- Modular pipeline; enable modules per release in `src/config/release.ts`

## Development

```bash
npm install
npm run dev
```

## Deploy

### Vercel

Import the repo, build: `npm run build`, output: `dist`.

### GitHub Pages

1. Set `base: '/<repo-name>/'` in `vite.config.ts`.
2. Run `npm run build`.
3. Publish `dist` (Actions or `gh-pages` branch).

## Add a module

1. Create `src/modules/<name>.ts` implementing `ImagePipelineModule`.
2. Register it in `src/modules/registry.ts`.
3. Add its `id` to `enabledModuleIds` in `src/config/release.ts`.
4. Update presets in `src/config/presets.ts` if needed.
