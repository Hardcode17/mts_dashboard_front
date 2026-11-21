import type {IncomingMessage, ServerResponse} from 'node:http'

export function workspaceAuthSettings() {
  return {
    url: process.env.MCC_KEYCLOAK_URL || 'http://localhost:8084',
    realm: process.env.MCC_KEYCLOAK_REALM || 'dashboard',
    clientId: process.env.MCC_KEYCLOAK_CLIENT_ID || 'dashboard-web',
    profileUrl: process.env.MCC_AUTH_ME_URL || 'http://127.0.0.1:8091/api/me',
  }
}

export type WorkspaceAuth = ReturnType<typeof workspaceAuthSettings>

export async function requireWorkspaceUser(req: IncomingMessage, res: ServerResponse, profileUrl: string) {
  const authorization = req.headers.authorization
  let status = 401
  if (authorization && /^Bearer [^\s,]+$/i.test(authorization)) {
    try {
      // The same Spring resource server validates the signature, issuer, audience and lifetime.
      const reply = await fetch(profileUrl, {
        headers: {Authorization: authorization, Accept: 'application/json'},
        signal: AbortSignal.timeout(4000),
        redirect: 'error',
      })
      if (reply.status === 200) {
        const profile: unknown = await reply.json()
        if (
          profile &&
          typeof profile === 'object' &&
          'subject' in profile &&
          typeof profile.subject === 'string' &&
          profile.subject.length > 0
        )
          return true
        status = 503
      } else {
        status = reply.status === 401 || reply.status === 403 ? reply.status : 503
        await reply.body?.cancel()
      }
    } catch {
      status = 503
    }
  }
  if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="dashboard"')
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'})
  const error =
    status === 401
      ? 'Требуется вход через Keycloak.'
      : status === 403
        ? 'Доступ запрещен.'
        : 'Сервис проверки сессии недоступен.'
  res.end(JSON.stringify({error}))
  return false
}
