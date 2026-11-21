import {lazy, Suspense, useEffect, useMemo, useRef, useState} from 'react'
import {Button, Card, Dialog, Flex, Label, Link, Loader, Text, getConfig} from '@gravity-ui/uikit'
import {correlationIndex,similarIncidents} from './desk/correlation'
import {DeskContext,useWorkspace,RelatedIndex} from './desk/context'
import {useDesk} from './desk/useDesk'
import {workspaceIncidents} from './desk/records'
import {QuickCard} from './desk/QuickCard'
import {ShiftDesk} from './desk/ShiftDesk'
import {OfficialCard,Meeting} from './desk/CardWork'
import {fullTime,moscowTime} from './desk/types'
import './desk/desk.css'
import {Overview} from './Overview'
import {IncidentApiRoute} from './features/incidents/ui/IncidentApiRoute'
import {useApiIncident} from './features/incidents/model/useApiIncident'
import {snapshotStatusMessages} from './features/incidents/ui/snapshotStatusMessages'
import {DashboardAccount} from './features/auth/DashboardAuth'
import {usesRealBackend} from './shared/api/mode'
import mtsSymbol from './assets/mts-symbol.svg'
import './App.css'

const IncidentView = lazy(() => import('./IncidentView').then(module => ({default: module.IncidentView})))

function isCardRoute(hash: string) {
  return /^#(incident|investigation|itsm|meeting|drawer|evidence)\//.test(hash)
}

function validListing(value: unknown): string | undefined {
  return typeof value === 'string' && /^#(?:overview|wall|events|desk\/(?:tasks|source|notifications)|queue\/(?:all|critical|assigned|high|research))(?:\?|$)/.test(value)
    ? value : undefined
}

function useDashboardLocation(mode: string) {
  const storageKey = 'mcc-return-to-' + mode
  const [route, setRoute] = useState(() => {
    const hash = window.location.hash || '#overview'
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const last = navigation?.type === 'reload' ? validListing(sessionStorage.getItem(storageKey)) : undefined
    return {hash, listing: isCardRoute(hash) ? validListing(window.history.state?.mccListing) ?? last ?? '#overview' : hash}
  })
  const initialListing = useRef(route.listing)
  useEffect(() => {
    let listing = initialListing.current
    function update() {
      const hash = window.location.hash || '#overview'
      if (isCardRoute(hash)) {
        listing = validListing(window.history.state?.mccListing) ?? listing
        if (window.history.state?.mccListing !== listing) {
          window.history.replaceState({...window.history.state, mccListing: listing}, '')
        }
      } else {
        listing = hash
        if (validListing(listing)) sessionStorage.setItem(storageKey, listing)
      }
      const next = {hash, listing}
      setRoute(previous => previous.hash === hash && previous.listing === listing ? previous : next)
    }
    window.addEventListener('hashchange', update)
    update()
    return () => window.removeEventListener('hashchange', update)
  }, [storageKey])
  return route
}

type ThemeProps = {theme:'light'|'dark';changeTheme:(value:'light'|'dark')=>void;onOpenMonitor:()=>void}
export default function App(props:ThemeProps){
  const [pathname, setPathname] = useState(() => window.location.pathname)
  useEffect(() => {
    const updatePath = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', updatePath)
    return () => window.removeEventListener('popstate', updatePath)
  }, [])

  const match = pathname.match(/^\/incidents\/([^/]+)\/?$/)
  if (match) {
    return <IncidentApiRoute key={match[1]} number={decodeURIComponent(match[1])} />
  }

  return <DeskApplication {...props} />
}

