import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the built dashboard also works when served from a
// subdirectory (GitHub Pages, HuggingFace Spaces, Render static site).
export default defineConfig({
  base: './',
  plugins: [react()],
  // /api goes to the Python price tracker (python -m tracker.server).
  server: { port: 5174, open: false, proxy: { '/api': 'http://127.0.0.1:8765' } },
})
