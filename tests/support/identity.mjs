// Loopback-only identity fixture for the existing business and browser tests.
import {createServer} from 'node:http'
import {createHash, createHmac, randomBytes, randomUUID} from 'node:crypto'

export async function identityFixture(t) {
  const secret = randomBytes(32)
  const codes = new Map()
  let origin, accessToken
  function jwt(claims) {
    const data = [JSON.stringify({alg: 'HS256', typ: 'JWT'}), JSON.stringify(claims)]
      .map((s) => Buffer.from(s).toString('base64url'))
      .join('.')
    return data + '.' + createHmac('sha256', secret).update(data).digest('base64url')
  }
  function claims() {
    const iat = Math.floor(Date.now() / 1000)
    return {
      iss: origin + '/realms/dashboard',
      sub: 'fixture-coordinator',
      aud: 'dashboard-api',
      iat,
      exp: iat + 3600,
      sid: 'fixture-session',
    }
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin)
    const reply = (status, data) => {
      res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'})
      res.end(JSON.stringify(data))
    }
    if (url.pathname === '/profile') {
      return req.headers.authorization === 'Bearer ' + accessToken
        ? reply(200, {subject: 'fixture-coordinator'})
        : reply(401, {error: 'unauthorized'})
    }
    if (req.headers.origin && /^http:\/\/127\.0\.0\.1:\d+$/.test(req.headers.origin)) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    }
    if (url.pathname === '/realms/dashboard/protocol/openid-connect/auth') {
      const redirect = new URL(url.searchParams.get('redirect_uri'))
      if (
        redirect.protocol !== 'http:' ||
        redirect.hostname !== '127.0.0.1' ||
        redirect.pathname !== '/auth/callback' ||
        url.searchParams.get('client_id') !== 'dashboard-web' ||
        url.searchParams.get('code_challenge_method') !== 'S256'
      )
        return reply(400, {error: 'invalid request'})
      const code = randomUUID()
      codes.set(code, {
        nonce: url.searchParams.get('nonce'),
        challenge: url.searchParams.get('code_challenge'),
        redirect: redirect.href,
      })
      redirect.searchParams.set('state', url.searchParams.get('state'))
      redirect.searchParams.set('code', code)
      res.writeHead(302, {Location: redirect.href})
      res.end()
      return
    }
    if (req.method === 'POST' && url.pathname === '/realms/dashboard/protocol/openid-connect/token') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const params = new URLSearchParams(Buffer.concat(chunks).toString()),
        code = params.get('code')
      const saved = codes.get(code)
      codes.delete(code)
      if (
        !saved ||
        params.get('redirect_uri') !== saved.redirect ||
        createHash('sha256')
          .update(params.get('code_verifier') || '')
          .digest('base64url') !== saved.challenge
      )
        return reply(400, {error: 'invalid_grant'})
      const payload = claims()
      return reply(200, {
        token_type: 'Bearer',
        expires_in: 3600,
        access_token: accessToken,
        refresh_token: jwt(payload),
        id_token: jwt({...payload, aud: 'dashboard-web', nonce: saved.nonce}),
      })
    }
    reply(404, {error: 'not found'})
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = 'http://127.0.0.1:' + server.address().port
  accessToken = jwt(claims())
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return {
    getAccessToken: () => accessToken,
    settings: {url: origin, realm: 'dashboard', clientId: 'dashboard-web', profileUrl: origin + '/profile'},
    request(url, options = {}) {
      const headers = new Headers(options.headers)
      headers.set('Authorization', 'Bearer ' + accessToken)
      return fetch(url, {...options, headers})
    },
  }
}
