import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages: set base to '/repo-name/' in CI or uncomment and set your repo.
// export default defineConfig({ base: '/image-pipeline-tool/', ... })
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
