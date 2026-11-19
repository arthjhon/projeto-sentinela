import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { buildNamedQuery, QUERY_NAMES } from './src/services/influxQueries.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Prefixo '' carrega TODAS as vars, inclusive as sem VITE_. Elas ficam só
  // aqui, no processo Node — o bundle continua recebendo apenas as VITE_*.
  // '.' em vez de process.cwd(): o eslint deste projeto só conhece globais de
  // browser, e o loadEnv resolve o caminho relativo à raiz do projeto do mesmo
  // jeito (é sempre de lá que o vite roda).
  const env = loadEnv(mode, '.', '')
  const influxUrl = env.INFLUXDB_URL || 'http://172.16.200.22:8086'

  // Paridade com o proxy de produção: /influx/q/<nome> monta a consulta
  // InfluxQL fixa (src/services/influxQueries.js, espelho do nginx) e chama
  // /query do InfluxDB com o token só-leitura. Nada do que o cliente manda
  // além dos parâmetros nomeados chega ao Influx.
  const influxNamedQueries = {
    name: 'influx-named-queries',
    configureServer(server) {
      server.middlewares.use('/influx/q', async (req, res) => {
        const send = (status, body) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(typeof body === 'string' ? body : JSON.stringify(body))
        }
        const url = new URL(req.url, 'http://localhost')
        const name = url.pathname.replace(/^\//, '')
        if (!QUERY_NAMES.includes(name)) return send(404, { error: 'not found' })
        if (req.method !== 'GET') return send(403, { error: 'method not allowed' })
        let q
        try {
          q = buildNamedQuery(name, Object.fromEntries(url.searchParams))
        } catch (err) {
          return send(400, { error: err.message })
        }
        try {
          const target = new URL('/query', influxUrl)
          target.search = new URLSearchParams({ db: 'iot', epoch: 'ms', q }).toString()
          const headers = {}
          if (env.INFLUXDB_READ_TOKEN) headers.Authorization = `Token ${env.INFLUXDB_READ_TOKEN}`
          const upstream = await fetch(target, { headers })
          return send(upstream.status, await upstream.text())
        } catch {
          return send(502, { error: 'influx unreachable' })
        }
      })
    },
  }

  return {
  base: '/',
  plugins: [react(), influxNamedQueries],
  // Sem server.proxy['/influx']: um proxy genérico encaminharia qualquer
  // caminho (Flux /api/v2/query, /query com q livre) ao Influx com o token —
  // o SSRF que o proxy nomeado fecha. Só /influx/q/<nome> existe (plugin acima).
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
