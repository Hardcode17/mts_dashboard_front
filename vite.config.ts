import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import {mockService} from './mock/server.ts'

// https://vite.dev/config/
export default defineConfig({
  server: {host: '127.0.0.1', port: 5187, strictPort: true},
  preview: {host: '127.0.0.1', port: 5187, strictPort: true},
  plugins: [react(), {
    name: 'mcc-local-stand',
    configureServer(server) {
      const mock = mockService()
      server.middlewares.use(mock.handle)
      server.httpServer?.once('close', () => mock.close())
    },
    configurePreviewServer(server) {
      const mock = mockService()
      server.middlewares.use(mock.handle)
      server.httpServer.once('close', () => mock.close())
    },
  }],
})
