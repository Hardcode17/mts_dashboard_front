import Keycloak from 'keycloak-js'
import type {KeycloakConfig} from 'keycloak-js'

const returnKey = 'mcc.login.return'
const callback = '/auth/callback'
let session: Keycloak
let redirecting: Promise<void> | undefined
let showSignIn: () => void

function rememberLocation() {
  if (location.pathname === callback) return
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  sessionStorage.setItem(
    returnKey,
    JSON.stringify({
      reloaded: navigation?.type === 'reload',
      href: location.pathname + location.search + location.hash,
      mccListing: history.state?.mccListing,
      mccMonitorFrom: history.state?.mccMonitorFrom,
    }),
  )
}

function resumeLocation() {
  const saved = sessionStorage.getItem(returnKey)
  sessionStorage.removeItem(returnKey)
  if (location.pathname !== callback) return
  let context: {href?: string; reloaded?: boolean; mccListing?: string; mccMonitorFrom?: string} = {}
  if (saved) {
    try {
      context = JSON.parse(saved) ?? {}
    } catch {
      context = {href: saved}
    }
  }
  const target = new URL(context.href || '/', location.origin)
  const state = {
    mccAfterReload: context.reloaded === true,
    mccListing: context.mccListing,
    mccMonitorFrom: context.mccMonitorFrom,
  }
  history.replaceState(
    state,
    '',
    target.origin === location.origin && target.pathname !== callback ? target : '/',
  )
}

async function signIn(): Promise<never> {
  rememberLocation()
  redirecting ??= session.login().finally(() => {
    redirecting = undefined
  })
  await redirecting
  throw new Error('Для продолжения нужен вход в Keycloak.')
}

export async function startWorkspaceSession(onSessionLost: () => void) {
  showSignIn = onSessionLost
  rememberLocation()
  const response = await fetch('/auth/config', {cache: 'no-store', redirect: 'error'})
  if (!response.ok) throw new Error('Не удалось загрузить параметры входа.')
  const config: KeycloakConfig = await response.json()
  session = new Keycloak(config)
  session.onAuthLogout = () => {
    rememberLocation()
    onSessionLost()
  }
  const signedIn = await session.init({
    onLoad: 'login-required',
    pkceMethod: 'S256',
    responseMode: 'query',
    checkLoginIframe: false,
    redirectUri: location.origin + callback,
  })
  if (!signedIn || !session.token) throw new Error('Для доступа к рабочему месту нужен вход.')
  resumeLocation()
}

export async function workspaceFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = new URL(path, location.origin)
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/'))
    throw new Error('Некорректный адрес API.')
  if (!session) throw new Error('Вход в рабочее место еще не завершен.')
  if (!session.authenticated) return signIn()
  try {
    await session.updateToken(30)
  } catch {
    if (!session.token || session.isTokenExpired(0)) return signIn()
    throw new Error('Не удалось обновить сессию Keycloak.')
  }
  if (!session.token) return signIn()
  const headers = new Headers(options.headers)
  headers.set('Authorization', 'Bearer ' + session.token)
  const response = await fetch(url, {...options, headers, redirect: 'error'})
  if (response.status === 401) showSignIn()
  return response
}
