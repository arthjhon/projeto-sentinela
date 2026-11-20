import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { buildNamedQuery, QUERY_NAMES, QUERY_DB } from './src/services/influxQueries.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Prefixo '' carrega TODAS as vars, inclusive as sem VITE_. Elas ficam só
  // aqui, no processo Node — o bundle continua recebendo apenas as VITE_*.
  // '.' em vez de process.cwd(): o eslint deste projeto só conhece globais de
  // browser, e o loadEnv resolve o caminho relativo à raiz do projeto do mesmo
  // jeito (é sempre de lá que o vite roda).
  const env = loadEnv(mode, '.', '')
  const influxUrl = env.INFLUXDB_URL || 'http://172.16.200.22:8086'

  // Dev local: o navegador fala só com a porta do Vite (a que o VS Code
  // encaminha) e o Vite repassa Supabase e MQTT. Liga só com as vars no
  // .env.local (DEV_SUPABASE_PROXY, DEV_MQTT_PROXY); não afeta o build.
  // Caminhos fixos — nunca /influx (ver o comentário em `server` abaixo).
  const devProxy = {}
  if (env.DEV_SUPABASE_PROXY) {
    const supa = { target: env.DEV_SUPABASE_PROXY, changeOrigin: true }
    for (const path of ['/auth/v1', '/rest/v1', '/storage/v1', '/functions/v1']) {
      devProxy[path] = supa
    }
    devProxy['/realtime/v1'] = { ...supa, ws: true }
  }
  if (env.DEV_MQTT_PROXY) {
    devProxy['/mqtt'] = { target: env.DEV_MQTT_PROXY, ws: true, changeOrigin: true }
  }
  const usaDevProxy = Object.keys(devProxy).length > 0

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
          target.search = new URLSearchParams({ db: QUERY_DB[name], epoch: 'ms', q }).toString()
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
  // Com o proxy de dev ligado, a porta fica fixa: VITE_SUPABASE_URL aponta para
  // ela, e cair na 5174 em silêncio quebraria o login.
  server: usaDevProxy ? { port: 5173, strictPort: true, proxy: devProxy } : undefined,
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
