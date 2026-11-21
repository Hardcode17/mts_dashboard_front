import {useState} from 'react'
import {ThemeProvider} from '@gravity-ui/uikit'
import App from './App'
import {DashboardAuth} from './features/auth/DashboardAuth'
import {usesRealBackend} from './shared/api/mode'

export default function DashboardRoot() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('mcc-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  function changeTheme(value: 'light' | 'dark') {
    setTheme(value)
    try { localStorage.setItem('mcc-theme', value) } catch { /* Storage can be unavailable in local previews. */ }
  }
  const dashboard = <App theme={theme} changeTheme={changeTheme} />
  return <ThemeProvider theme={theme}>
    {usesRealBackend ? <DashboardAuth>{dashboard}</DashboardAuth> : dashboard}
  </ThemeProvider>
}
