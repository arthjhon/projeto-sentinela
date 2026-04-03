import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          if (id.includes('@supabase')) {
            return 'supabase'
          }

          if (id.includes('react-router')) {
            return 'router-vendor'
          }

          if (
            id.includes('react-dom') ||
            id.includes('react/') ||
            id.includes('scheduler')
          ) {
            return 'react-vendor'
          }

          if (id.includes('lucide-react')) {
            return 'icons'
          }

          return 'vendor'
        },
      },
    },
  },
})
