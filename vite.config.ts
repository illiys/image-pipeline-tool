import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** GitHub Pages project site: https://illiys.github.io/image-pipeline-tool/ */
const base = process.env.VITE_BASE_PATH ?? '/image-pipeline-tool/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
})
