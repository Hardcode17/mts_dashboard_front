import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {configure} from '@gravity-ui/uikit'
import '@gravity-ui/uikit/styles/styles.css'
import './theme/mts-theme.css'
import './index.css'
import DashboardRoot from './DashboardRoot'
import {startApiSession} from './shared/api/session'

configure({lang: 'ru'})
const root = createRoot(document.getElementById('root')!)

async function start() {
  await startApiSession()
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
  root.render(<StrictMode><DashboardRoot /></StrictMode>)
}

void start().catch(() => {
  root.render(<main className="workspace" role="alert">
    <p>Не удалось подключиться к сервису входа.</p>
    <button type="button" onClick={() => window.location.reload()}>Повторить</button>
  </main>)
})
