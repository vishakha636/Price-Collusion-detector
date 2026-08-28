import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the built dashboard also works when served from a
// subdirectory (GitHub Pages, HuggingFace Spaces, Render static site).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5174, open: false },
})
