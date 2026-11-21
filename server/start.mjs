import {createServer, request as requestHttp} from 'node:http'
import {request as requestHttps} from 'node:https'
import serve from 'serve-handler'

const backend = new URL(process.env.BACKEND_URL ?? '')
if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password ||
    backend.pathname !== '/' || backend.search || backend.hash) {
  throw new Error('BACKEND_URL must be an HTTP(S) origin')
}

const keycloak = process.env.KEYCLOAK_URL ? new URL(process.env.KEYCLOAK_URL) : null
const authority = keycloak ? new URL(process.env.OIDC_AUTHORITY ?? '') : null
const keycloakPrefix = authority?.pathname.match(/^(\/(?:auth|keycloak))\/realms\/dashboard$/)?.[1]
if (authority && (authority.protocol !== 'https:' || authority.username || authority.password ||
    !keycloakPrefix || authority.search || authority.hash)) {
  throw new Error('OIDC_AUTHORITY must be the public HTTPS URL of /auth/realms/dashboard or /keycloak/realms/dashboard')
}

const omittedHeaders = new Set(['connection', 'host', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'])

function forwardedHeaders(headers) {
  const excluded = new Set(String(headers.connection ?? '').toLowerCase().split(',').map(value => value.trim()))
  return Object.fromEntries(Object.entries(headers)
    .filter(([name]) => !omittedHeaders.has(name) && !excluded.has(name)))
}

function upstreamUnavailable(response) {
  if (response.headersSent) {
    response.destroy()
    return
  }
  response.writeHead(502, {'Content-Type': 'application/json; charset=utf-8'})
  response.end(JSON.stringify({code: 'BACKEND_UNAVAILABLE', message: 'Сервис недоступен'}))
}

function proxy(origin, path, incoming, outgoing, headers = forwardedHeaders(incoming.headers)) {
  const request = origin.protocol === 'https:' ? requestHttps : requestHttp
  const upstream = request(origin, {
    path,
    method: incoming.method,
    headers,
    timeout: 15_000,
  }, response => {
    outgoing.writeHead(response.statusCode ?? 502, forwardedHeaders(response.headers))
    response.on('error', () => outgoing.destroy())
    response.pipe(outgoing)
  })
  upstream.on('error', () => upstreamUnavailable(outgoing))
  upstream.on('timeout', () => upstream.destroy(new Error('Upstream request timed out')))
  outgoing.on('close', () => {
    if (!outgoing.writableFinished) upstream.destroy()
  })
  incoming.pipe(upstream)
}

const server = createServer((incoming, outgoing) => {
  const path = incoming.url ?? '/'
  const pathname = path.split('?', 1)[0]
  const keycloakPath = keycloakPrefix && pathname.startsWith(keycloakPrefix + '/')
    ? pathname.slice(keycloakPrefix.length) : ''
  if (keycloak && authority && /^\/(?:realms|resources|admin)(?:\/|$)/.test(keycloakPath)) {
    // Keep the administrative API and the master realm on the Docker network.
    const publicPath = /^\/(?:realms\/dashboard|resources)(?:\/[\w.-]+)*\/?$/
    if (!publicPath.test(keycloakPath) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(keycloakPath)) {
      outgoing.writeHead(404).end()
      return
    }
    const headers = forwardedHeaders(incoming.headers)
    for (const name of Object.keys(headers)) {
      if (name === 'forwarded' || name.startsWith('x-forwarded-')) delete headers[name]
    }
    proxy(keycloak, path.slice(keycloakPrefix.length), incoming, outgoing, {
      ...headers,
      'x-forwarded-host': authority.host,
      'x-forwarded-port': authority.port || '443',
      'x-forwarded-proto': 'https',
    })
    return
  }
  if (!/^\/(?:api(?:\/|\?|$)|health(?:\?|$))/.test(path)) {
    void serve(incoming, outgoing, {public: 'dist', rewrites: [{source: '**', destination: '/index.html'}]})
    return
  }
  if (!/^\/(?:api\/(?:dashboard(?:\/|\?|$)|me(?:\?|$)|incidents\/[^/?]+\/relationships(?:\?|$)|snapshot\/status(?:\?|$))|health(?:\?|$))/.test(path)) {
    outgoing.writeHead(404).end()
    return
  }
  proxy(backend, path, incoming, outgoing)
})

server.listen(Number(process.env.PORT || 3000), '0.0.0.0')
process.on('SIGTERM', () => server.close())
