import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Prefixo '' carrega TODAS as vars, inclusive as sem VITE_. Elas ficam só
  // aqui, no processo Node — o bundle continua recebendo apenas as VITE_*.
  // '.' em vez de process.cwd(): o eslint deste projeto só conhece globais de
  // browser, e o loadEnv resolve o caminho relativo à raiz do projeto do mesmo
  // jeito (é sempre de lá que o vite roda).
  const env = loadEnv(mode, '.', '')

  return {
  base: '/',
  plugins: [react()],
  // Proxy do InfluxDB: o navegador chama /influx/... e este proxy injeta o
  // token. Assim a credencial nunca vai para o bundle (que é servido também
  // ao site público). Em produção o equivalente está no nginx.conf.
  server: {
    proxy: {
      '/influx': {
        target: env.INFLUXDB_URL || 'http://172.16.200.22:8086',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/influx/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            if (env.INFLUXDB_READ_TOKEN) {
              proxyReq.setHeader('Authorization', `Token ${env.INFLUXDB_READ_TOKEN}`)
            }
          })
        },
      },
    },
  },
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
  }
})
