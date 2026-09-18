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

Live URL: **https://illiys.github.io/image-pipeline-tool/**

1. Repo **Settings → Pages → Build and deployment**: source **GitHub Actions** (not “Deploy from branch” on `/`).
2. Push to `main` — workflow `.github/workflows/deploy-pages.yml` builds `dist` and deploys it.

Local preview of the production build:

```bash
npm run build
npx vite preview --base /image-pipeline-tool/
```

## Add a module

1. Create `src/modules/<name>.ts` implementing `ImagePipelineModule`.
2. Register it in `src/modules/registry.ts`.
3. Add its `id` to `enabledModuleIds` in `src/config/release.ts`.
4. Update presets in `src/config/presets.ts` if needed.
