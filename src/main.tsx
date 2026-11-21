import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {configure} from '@gravity-ui/uikit'
import '@gravity-ui/uikit/styles/styles.css'
import './theme/mts-theme.css'
import './index.css'
import {usesRealBackend} from './shared/api/mode'

configure({lang: 'ru'})
const root = createRoot(document.getElementById('root')!)

async function openWorkspace() {
  if (!usesRealBackend) {
    const {startWorkspaceSession} = await import('./auth/session')
    await startWorkspaceSession(showSignIn)
  }
  const {default: DashboardRoot} = await import('./DashboardRoot')
  const cardPath = window.location.pathname.match(/^\/incidents\/([^/]+)\/?$/)
  const params = new URLSearchParams(window.location.search)
  if (!usesRealBackend && cardPath) {
    const source = params.get('source')
    if (source === 'case' || source === 'volume') localStorage.setItem('mcc-source', source)
    if (source === 'case' || source === 'volume') window.history.replaceState(null, '', '/#incident/' + cardPath[1])
  }
  if (!window.location.hash && params.has('group')) {
    const group = params.get('group')
    params.delete('group')
    const priority = params.get('priority') ?? ''
    if (/^P[1-4]$/i.test(priority)) params.set('priority', String(5 - Number(priority.slice(1))))
    window.history.replaceState(null, '', '/#queue/' + group + '?' + params.toString())
  }
  root.render(
    <StrictMode>
      <DashboardRoot />
    </StrictMode>,
  )
}

function showSignIn() {
  root.render(
    <main className="workspace" role="alert">
      <h1>Вход в рабочее место</h1>
      <p>Не удалось подтвердить сессию Keycloak.</p>
      <a
        href={location.pathname === '/auth/callback' ? '/' : location.href}
        onClick={(event) => {
          if (location.pathname !== '/auth/callback') {
            event.preventDefault()
            location.reload()
          }
        }}
      >
        Повторить вход
      </a>
    </main>,
  )
}

void openWorkspace().catch(showSignIn)
