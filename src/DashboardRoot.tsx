import {useState} from 'react'
import {ThemeProvider} from '@gravity-ui/uikit'
import App from './App'

export default function DashboardRoot() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('mcc-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  function changeTheme(value: 'light' | 'dark') {
    setTheme(value)
    try { localStorage.setItem('mcc-theme', value) } catch { /* Storage can be unavailable in local previews. */ }
  }
  return <ThemeProvider theme={theme}><App theme={theme} changeTheme={changeTheme} /></ThemeProvider>
}
