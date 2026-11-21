import assert from 'node:assert/strict'

/** Log in with a dedicated test user only at the configured identity provider. */
export async function enterWorkspace(page, href, {username, password, provider} = {}) {
  const origin = new URL(href).origin
  const configResponse = await page.request.get(origin + '/auth/config')
  assert.equal(configResponse.status(), 200)
  const config = await configResponse.json()
  const issuer = new URL(config.url)
  if (provider) assert.equal(issuer.href, new URL(provider).href)
  if (Boolean(username) !== Boolean(password))
    throw Error('Set both MCC_SMOKE_USERNAME and MCC_SMOKE_PASSWORD.')
  if (username && !provider) throw Error('Set MCC_KEYCLOAK_URL to the trusted test identity provider.')
  await page.goto(href)
  const form = page.locator('#username')
  await form.waitFor({state: 'visible'})
  const loginUrl = new URL(page.url())
  assert.equal(loginUrl.origin, issuer.origin)
  assert.equal(
    loginUrl.pathname,
    issuer.pathname.replace(/\/$/, '') + '/realms/' + config.realm + '/protocol/openid-connect/auth',
  )
  assert.equal(loginUrl.searchParams.get('client_id'), config.clientId)
  assert.equal(loginUrl.searchParams.get('code_challenge_method'), 'S256')
  if (!username) return
  await form.fill(username)
  await page.locator('#password').fill(password)
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).origin === origin && new URL(r.url()).pathname === '/api/stand/snapshot' && r.ok(),
    ),
    page.locator('#kc-login').click(),
  ])
  const authorization = await response.request().headerValue('authorization')
  assert(authorization && authorization.startsWith('Bearer '))
  return authorization
}
