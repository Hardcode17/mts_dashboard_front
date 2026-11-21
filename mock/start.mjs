import {createServer} from 'node:http'
import handler from 'serve-handler'
import {mockService} from './server.ts'
const mock = mockService()
const server = createServer((req, res) =>
  mock.handle(req, res, () =>
    handler(req, res, {public: 'dist', directoryListing: false, rewrites: [{source: '**', destination: '/index.html'}]}),
  ),
)
server.listen(Number(process.env.PORT || 3000), process.env.MCC_BIND_HOST || '0.0.0.0')
process.on('SIGTERM', () =>
  server.close(() => {
    mock.close()
    process.exit(0)
  }),
)
