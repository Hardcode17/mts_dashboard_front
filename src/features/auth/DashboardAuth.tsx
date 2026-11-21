import {createContext, useContext, useEffect, useState, type ReactNode} from 'react'
import {Button, Card, Loader, Text, getConfig} from '@gravity-ui/uikit'
import {UserManager, WebStorageStateStore, type User} from 'oidc-client-ts'
import type {DashboardIdentity} from '../../entities/incident/model/dashboard-contract'
import {ApiError} from '../../shared/api/http'
import {incidentsApi, setDashboardAccessToken} from '../incidents/api/client'
import {authMessages} from './messages'

const authority = import.meta.env.VITE_OIDC_AUTHORITY?.trim()
const callbackPath = '/auth/callback'
const manager = authority ? new UserManager({
  authority,
  client_id: 'dashboard-web',
  redirect_uri: window.location.origin + callbackPath,
  post_logout_redirect_uri: window.location.origin + '/',
  response_type: 'code',
  scope: 'openid profile',
  userStore: new WebStorageStateStore({store: window.sessionStorage}),
  automaticSilentRenew: true,
  loadUserInfo: false,
}) : null

type Session = {identity: DashboardIdentity | null; denied?: boolean; failed?: boolean}
const accessContext = createContext<{identity: DashboardIdentity; logout: () => void} | null>(null)
let initialSession: Promise<Session> | undefined

async function startSession(): Promise<Session> {
  if (!manager) return {identity: null}
  let user: User | null
  if (window.location.pathname === callbackPath) {
    user = await manager.signinRedirectCallback()
    const next = typeof user.state === 'string' ? user.state : '/'
    const destination = new URL(next, window.location.origin)
    window.history.replaceState(null, '', destination.origin === window.location.origin ? destination.href : '/')
  } else {
    user = await manager.getUser()
    if (user?.expired && user.refresh_token) user = await manager.signinSilent().catch(() => null)
  }
  if (!user || user.expired) return {identity: null}
  setDashboardAccessToken(user.access_token)
  try {
    return {identity: await incidentsApi.getIdentity(AbortSignal.timeout(5000))}
  } catch (error) {
    setDashboardAccessToken(undefined)
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      await manager.removeUser()
      return {identity: null, denied: error.status === 403}
    }
    throw error
  }
}

export function DashboardAuth({children}: {children: ReactNode}) {
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState(false)
  const copy = authMessages[getConfig().lang === 'ru' ? 'ru' : 'en']

  useEffect(() => {
    if (!manager) return
    const auth = manager
    let mounted = true
    function expire() {
      setDashboardAccessToken(undefined)
      setSession({identity: null})
    }
    const removeLoaded = auth.events.addUserLoaded(user => setDashboardAccessToken(user.access_token))
    const removeExpired = auth.events.addAccessTokenExpired(expire)
    const removeUnloaded = auth.events.addUserUnloaded(expire)
    initialSession ??= startSession().catch(() => {
      if (window.location.pathname === callbackPath) window.history.replaceState(null, '', '/')
      return {identity: null, failed: true}
    })
    void initialSession.then(result => {
      if (mounted) setSession(result)
    })
    return () => {
      mounted = false
      removeLoaded()
      removeExpired()
      removeUnloaded()
    }
  }, [])

  if (session?.identity && manager) {
    return <accessContext.Provider value={{identity: session.identity, logout: () => {
      setError(false)
      void manager.signoutRedirect().catch(() => setError(true))
    }}}>
      {error && <Text role="alert">{copy.failed}</Text>}
      {children}
    </accessContext.Provider>
  }

  return <main className="workspace">
    <Card className="mcc-glass incident-panel">
      <Text as="h1" variant="header-2">{copy.title}</Text>
      {!manager ? <Text role="alert">{copy.missingAuthority}</Text> : !session ? (
        <div role="status" aria-label={copy.loading}><Loader /></div>
      ) : <>
        {(session.failed || session.denied || error) && <Text role="alert">{session.denied ? copy.accessDenied : copy.failed}</Text>}
        <Button view="action" onClick={() => {
          setError(false)
          const {pathname, search, hash} = window.location
          void manager.signinRedirect({state: pathname + search + hash}).catch(() => setError(true))
        }}>{copy.login}</Button>
      </>}
    </Card>
  </main>
}

export function DashboardAccount() {
  const access = useContext(accessContext)
  if (!access) return null
  const copy = authMessages[getConfig().lang === 'ru' ? 'ru' : 'en']
  return <>
    <Text color="secondary">{access.identity.name || access.identity.username || access.identity.subject}</Text>
    <Button size="m" onClick={access.logout}>{copy.logout}</Button>
  </>
}
