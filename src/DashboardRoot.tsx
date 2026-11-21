import {lazy, Suspense, useState} from 'react'
import {ThemeProvider} from '@gravity-ui/uikit'
import App from './App'
import {DashboardAuth} from './features/auth/DashboardAuth'
import {usesRealBackend} from './shared/api/mode'

const ControlRoom = lazy(() => import('./prototype/ControlRoom'))

export default function DashboardRoot() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('mcc-theme') === 'light' ? 'light' : 'dark' } catch { return 'dark' }
  })
  function changeTheme(value: 'light' | 'dark') {
    setTheme(value)
    try { localStorage.setItem('mcc-theme', value) } catch { /* Storage can be unavailable in local previews. */ }
  }
  if (!usesRealBackend && /^\/prototype\/cerebro\/?$/.test(window.location.pathname)) {
    return <Suspense fallback={<p role="status">Загрузка пульта смены…</p>}><ControlRoom /></Suspense>
  }
  const workspace = <App theme={theme} changeTheme={changeTheme} />
  return <ThemeProvider theme={theme}>{usesRealBackend ? <DashboardAuth>{workspace}</DashboardAuth> : workspace}</ThemeProvider>
}