function DeskApplication(props:ThemeProps){
  const client=useDesk()
  if(!client.desk)return <main className="workspace"><Card className="mcc-glass incident-panel"><Text as="h1" variant="header-2">Рабочее место MCC</Text>
    {client.error?<><Text role="alert">{client.error}</Text><Button onClick={()=>void client.refresh()}>Повторить подключение</Button>
      {client.mode === 'api' && !usesRealBackend && <Button onClick={() => client.source('volume')}>Большая смена</Button>}</>:<div role="status" aria-label="Загрузка смены"><Loader/></div>}</Card></main>
  return <DeskContext.Provider value={{...client,desk:client.desk}}><Workspace key={client.mode} {...props}/></DeskContext.Provider>
}
function Workspace({theme,changeTheme,onOpenMonitor}:ThemeProps){
  const {desk,person,checked,now,error,actionError,clearError,refresh,act,busy,mode}=useWorkspace()
  const [displayed,setDisplayed]=useState<string[]>([])
  const route = useDashboardLocation(desk.mode)
  const {hash, listing} = route
  const [receipt, setReceipt] = useState<{route:typeof route; cards:{key:string; id:string; title:string}[]} | null>(null)
  const receiptVisible = receipt?.route === route
  const [view, key] = hash.slice(1).split('?')[0].split('/')
  const listPath = listing.slice(1).split('?')[0]
  const wall = listPath === 'wall'
  const summary = listPath === 'overview'
  const listTitle = wall ? 'Общий экран смены' : summary ? 'Сводка смены' : listPath === 'events' ? 'Журнал событий' : 'Очереди инцидентов'
  const queue = listPath.split('/')[1]
  const activeQueue = listPath === 'events' ? 'events' :
    queue === 'assigned' || queue === 'high' || queue === 'research' || queue === 'all' ? queue : 'critical'
  const incidents = useMemo(() => workspaceIncidents(desk.records), [desk.records])
  const incidentsByKey = useMemo(() => new Map(incidents.map(incident => [incident.key, incident])), [incidents])
  const index=useMemo(()=>correlationIndex(incidents),[incidents])
  const events=desk.events
  const cardRoute=isCardRoute(hash)
  const selectedSummary=incidentsByKey.get(key) ?? incidents.find(i=>i.id===key)
  const detailId = mode === 'api' && cardRoute
    ? selectedSummary?.id ?? (/^INC[0-9]{6,18}$/i.test(key) ? key.toUpperCase() : undefined)
    : undefined
  const detail = useApiIncident(detailId, desk.version)
  const selected = selectedSummary?.itsmUrl ? selectedSummary
    : (detail.record?.id === detailId ? detail.record : undefined) ?? selectedSummary
  const showDetails=selected&&cardRoute
  const query=new URLSearchParams(hash.split('?')[1])
  const evidenceReport=selected&&view==='evidence'?desk.work[selected.key]?.reports.find(r=>r.id===query.get('run')):undefined
  const evidenceIndex=query.get('source')
  const evidence=evidenceIndex && /^\d+$/.test(evidenceIndex) ? evidenceReport?.analysis?.evidence[Number(evidenceIndex)] : undefined
  const analysisHref = selected && evidenceReport && '#investigation/'+selected.key+'?run='+encodeURIComponent(evidenceReport.id)+'&dataset='+desk.mode
  const isDesk=view==='desk'
  const pending=useMemo(()=>desk.signals.flatMap(signal=>{
    const incident=incidentsByKey.get(signal.key)
    return signal.acknowledged === undefined && incident
      ? [{id:signal.id, incident: {...incident, title: signal.title || incident.title || incident.id}}]
      : []
  }),[desk.signals,incidentsByKey])
  const shown=useMemo(()=>pending.filter(({id})=>displayed.includes(id)),[pending,displayed])
  const matched=useMemo(()=>new Map(shown.flatMap(({incident})=>{
    const match=similarIncidents(index,incident)[0]
    return match?[[incident.key,match.incident.id+' · '+match.reasons[0]] as const]:[]
  })),[shown,index])
  const open=shown.length>0,extra=pending.length-shown.length
  useEffect(()=>{
    if(shown.length||!pending.length)return
    const timer=setTimeout(()=>setDisplayed(pending.slice(0,5).map(s=>s.id)),Math.max(0,desk.quietUntil-Date.now()))
    return()=>clearTimeout(timer)
  },[pending,shown.length,desk.quietUntil])
  const recent=events[0]
  const recentIncident=recent ? incidentsByKey.get(recent.key) : undefined
  const sourceIssue = error || desk.sourceError
  const awaitingPublication = desk.apiBeforeFirstSuccess && !sourceIssue
  const snapshotCopy = snapshotStatusMessages[getConfig().lang === 'ru' ? 'ru' : 'en']
  const actor=desk.people.find(p=>p.id===person)??desk.people[0]
  const myTask=actor&&desk.tasks.find(t=>!t.finished&&t.attempts.at(-1)?.person===actor.id&&!t.attempts.at(-1)?.ended&&!t.attempts.at(-1)?.accepted)
  useEffect(() => {
    if (view !== 'drawer' && view !== 'queue') window.scrollTo(0, 0)
  }, [view, key])
  useEffect(() => {
    document.title = (showDetails ? selected.title || selected.id : isDesk ? 'Моя смена' : listTitle) + ' · MCC'
  }, [view, key, showDetails, selected, isDesk, listTitle])

  async function acknowledge() {
    if (shown.length && await act({type:'ack', ids:shown.map(({id})=>id)})) {
      const cards = [...new Map(shown.map(({incident}) => [incident.key, incident])).values()]
      setReceipt({route, cards:cards.map(({key,id,title}) => ({key,id,title}))})
      setDisplayed([])
    }
  }

  return (
    <RelatedIndex.Provider value={index}>
      <header className="masthead">
        <Flex className="masthead-inner" alignItems="center" justifyContent="space-between" gap="spacing-3">
          <a className="identity" href="#overview"><img src={mtsSymbol} className="mts-mark" alt="МТС"/><Text variant="subheader-2">Центр управления инцидентами</Text></a>
          <nav className="primary-nav" aria-label="Разделы дашборда">
            <Link href="#overview" aria-current={summary && !showDetails ? 'page' : undefined}>Сводка</Link>
            <Link href="#queue/critical" aria-current={listPath.startsWith('queue/') && !showDetails ? 'page' : undefined}>Очереди</Link>
            <Link href={mode === 'api' ? '#desk/source' : '#desk/tasks'} aria-current={isDesk?'page':undefined}
              aria-label={myTask?'Моя смена — одна задача ожидает принятия':undefined}
              title={myTask?'Одна задача ожидает принятия':undefined}>Моя смена{myTask&&<span className="nav-task-count" aria-hidden="true">1</span>}</Link>
            <Link href="#events" aria-current={listPath === 'events' && !showDetails ? 'page' : undefined}>Журнал</Link>
          </nav>
          <Flex alignItems="center" gap="spacing-3" className="snapshot">
            <DashboardAccount />
            <Text className="snapshot-clock" color="secondary" variant="body-1">{moscowTime(now)} МСК</Text>
            <Button className="monitor-entry" view="action" size="m" onClick={onOpenMonitor} title="Полноэкранный монитор для комнаты координаторов">Монитор</Button>
            <button
              type="button"
              className="theme-switch"
              role="switch"
              aria-label="Тёмная тема"
              aria-checked={theme === 'dark'}
              title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              onClick={() => changeTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              <span className="theme-switch-thumb" aria-hidden="true"/>
              <span className="theme-switch-icon theme-switch-sun" aria-hidden="true"/>
              <span className="theme-switch-icon theme-switch-moon" aria-hidden="true"/>
            </button>
          </Flex>
        </Flex>
      </header>
      <main className={'workspace' + (isDesk?' workspace-shift':'') + (wall && !showDetails ? ' wall' : '')}>
        <div className="source-status" aria-label="Состояние данных" role="group">
          <span className="source-indicator" data-stale={Boolean(sourceIssue)} aria-hidden="true" />
          <Text variant="body-1">{mode === 'api' ? 'API рабочего места MCC' : desk.mode==='case'?'Снимок ITSM':'Данные демосмены'}</Text>
          <Text color="secondary" variant="body-1">{checked
            ? <>Последняя проверка <time dateTime={new Date(checked).toISOString()} title={fullTime(checked)+' МСК'}>{moscowTime(checked)} МСК</time></>
            : 'Ожидаем первую проверку'}</Text>
          {awaitingPublication && <Text color="secondary" variant="body-1" role="status">{snapshotCopy.awaitingPublication}</Text>}
          {sourceIssue && <Text color="danger" variant="body-1" role="alert">
            <strong>{desk.apiBeforeFirstSuccess ? snapshotCopy.sourceUnavailable : 'Устаревшие данные'}</strong> · {sourceIssue}
          </Text>}
          {(sourceIssue || awaitingPublication) &&
            <Button size="s" view="outlined" onClick={()=>void refresh()}>Проверить снова</Button>
          }
        </div>
        {actionError&&<div className="desk-alert" role="alert"><Text>{actionError}</Text><Button size="s" onClick={clearError}>Закрыть</Button></div>}

        {pending.length>0 && !open && <div className="pending-signals" role="status">
            <Text variant="subheader-1">Ожидают подтверждения: {pending.length} · {pending.slice(0,3).map(({incident})=>incident.id).join(', ')}</Text>
            <Button size="m" onClick={() => setDisplayed(pending.slice(0,5).map(s=>s.id))}>Посмотреть</Button>
          </div>}
        {receiptVisible && !open && <div className="change-strip signal-receipt" role="status">
          <Text variant="body-1">Просмотр подтверждён</Text>
          {receipt.cards.map(card => {
            const separate = Boolean(showDetails && selected.key !== card.key)
            return <Link key={card.key}
              href={separate ? '/incidents/'+encodeURIComponent(card.id)+'?source='+desk.mode : '#incident/'+card.key}
              target={separate ? '_blank' : undefined} rel={separate ? 'noopener' : undefined}>
              {card.id} · {card.title}{separate ? ' · в новой вкладке' : ''}
            </Link>
          })}
          <Button size="s" view="flat-secondary" onClick={()=>setReceipt(null)}>Скрыть</Button>
        </div>}
        {recent&&!(receiptVisible && ['new','assign'].includes(recent.kind) && receipt.cards.some(card=>card.key===recent.key))&&<div className="change-strip">
          <Label theme={mode === 'api' ? 'normal' : recent.kind==='restore'?'success':'info'}>{mode === 'api' ? 'Последняя активность' : ({new:'Новый критический',assign:'Новое назначение',due:'Срок близко',restore:'Сбой устранён'})[recent.kind]}</Label>
          {recentIncident ? <Link href={'#incident/'+recent.key}>{recentIncident.id} · {recent.change}</Link> : <Text>{recent.key} · {recent.change}</Text>}
        </div>}
        {detailId && detail.error && selected && <Text role="status" color="secondary">
          {detail.record ? 'Не удалось обновить карточку. Показаны последние загруженные данные.' : 'Подробности карточки недоступны. Показаны данные из списка.'}
        </Text>}
        {showDetails&&view==='drawer'&&!open&&<QuickCard item={selected} back={listing}/>}
        {showDetails&&view==='evidence'&&<Card className="mcc-glass incident-panel"><Link href={analysisHref || '#incident/'+selected.key}>{analysisHref?'← К сохранённому разбору':'← К карточке'} {selected.id}</Link><Text as="h1" variant="header-2">{evidence?.source??'Наблюдение недоступно'}</Text>
          {evidence&&evidenceReport&&<><Text>{evidence.finding}</Text><Text variant="code-1" className="report-text">{evidence.record}</Text><Text color="secondary">Сохранено {fullTime(evidenceReport.at)} · запуск №{evidenceReport.id} · мок источника</Text></>}</Card>}
        {isDesk&&<><Text as="h1" variant="display-2">Моя смена</Text><ShiftDesk tab={key} incidents={incidents}/></>}
        {showDetails&&view==='itsm'&&<OfficialCard key={selected.key} item={selected}/>}
        {showDetails&&view==='meeting'&&<><Link href={'#incident/'+selected.key+'?tab=room'}>← Инцидент {selected.id}</Link><Meeting item={selected}/></>}
        {showDetails&&(view==='incident'||view==='investigation')&&<Suspense fallback={<div role="status" aria-label="Загрузка карточки"><Loader /></div>}>
          <IncidentView key={selected.key} incident={selected} incidents={incidents} backHref={listing} investigating={view==='investigation'} tab={new URLSearchParams(hash.split('?')[1]).get('tab')}/>
        </Suspense>}
        {cardRoute&&!selected&&<Card className="incident-panel">
          {detailId && !detail.error ? <div role="status" aria-label="Загрузка карточки"><Loader /></div> : <Text>{detail.error ?? 'Такого INC в выбранном источнике нет.'}</Text>}
          <Link href="#overview">Вернуться к сводке</Link>
        </Card>}
        {(!cardRoute||view==='drawer')&&!isDesk&&<div>
          <div className="overview-heading">
            <div><Text as="h1" variant="display-3">{listTitle}</Text>
              <Text as="p" variant="body-2" color="secondary">Карточек в снимке: {incidents.length.toLocaleString('ru-RU')} · Событий: {events.length.toLocaleString('ru-RU')}</Text>
            </div>
            <Flex gap="spacing-2" wrap="wrap">
              <Button size="l" view="action" href={wall ? '#queue/critical' : '#wall'}>{wall ? 'Вернуться на рабочее место' : 'На общий экран'}</Button>
            </Flex>
          </div>
          <Overview listingHash={listing} incidents={incidents} events={events} wall={wall} summary={summary} activeQueue={activeQueue} />
          <footer className="overview-footer"><Text color="secondary" variant="caption-2">{mode === 'api'
            ? (desk.lastImport ? 'Опубликованный снимок · ' + fullTime(desk.lastImport) + ' МСК' : 'Снимок ещё не опубликован')
            : 'Демонстрационные данные · ' + moscowTime(now) + ' МСК'}</Text>
            <Link href="#desk/source">Настроить источник</Link>
          </footer>
        </div>}
      </main>
      <Dialog open={open} disableEscapeKeyDown disableOutsideClick hasCloseButton={false}
        aria-labelledby="signal-title" modalClassName="signal-modal" className="signal-screen">
        <Dialog.Body>
          <div className="signal-content">{actionError&&<Text role="alert">{actionError}</Text>}
            <Text variant="subheader-1" className="signal-severity">⚠ Наивысший приоритет</Text>
            <Text as="h2" id="signal-title" variant="display-3">{shown.length > 1 ? 'Новые критические инциденты' : 'Новый критический инцидент'}</Text>
            <Text variant="body-2">Нажмите «Увидел», чтобы продолжить работу. Личную задачу координатор принимает в «Моей смене».</Text>
            {shown.map(({id, incident}) => <Card className="signal-item" key={id} view="outlined">
              <Text variant="code-1">{incident.id}</Text><Text as="h3" variant="header-1">{incident.title || incident.product}</Text>
              <dl className="signal-facts">
                <div><dt>Продукт</dt><dd>{incident.product}</dd></div>
                <div><dt>Срок решения</dt><dd>{incident.dueAt!=null ? fullTime(incident.dueAt)+' МСК' : incident.due ? incident.due+' МСК' : 'Не указан'}</dd></div>
                <div><dt>Группа назначения</dt><dd>{incident.team || 'Не указана'}</dd></div>
              </dl>
              {matched.get(incident.key)&&<Text variant="body-1">Похожий случай: {matched.get(incident.key)}. Проверить связь можно в карточке.</Text>}
            </Card>)}
            {extra > 0 && <Text role="status" variant="body-2">Поступило ещё: {extra}. Следующие события останутся неподтверждёнными.</Text>}
            <Flex gap="spacing-3" wrap="wrap">
              <Button view="action" size="xl" disabled={busy} onClick={()=>void acknowledge()}>Увидел{shown.length > 1 ? ' (' + shown.length + ')' : ''}</Button>
            </Flex>
          </div>
        </Dialog.Body>
      </Dialog>
    </RelatedIndex.Provider>
  )
}
