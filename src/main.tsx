import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {configure} from '@gravity-ui/uikit'
import '@gravity-ui/uikit/styles/styles.css'
import './theme/mts-theme.css'
import './index.css'
import DashboardRoot from './DashboardRoot'

configure({lang: 'ru'})

createRoot(document.getElementById('root')!).render(<StrictMode><DashboardRoot /></StrictMode>)
