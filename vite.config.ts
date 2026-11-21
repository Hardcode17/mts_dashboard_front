import react from '@vitejs/plugin-react'
import {defineConfig, loadEnv, type ProxyOptions, type ViteDevServer, type PreviewServer} from 'vite'
import {liveWorkspaceService, mockService} from './mock/server.ts'

function loopbackOrigin(value: string | undefined) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) return undefined
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return undefined
    return url.origin
  } catch {
    return undefined
  }
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const serverEnv = loadEnv(mode, process.cwd(), 'ROUTING_')
  const apiUrl = env.VITE_API_URL
  const advisorUrl = loopbackOrigin(serverEnv.ROUTING_ADVISOR_URL)
  const proxy: Record<string, string | ProxyOptions> = {}
  if (apiUrl) {
    proxy['/api'] = {target: apiUrl, changeOrigin: true}
    proxy['/health'] = {target: apiUrl, changeOrigin: true}
  }
  if (env.VITE_ROUTING_ADVISOR_ENABLED === 'true' && advisorUrl) {
    proxy['/routing-advisor'] = {
      target: advisorUrl,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/routing-advisor/, ''),
    }
  }

  function connectWorkspace(server: ViteDevServer | PreviewServer) {
    const live = Boolean(apiUrl) || env.VITE_BACKEND_MODE === 'real'
    const origin = apiUrl || process.env.BACKEND_URL
    if (live && !origin) return
    const service = live ? liveWorkspaceService(origin!) : mockService()
    server.middlewares.use((req, res, next) => {
      if (live && !req.url?.startsWith('/api/workspace/')) return next()
      void service.handle(req, res, next)
    })
    server.httpServer?.once('close', () => service.close())
  }

  return {
    server: {port: 5187, strictPort: true, proxy},
    preview: {port: 5187, strictPort: true, proxy},
    plugins: [react(), {
      name: 'mcc-workspace',
      configureServer: connectWorkspace,
      configurePreviewServer: connectWorkspace,
    }],
  }
})
