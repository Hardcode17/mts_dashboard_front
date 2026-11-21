import {useState} from 'react'
import {ThemeProvider} from '@gravity-ui/uikit'
import App from './App'

export default function DashboardRoot() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('mcc-theme') === 'light' ? 'light' : 'dark' } catch { return 'dark' }
  })
  function changeTheme(value: 'light' | 'dark') {
    setTheme(value)
    try { localStorage.setItem('mcc-theme', value) } catch { /* Storage can be unavailable in local previews. */ }
  }
  return <ThemeProvider theme={theme}><App theme={theme} changeTheme={changeTheme} /></ThemeProvider>
}
