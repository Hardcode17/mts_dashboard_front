import {createServer, request as requestHttp} from 'node:http'
import {request as requestHttps} from 'node:https'
import serve from 'serve-handler'

const backend = new URL(process.env.BACKEND_URL ?? '')
if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password ||
    backend.pathname !== '/' || backend.search || backend.hash) {
  throw new Error('BACKEND_URL must be an HTTP(S) origin')
}

const requestBackend = backend.protocol === 'https:' ? requestHttps : requestHttp
const omittedHeaders = new Set(['connection', 'host', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'])

function forwardedHeaders(headers) {
  const excluded = new Set(String(headers.connection ?? '').toLowerCase().split(',').map(value => value.trim()))
  return Object.fromEntries(Object.entries(headers)
    .filter(([name]) => !omittedHeaders.has(name) && !excluded.has(name)))
}

function backendUnavailable(response) {
  if (response.headersSent) {
    response.destroy()
    return
  }
  response.writeHead(502, {'Content-Type': 'application/json; charset=utf-8'})
  response.end(JSON.stringify({code: 'BACKEND_UNAVAILABLE', message: 'Бэкенд недоступен'}))
}

const server = createServer((incoming, outgoing) => {
  const path = incoming.url ?? '/'
  if (!/^\/(?:api(?:\/|\?|$)|health(?:\?|$))/.test(path)) {
    void serve(incoming, outgoing, {public: 'dist', rewrites: [{source: '**', destination: '/index.html'}]})
    return
  }
  if (!/^\/(?:api\/(?:dashboard(?:\/|\?|$)|me(?:\?|$)|snapshot\/status(?:\?|$))|health(?:\?|$))/.test(path)) {
    outgoing.writeHead(404)
    outgoing.end()
    return
  }

  const upstream = requestBackend(backend, {
    path,
    method: incoming.method,
    headers: forwardedHeaders(incoming.headers),
    timeout: 15_000,
  }, response => {
    outgoing.writeHead(response.statusCode ?? 502, forwardedHeaders(response.headers))
    response.on('error', () => outgoing.destroy())
    response.pipe(outgoing)
  })
  upstream.on('error', () => backendUnavailable(outgoing))
  upstream.on('timeout', () => upstream.destroy(new Error('Backend request timed out')))
  outgoing.on('close', () => {
    if (!outgoing.writableFinished) upstream.destroy()
  })
  incoming.pipe(upstream)
})

server.listen(Number(process.env.PORT || 3000), '0.0.0.0')
process.on('SIGTERM', () => server.close())
