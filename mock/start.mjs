import {createServer} from 'node:http'
import handler from 'serve-handler'
import {mockService} from './server.ts'
import {makeReadProxy} from './readProxy.mjs'
const mock = mockService()
const proxy = makeReadProxy(process.env.MCC_BACKEND_ORIGIN)
function serveApp(req, res) {
  return mock.handle(req, res, () =>
    handler(req, res, {public: 'dist', rewrites: [{source: '**', destination: '/index.html'}]}),
  )
}
const server = createServer((req, res) => {
  if (proxy) return proxy(req, res, () => serveApp(req, res))
  return serveApp(req, res)
})
server.listen(Number(process.env.PORT || 3000), '0.0.0.0')
process.on('SIGTERM', () =>
  server.close(() => {
    mock.close()
    process.exit(0)
  }),
)
