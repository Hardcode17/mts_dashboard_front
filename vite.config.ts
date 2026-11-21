import react from '@vitejs/plugin-react'
import {defineConfig, loadEnv} from 'vite'
import {mockService} from './mock/server.ts'

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiUrl = env.VITE_API_URL
  const proxy = apiUrl ? {'/api': {target: apiUrl, changeOrigin: true}, '/health': {target: apiUrl, changeOrigin: true}} : undefined

  return {
    server: {proxy},
    preview: {proxy},
    plugins: [react(), {
      name: 'mcc-local-stand',
      configureServer(server) {
        if (apiUrl || env.VITE_BACKEND_MODE === 'real') return
        const mock = mockService()
        server.middlewares.use(mock.handle)
        server.httpServer?.once('close', () => mock.close())
      },
      configurePreviewServer(server) {
        if (apiUrl || env.VITE_BACKEND_MODE === 'real') return
        const mock = mockService()
        server.middlewares.use(mock.handle)
        server.httpServer.once('close', () => mock.close())
      },
    }],
  }
})
