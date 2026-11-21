export function makeReadProxy(backendOrigin) {
  if (!backendOrigin) return undefined

  const upstream = new URL(backendOrigin)
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password
      || upstream.pathname !== '/' || upstream.search || upstream.hash) {
    throw new Error('MCC_BACKEND_ORIGIN must be an HTTP(S) origin without credentials or a path')
  }

  return async (req, res, next) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    const cardPath = pathname.match(/^\/api\/incidents\/([^/]+)$/)
    const protectedRead = cardPath || pathname === '/api/dashboard/monitoring/summary'
      || /^\/api\/incidents\/[^/]+\/relationships$/.test(pathname)
    if (req.method !== 'GET' || !protectedRead) return next()

    const headers = {Accept: 'application/json'}
    if (req.headers.authorization) headers.Authorization = req.headers.authorization

    try {
      const upstreamPath = cardPath ? '/api/dashboard/incidents/' + cardPath[1] : pathname
      const response = await fetch(new URL(upstreamPath, upstream), {
        headers, redirect: 'manual', signal: AbortSignal.timeout(4000),
      })
      if (cardPath && response.ok) {
        const {revision, itsmUrl, itsmDemo, groupMemberships, ...card} = await response.json()
        const detail = {
          revision,
          itsmUrl,
          itsmDemo,
          meetingUrl: null,
          incident: {
            ...card,
            header: card.header || card.id,
            updatedAt: null,
            groups: groupMemberships.map(({group}) => group),
          },
        }
        res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'})
        return res.end(JSON.stringify(detail))
      }

      const bytes = await response.arrayBuffer()
      res.writeHead(response.status, {
        'Content-Type': response.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
        ...(response.headers.has('www-authenticate')
          ? {'WWW-Authenticate': response.headers.get('www-authenticate')} : {}),
      })
      res.end(Buffer.from(bytes))
    } catch {
      res.writeHead(502, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'})
      res.end(JSON.stringify({code: 'BACKEND_UNAVAILABLE', message: 'Бэкенд не ответил'}))
    }
  }
}
