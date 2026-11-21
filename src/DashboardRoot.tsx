import {lazy, Suspense, useCallback, useEffect, useState} from 'react'
import {Loader, Text, ThemeProvider} from '@gravity-ui/uikit'
import App from './App'
import {DashboardAuth} from './features/auth/DashboardAuth'
import {usesRealBackend} from './shared/api/mode'
import './monitoring/monitoring.css'

const MonitoringPage = lazy(() =>
  import('./monitoring/MonitoringPage.tsx').then((module) => ({default: module.MonitoringPage})),
)

const MONITOR_RETURN_KEY = 'mcc-monitor-return-to'

function monitorModeEnabled(): boolean {
  return new URLSearchParams(window.location.search).get('mode') === 'monitor'
}

function currentLocation(): string {
  return window.location.pathname + window.location.search + window.location.hash
}

function rememberMonitorReturn(): void {
  try {
    const current = new URL(window.location.href)
    if (current.searchParams.get('mode') === 'monitor') return
    sessionStorage.setItem(MONITOR_RETURN_KEY, currentLocation())
  } catch {
    /* Storage can be unavailable in local previews. */
  }
}

function readMonitorReturn(): string {
  try {
    const saved = sessionStorage.getItem(MONITOR_RETURN_KEY)
    if (saved) {
      const target = new URL(saved, window.location.origin)
      if (
        target.origin === window.location.origin &&
        new URLSearchParams(target.search).get('mode') !== 'monitor'
      ) {
        return target.pathname + target.search + target.hash
      }
    }
  } catch {
    /* Fall back to the current route below. */
  }
  const fallback = new URL(window.location.href)
  fallback.searchParams.delete('mode')
  if (!fallback.hash) fallback.hash = '#overview'
  return fallback.pathname + fallback.search + fallback.hash
}

function monitorFallbackRoute(): void {
  if (!monitorModeEnabled()) return
  try {
    if (sessionStorage.getItem(MONITOR_RETURN_KEY) || !document.referrer) return
    const referrer = new URL(document.referrer)
    if (referrer.origin === window.location.origin && !new URLSearchParams(referrer.search).has('mode')) {
      sessionStorage.setItem(MONITOR_RETURN_KEY, referrer.pathname + referrer.search + referrer.hash)
    }
  } catch {
    /* A missing referrer is a valid direct entry to the monitor. */
  }
}

export default function DashboardRoot() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('mcc-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  const [monitor, setMonitor] = useState(monitorModeEnabled)

  useEffect(() => {
    monitorFallbackRoute()
    const onPopState = () => setMonitor(monitorModeEnabled())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function changeTheme(value: 'light' | 'dark') {
    setTheme(value)
    try { localStorage.setItem('mcc-theme', value) } catch { /* Storage can be unavailable in local previews. */ }
  }

  const openMonitor = useCallback(() => {
    rememberMonitorReturn()
    const url = new URL(window.location.href)
    url.searchParams.set('mode', 'monitor')
    window.history.pushState({...window.history.state, mccMonitor: true}, '', url)
    setMonitor(true)
  }, [])

  const closeMonitor = useCallback(() => {
    const target = readMonitorReturn()
    try { sessionStorage.removeItem(MONITOR_RETURN_KEY) } catch { /* Storage can be unavailable. */ }
    window.history.replaceState({...window.history.state, mccMonitor: false}, '', target)
    setMonitor(false)
  }, [])

  const dashboard = monitor
      ? <Suspense fallback={<main className="monitor monitor-boot" role="status" aria-label="Загрузка монитора">
        <Loader size="l" />
        <Text variant="subheader-2">Открываем режим мониторинга…</Text>
      </main>}>
        <MonitoringPage theme={theme} onExit={closeMonitor} />
      </Suspense>
      : <App theme={theme} changeTheme={changeTheme} onOpenMonitor={openMonitor} />
  return <ThemeProvider theme={theme}>
    {usesRealBackend ? <DashboardAuth>{dashboard}</DashboardAuth> : dashboard}
  </ThemeProvider>
}
