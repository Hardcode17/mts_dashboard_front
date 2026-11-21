import Keycloak from 'keycloak-js'

const url = import.meta.env?.VITE_KEYCLOAK_URL
const realm = import.meta.env?.VITE_KEYCLOAK_REALM
const clientId = import.meta.env?.VITE_KEYCLOAK_CLIENT_ID
let session: Keycloak | undefined

export async function startApiSession() {
  if (!url && !realm && !clientId) return
  if (!url || !realm || !clientId) throw new Error('Неполная конфигурация входа в дашборд')

  const client = new Keycloak({url, realm, clientId})
  const authenticated = await client.init({
    onLoad: 'login-required',
    pkceMethod: 'S256',
    responseMode: 'query',
    checkLoginIframe: false,
  })
  if (!authenticated) throw new Error('Для доступа к дашборду нужно войти')
  session = client
}

export async function getApiAccessToken() {
  if (!session) return undefined
  await session.updateToken(30)
  return session.token
}
