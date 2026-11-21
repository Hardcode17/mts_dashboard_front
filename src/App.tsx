import {OnCallDashboard} from './oncall/OnCallDashboard'

interface AppProps {
  theme: 'light' | 'dark'
  changeTheme: (value: 'light' | 'dark') => void
}

export default function App({theme, changeTheme}: AppProps) {
  return <OnCallDashboard theme={theme} changeTheme={changeTheme} />
}
