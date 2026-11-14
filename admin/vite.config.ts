import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  build: {
    minify: 'terser',
    terserOptions: { module: true, compress: { passes: 2 } },
    rollupOptions: {
      output: {
        // Share icon definitions instead of emitting dozens of tiny icon chunks.
        manualChunks(id) {
          if (id.includes('/lucide-react/')) return 'icons';
          if (['/react/', '/react-dom/', '/scheduler/', '/react-router/'].some(module => id.includes(module))) return 'react-vendor';
          if (id.includes('/axios/')) return 'vendor-axios';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:9090',
        changeOrigin: true,
      },
      '/media': {
        target: 'http://localhost:9090',
        changeOrigin: true,
      },
    },
  },
})
