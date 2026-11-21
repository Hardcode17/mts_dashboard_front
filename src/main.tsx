import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {configure} from '@gravity-ui/uikit'
import '@gravity-ui/uikit/styles/styles.css'
import './theme/mts-theme.css'
import './index.css'
import DashboardRoot from './DashboardRoot'

configure({lang: 'ru'})
const cardPath=window.location.pathname.match(/^\/incidents\/([^/]+)\/?$/)
const params=new URLSearchParams(window.location.search)
const source=params.get('source')
if(cardPath&&(source==='case'||source==='volume')){
  localStorage.setItem('mcc-source',source)
  window.history.replaceState(null,'','/#incident/'+cardPath[1])
}
if(!window.location.hash&&params.has('group')){
 const group=params.get('group');params.delete('group')
 const priority=params.get('priority')??''
 if(/^P[1-4]$/i.test(priority))params.set('priority',String(5-Number(priority.slice(1))))
 window.history.replaceState(null,'','/#queue/'+group+'?'+params.toString())
}

createRoot(document.getElementById('root')!).render(<StrictMode><DashboardRoot /></StrictMode>)
