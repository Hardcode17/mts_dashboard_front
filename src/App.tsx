import {lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react'
import {Button, Card, Dialog, Flex, Label, Link, Loader, Text} from '@gravity-ui/uikit'
import {correlationIndex,similarIncidents} from './desk/correlation'
import {DeskContext,useWorkspace,RelatedIndex} from './desk/context'
import {useDesk} from './desk/useDesk'
import {DashboardAccount} from './features/auth/DashboardAuth'
import {usesRealBackend} from './shared/api/mode'
import {IncidentPresetsProvider} from './features/incident-presets/provider'
import {monitorMode, openMonitor, watchMonitorMode} from './monitoring/mode'
import {IncidentGroups} from './control-room/IncidentGroups'
import {QuickCard} from './desk/QuickCard'
import {ShiftDesk, StandSettings} from './desk/ShiftDesk'
import {OfficialCard,Meeting} from './desk/CardWork'
import {fullTime,standNow,moscowTime,type Incident} from './desk/types'
import './desk/desk.css'
import {Overview} from './Overview'
import {QueueCounts} from './QueueActivity'
import {signalBatches, type SignalBatch} from './desk/signalBatches'
import {queueActivity, groupIncidents, queues} from './desk/queueActivity'
import {canonicalQueueRoute, followOverviewAnchor, overviewLink, overviewSection, scrollToOverviewSection, selectedQueue} from './desk/queueNavigation'
import mtsSymbol from './assets/mts-symbol.svg'
import './App.css'
import './control-room/control-room.css'
import './control-room/workspace.css'

const DirectIncident = lazy(() => import('./features/incidents/ui/IncidentApiRoute').then(module => ({default: module.IncidentApiRoute})))
const AgentStandControls = lazy(() => import('./AgentInvestigation').then(m => ({default:m.AgentStandControls})))
const OutageWall = lazy(() => import('./monitoring/OutageWall'))
const IncidentView = lazy(() => import('./IncidentView').then(module => ({default: module.IncidentView})))

function isCardRoute(hash: string) {
  return /^#(incident|investigation|itsm|meeting|drawer|evidence)\//.test(hash)
}

function validListing(value: unknown): string | undefined {
  return typeof value === 'string' && /^#(?:overview|wall|events|attention|stand|desk\/(?:tasks|source|notifications|handover)|queue\/(?:all|critical|assigned|high|research))(?:\?|$)/.test(value)
    ? canonicalQueueRoute(value) : undefined
}

function currentDashboardHash() {
  if (window.location.hash) return window.location.hash
  const incident = window.location.pathname.match(/^\/incidents\/([^/]+)\/?$/)
  return incident ? '#incident/' + incident[1] : '#overview'
}

function useDashboardLocation(mode: string) {
  const storageKey = 'mcc-return-to-' + mode
  const [route, setRoute] = useState(() => {
    const hash = canonicalQueueRoute(currentDashboardHash())
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const reloaded = navigation?.type === 'reload' || window.history.state?.mccAfterReload === true
    const last = reloaded ? validListing(sessionStorage.getItem(storageKey)) : undefined
    return {hash, listing: isCardRoute(hash) ? validListing(window.history.state?.mccListing) ?? last ?? '#overview' : hash}
  })
  const initialListing = useRef(route.listing)
  useEffect(() => {
    let listing = initialListing.current
    function update() {
      const raw = currentDashboardHash()
      const hash = canonicalQueueRoute(raw)
      if (raw !== hash) window.history.replaceState(window.history.state, '', hash)
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

type ThemeProps = {theme:'light'|'dark';changeTheme:(value:'light'|'dark')=>void}
export default function App(props:ThemeProps){
  const client=useDesk()
  const monitor=useSyncExternalStore(watchMonitorMode, monitorMode)
  const records=client.desk?.records
  const incidents = useMemo(() => records ? Object.values(records) : [], [records])
  if(!client.desk)return <div className={'cr cr-'+props.theme+' ops-console'}><main className="cr-work workspace ops-loading"><Card className="mcc-glass incident-panel"><Text as="h1" variant="header-2">Рабочее место MCC</Text>
    {client.error?<><Text role="alert">{client.error}</Text><Button onClick={()=>void client.refresh()}>Повторить подключение</Button></>:<div role="status" aria-label="Загрузка смены"><Loader/></div>}</Card></main></div>
  if (client.desk.apiBeforeFirstSuccess) return <main className="workspace"><Card className="mcc-glass incident-panel">
    <Text as="h1" variant="header-2">Ожидаем первый опубликованный снимок</Text>
    {(client.error || client.desk.sourceError) && <Text role="alert" color="danger">{client.error || client.desk.sourceError}</Text>}
    <Button onClick={() => void client.refresh()}>Проверить снова</Button><DashboardAccount />
  </Card></main>
  return <DeskContext.Provider value={{...client,desk:client.desk}}>
    <IncidentPresetsProvider key={usesRealBackend ? client.person : undefined} enabled={usesRealBackend}>
      {(!monitor || history.state?.mccMonitorFrom) && <div hidden={monitor}>
        <Workspace key={client.mode} {...props} suspended={monitor} incidents={incidents}/>
      </div>}
      {monitor && <Suspense fallback={<div role="status">Загрузка видеостены…</div>}><OutageWall theme={props.theme} incidents={incidents}/></Suspense>}
    </IncidentPresetsProvider>
  </DeskContext.Provider>
}
function Workspace({theme,changeTheme,incidents,suspended}:ThemeProps & {incidents: Incident[]; suspended:boolean}){
  const {desk,person,checked,now,error,actionError,clearError,refresh,act,busy}=useWorkspace()
  const [displayed,setDisplayed]=useState<SignalBatch[]>([])
  const route = useDashboardLocation(desk.mode)
  const {hash, listing} = route
  const [receipt, setReceipt] = useState<{route:typeof route; cards:{key:string; id:string; title:string; group?:boolean}[]} | null>(null)
  const receiptVisible = receipt?.route === route
  const [view, key, standKey] = hash.slice(1).split('?')[0].split('/')
  const listPath = listing.slice(1).split('?')[0]
  const wall = listPath === 'wall'
  const summary = listPath === 'overview'
  const listTitle = wall ? 'Общий экран смены' : summary ? 'Сводка смены' : listPath === 'events' ? 'Журнал смены' : 'Очереди инцидентов'
  const sectionAnchor = overviewSection(hash)
  const queueAnchor = selectedQueue(hash)
  const showQueueShortcuts = view === 'queue' || view === 'wall' || Boolean(queueAnchor)
  const queueMenuHref = overviewLink(listing, 'critical')
  const summaryMenuHref = overviewLink(listing)
  const queue = listPath.split('/')[1]
  const activeQueue = listPath === 'events' ? 'events' :
    queue === 'assigned' || queue === 'high' || queue === 'research' || queue === 'all' ? queue : 'critical'
  const activity = useMemo(() => queueActivity(desk.movements, now), [desk.movements, now])
  const groups = useMemo(() => groupIncidents(incidents), [incidents])
  const criticalCount = desk.apiCounts?.critical ?? groups.critical.length
  const [mobileQueues,setMobileQueues] = useState(false)
  const [detailMenu,setDetailMenu] = useState(false)
  const [navigationHost,setNavigationHost] = useState<HTMLDivElement|null>(null)
  const index=useMemo(()=>correlationIndex(incidents),[incidents])
  const events=desk.events
  const selected=incidents.find(i=>i.key===key||i.id===key)
  const showDetails=selected&&isCardRoute(hash)
  const query=new URLSearchParams(hash.split('?')[1])
  const evidenceReport=selected&&view==='evidence'?desk.work[selected.key]?.reports.find(r=>r.id===query.get('run')):undefined
  const evidenceIndex=query.get('source')
  const evidence=evidenceIndex && /^\d+$/.test(evidenceIndex) ? evidenceReport?.analysis?.evidence[Number(evidenceIndex)] : undefined
  const analysisHref = selected && evidenceReport && '#investigation/'+selected.key+'?run='+encodeURIComponent(evidenceReport.id)+'&dataset='+desk.mode
  const isStand = view === 'stand' || (view === 'desk' && key === 'source')
  const standItem = isStand && standKey ? incidents.find(i => i.key === standKey || i.id === standKey) : undefined
  const standTool = isStand && (key === 'room' || key === 'agent')
  const isDesk=view==='desk' && !isStand
  const attention=view==='attention'
  const byKey=useMemo(()=>new Map(incidents.map(i=>[i.key,i])),[incidents])
  const pending=useMemo(()=>desk.signals.filter(s=>!s.acknowledged && byKey.has(s.key)),[desk.signals,byKey])
  const pendingIds=useMemo(()=>new Set(pending.map(s=>s.id)),[pending])
  const blocks=useMemo(()=>displayed.map(block=>({...block,signals:block.signals.filter(s=>pendingIds.has(s.id))})).filter(block=>block.signals.length),[displayed,pendingIds])
  const visible=blocks.flatMap(block=>block.signals.map(s=>s.id))
  const open=blocks.length>0,extra=pending.length-visible.length
  const matched=useMemo(()=>new Map(blocks.flatMap(block=>{
    const card=!block.group && byKey.get(block.signals[0].key)
    const match=card && similarIncidents(index,card)[0]
    return card&&match?[[card.key,match.incident.id+' · '+match.reasons[0]] as const]:[]
  })),[blocks,byKey,index])
  const nextBatches=useMemo(()=>signalBatches(pending,desk.outageGroups),[pending,desk.outageGroups])
  useEffect(()=>{
    if(suspended || isStand || open || !nextBatches.length) return
    const timer=setTimeout(()=>setDisplayed(nextBatches),Math.max(0,desk.quietUntil-Date.now()))
    return()=>clearTimeout(timer)
  },[nextBatches,open,desk.quietUntil,suspended,isStand])
  const latestEvent = desk.events[0]
  const recent = latestEvent?.at != null && standNow(desk, now) - latestEvent.at < 60000 ? latestEvent : undefined
  const actor=desk.people.find(p=>p.id===person)??desk.people[0]
  const myTask=actor && desk.tasks.find(t=>!t.finished&&t.attempts.at(-1)?.person===actor.id&&!t.attempts.at(-1)?.ended&&!t.attempts.at(-1)?.accepted)
  const [keepSummary,setKeepSummary] = useState(false)
  const readingPosition = useRef<{listing:string; y:number; trigger: HTMLElement} | null>(null)
  useEffect(() => {
    if (view === 'drawer') return
    if (readingPosition.current && window.location.hash === readingPosition.current.listing) {
      const {y, trigger} = readingPosition.current
      window.scrollTo(0, y)
      if (trigger.isConnected) trigger.focus({preventScroll: true})
      readingPosition.current = null
    } else if (sectionAnchor) {
      const frame = requestAnimationFrame(() => scrollToOverviewSection(sectionAnchor))
      return () => cancelAnimationFrame(frame)
    } else {
      window.scrollTo(0, 0)
    }
  }, [view, key, sectionAnchor])
  useEffect(() => {
    if(suspended) return
    document.title = (showDetails ? selected.title : attention ? 'Требуют внимания' : isStand ? 'Управление стендом' : isDesk ? 'Моя смена' : listTitle) + ' · MCC'
  }, [view, key, showDetails, selected, isDesk, isStand, attention, listTitle, suspended])

  async function acknowledge() {
    if (await act({type:'ack', ids:visible})) {
      const cards=blocks.flatMap(block=>{
        if(block.group) return [{key:block.group.id,id:new Set(block.signals.map(s=>s.key)).size+' INC',title:block.group.title,group:true}]
        const inc=byKey.get(block.signals[0].key)
        return inc?[{key:inc.key,id:inc.id,title:inc.title,group:false}]:[]
      })
      setReceipt({route,cards})
      setDisplayed([])
    }
  }

  return (
    <RelatedIndex.Provider value={index}>
      <div className={'cr cr-'+theme+' ops-console'}>
        <header className="cr-top">
          <a className="cr-brand" href="#overview" aria-label="MCC · Сводка смены"><img src={mtsSymbol} alt="МТС"/><strong>MCC</strong></a>
          <span className="cr-brand-sub">Центр управления инцидентами</span>
          <div className="cr-strip" aria-label="Критические и движение за минуту">
            <span>Критические <b>{criticalCount}</b></span>
            <span>За минуту <b>+{activity.critical.entered}</b> / <b>−{activity.critical.exited}</b></span>
          </div>
          <div className="cr-top-status">
            <Button size="s" view="outlined" onClick={()=>openMonitor(desk.mode)} aria-label="Монитор">Монитор</Button>
            <span className="cr-live" data-stale={Boolean(error||desk.sourceError)}><i/>{usesRealBackend ? 'ITSM' : desk.mode==='case'?'Кейс МТС':'Демосмена'}</span>
            <time>{moscowTime(standNow(desk,now))} <small>МСК</small></time>
            <button className="theme-switch" type="button" role="switch" aria-label="Тёмная тема"
              aria-checked={theme === 'dark'} onClick={() => changeTheme(theme === 'dark' ? 'light' : 'dark')}>
              <span className="theme-switch-thumb" aria-hidden="true"/>
              <span className="theme-switch-icon theme-switch-sun" aria-hidden="true"/>
              <span className="theme-switch-icon theme-switch-moon" aria-hidden="true"/>
            </button>
          </div>
        </header>
        <div className="cr-shell">
          <aside className={'cr-nav ops-rail'+(showDetails && view!=='drawer' ? ' ops-detail-rail' : '')}
            data-menu-open={detailMenu} onClickCapture={e => {
              if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && (e.target as Element).closest('a')) {
                readingPosition.current = null
                setDetailMenu(false)
              }
            }}>
            {showDetails && view!=='drawer' && <Button size="s" className="ops-detail-menu" view="flat-secondary"
              aria-expanded={detailMenu} aria-controls="ops-primary-navigation ops-queue-shortcuts ops-source-status"
              onClick={() => setDetailMenu(value=>!value)}>Меню смены {detailMenu?'▴':'▾'}</Button>}
            <nav id="ops-primary-navigation" className="ops-primary" aria-label="Разделы дашборда">
              <Link href={summaryMenuHref} aria-current={view==='overview'&&!queueAnchor?'page':undefined}
                onClick={e=>followOverviewAnchor(e)}><i aria-hidden="true">▦</i>Сводка</Link>
              <Link href={queueMenuHref} aria-current={queueAnchor?'location':view==='queue'?'page':undefined}
                onClick={e=>followOverviewAnchor(e, 'critical')}><i aria-hidden="true">≡</i>Очереди</Link>
              <Link href="#desk/tasks" aria-current={isDesk?'page':undefined} aria-label={myTask?'Моя смена — одна задача ожидает принятия':undefined}><i aria-hidden="true">◷</i>Моя смена{myTask&&<b className="nav-task-count">1</b>}</Link>
            </nav>
            {!showQueueShortcuts && <Button className="ops-mobile-queue-toggle" view="flat-secondary" size="s"
              aria-controls="ops-queue-shortcuts" aria-expanded={mobileQueues} onClick={()=>setMobileQueues(!mobileQueues)}>
              Очереди смены {mobileQueues?'▴':'▾'}
            </Button>}
            <div id="ops-queue-shortcuts" className={'ops-rail-queues'+(showQueueShortcuts||mobileQueues?' on-board':'')} ref={setNavigationHost}>
              {(attention||isDesk||isStand||isCardRoute(hash)&&view!=='drawer')&&<nav aria-label="Очереди смены" className="ops-queue-nav">
                <h2>Очереди смены</h2>{queues.map(q=><a key={q.key} href={overviewLink(listing,q.key)} className={'q-'+q.key}>
                  <i className="cr-dot"/><span>{q.title}</span><b>{desk.apiCounts?.[q.key === 'assigned' ? 'coordinators' : q.key] ?? groups[q.key].length}</b></a>)}
              </nav>}
            </div>
            <div id="ops-source-status" className="cr-nav-bottom source-status" aria-label="Состояние данных" role="group">
              <span className="cr-lab"><i className="source-indicator" data-stale={Boolean(error||desk.sourceError)}/>{desk.mode==='case'?'Снимок ITSM':'Данные демосмены'}</span>
              {usesRealBackend ? <DashboardAccount/> : <Link href="#stand" aria-current={isStand?'page':undefined}>Управление стендом</Link>}
              <span className="cr-muted">Проверено {checked?<time title={fullTime(checked)+' МСК'}>{moscowTime(checked)} МСК</time>:'—'}</span>
            </div>
          </aside>
          <main className={'cr-work workspace'+(isDesk?' workspace-shift':'')+(wall&&!showDetails?' wall':'')}>
          {(error||desk.sourceError)&&<div className="desk-alert"><Text color="danger" role="alert"><strong>{desk.apiBeforeFirstSuccess ? 'Ожидаем первый опубликованный снимок' : 'Устаревшие данные'}</strong> · {error||desk.sourceError}</Text>
            <Button size="s" view="outlined" onClick={()=>void refresh()}>Проверить снова</Button></div>}
        {actionError&&<div className="desk-alert" role="alert"><Text>{actionError}</Text><Button size="s" onClick={clearError}>Закрыть</Button></div>}

        {!isStand && pending.length>0 && !open && <div className="pending-signals" role="status">
            <Text variant="subheader-1">Ожидают подтверждения: {pending.length} · {pending.slice(0,3).map(s=>incidents.find(i=>i.key===s.key)?.id).join(', ')}</Text>
            <Button size="m" onClick={() => setDisplayed(nextBatches)}>Посмотреть</Button>
          </div>}
        {receiptVisible && !open && <div className="change-strip signal-receipt" role="status">
          <Text variant="body-1">Просмотр подтверждён</Text>
          {receipt.cards.map(card => {
            const separate = !card.group && Boolean(showDetails && selected.key !== card.key)
            return <Link key={card.key}
              href={card.group?'#attention?group='+encodeURIComponent(card.key):separate ? '/incidents/'+encodeURIComponent(card.id)+'?source='+desk.mode : '#incident/'+card.key}
              target={separate ? '_blank' : undefined} rel={separate ? 'noopener' : undefined}>
              {card.id} · {card.title}{separate ? ' · в новой вкладке' : ''}
            </Link>
          })}
          <Button size="s" view="flat-secondary" onClick={()=>setReceipt(null)}>Скрыть</Button>
        </div>}
        {!isStand&&recent&&!(receiptVisible && ['new','assign'].includes(recent.kind) && receipt.cards.some(card=>card.key===recent.key))&&<div className="change-strip"><Label theme={recent.kind==='restore'?'success':'info'}>{({new:'Новый критический',assign:'Новое назначение',due:'Срок близко',restore:'Сбой устранён'})[recent.kind]}</Label> <time className="cr-mono">{recent.time}</time><Link href={'#incident/'+recent.key}>{incidents.find(i=>i.key===recent.key)?.id} · {recent.change}</Link></div>}
        {showDetails&&view==='drawer'&&!suspended&&!open&&<QuickCard item={selected} back={listing}/>}
        {showDetails&&view==='evidence'&&<Card className="mcc-glass incident-panel"><Link href={analysisHref || '#incident/'+selected.key}>{analysisHref?'← К сохранённому разбору':'← К карточке'} {selected.id}</Link><Text as="h1" variant="header-2">{evidence?.source??'Наблюдение недоступно'}</Text>
          {evidence&&evidenceReport&&<><Text>{evidence.finding}</Text><Text variant="code-1" className="report-text">{evidence.record}</Text><Text color="secondary">Сохранено {fullTime(standNow(desk,evidenceReport.at))} · запуск №{evidenceReport.id} · {usesRealBackend ? 'источник ' + evidence.source : 'мок источника'}</Text></>}</Card>}
        {attention&&<>{!query.has('group') && <Link href="#overview?section=attention">← К сводке смены</Link>}<Text as="h1" variant="display-2">Требуют внимания</Text><IncidentGroups incidents={incidents}/></>}
        {isDesk&&<><Text as="h1" variant="display-2">Моя смена</Text><ShiftDesk tab={key} incidents={incidents}/></>}
        {usesRealBackend && isStand && <Card className="mcc-glass incident-panel"><Text as="h1" variant="header-2">Источник данных</Text><Text>Инциденты поступают из ITSM через API MCC.</Text><Link href="#overview">Вернуться к сводке</Link></Card>}
        {!usesRealBackend && isStand && <div className="desk-stack">
          <Text as="h1" variant="display-2">Управление стендом</Text>
          {standTool ? (standItem ? (key === 'room' ? <>
            <Link href={'#stand?incident='+encodeURIComponent(standItem.key)}>← К управлению стендом</Link>
            <Meeting key={standItem.key} item={standItem} manage/>
          </> : <Suspense fallback={<Loader/>}><AgentStandControls key={standItem.key} incident={standItem}/></Suspense>) :
            <><Text>Инцидент не найден в этом наборе.</Text><Link href="#stand">Выбрать инцидент</Link></>) :
            <StandSettings incidents={incidents}/>}
        </div>}
        {showDetails&&view==='itsm'&&<OfficialCard key={hash} item={selected} proposedTeam={query.get('team')?.trim() || undefined}/>}
        {showDetails&&view==='meeting'&&<><Link href={'#incident/'+selected.key}>← Инцидент {selected.id}</Link><Meeting item={selected}/></>}
        {showDetails&&(view==='incident'||view==='investigation')&&<Suspense fallback={<div role="status" aria-label="Загрузка карточки"><Loader /></div>}>
          <IncidentView key={selected.key} incident={selected} incidents={incidents} backHref={listing} investigating={view==='investigation'} tab={new URLSearchParams(hash.split('?')[1]).get('tab')}/>
        </Suspense>}
        {isCardRoute(hash) && !selected && (view === 'incident' && (usesRealBackend || location.pathname.startsWith('/incidents/'))
          ? <Suspense fallback={<Loader/>}><DirectIncident key={key} number={decodeURIComponent(key)} /></Suspense>
          : <Card className="incident-panel"><Text>Такого INC в выбранном источнике нет.</Text><Link href="#overview">Вернуться к сводке</Link></Card>)}
        {(!isCardRoute(hash)||view==='drawer'||listPath.startsWith('queue/')||listPath==='events'||wall||(summary&&keepSummary))&&!isStand&&!isDesk&&!attention&&<div
          hidden={isCardRoute(hash)&&view!=='drawer'}
          onClickCapture={e=>{
            const trigger = (e.target as Element).closest<HTMLElement>('a[href^="#drawer/"], a[href^="#incident/"]')
            if (trigger) {
              if(summary) setKeepSummary(true)
              readingPosition.current = {listing, y:window.scrollY, trigger}
            }
          }}>
          {listPath==='events' && !new URLSearchParams(listing.split('?')[1]).has('queue') &&
            <Link href="#overview?section=feed">← К ленте событий</Link>}
          <div className="overview-heading" id={summary?'overview':wall?'wall':undefined}>
            <div><Text as="h1" variant="display-3">{listTitle}</Text>
              <Text as="p" variant="body-2" color="secondary">Известных INC: {incidents.length.toLocaleString('ru-RU')} · Событий: {events.length.toLocaleString('ru-RU')}</Text>
            </div>
          </div>
          <Overview groups={groups} navigationHost={isCardRoute(hash)&&view!=='drawer'?null:navigationHost} activity={activity} listingHash={listing} incidents={incidents} events={events} wall={wall} summary={summary} activeQueue={activeQueue} />
        </div>}
      </main></div></div>
      <Dialog open={open&&!suspended&&!isStand} disableEscapeKeyDown disableOutsideClick hasCloseButton={false}
        aria-labelledby="signal-title" modalClassName="signal-modal" className="signal-screen">
        <Dialog.Body>
          <div className="signal-content">{actionError&&<Text role="alert">{actionError}</Text>}
            <Text variant="subheader-1" className="signal-severity">⚠ Наивысший приоритет</Text>
            <Text as="h2" id="signal-title" variant="display-3">{visible.length > 1 ? 'Новые критические инциденты' : 'Новый критический инцидент'}</Text>
            <div className="signal-queue-activity"><Text variant="subheader-2">Критические сейчас: {criticalCount}</Text><QueueCounts activity={activity.critical}/></div>
            <Text variant="body-2">«Увидел» подтверждает просмотр. В разделе «Требуют внимания» можно взять аварию в работу.</Text>
            {blocks.map(block=>{
              if(block.group) return <Card className="signal-item" key={block.key} view="outlined">
                <Text variant="caption-2">Группа связанных инцидентов</Text>
                <Text as="h3" variant="header-1">{block.group.title}</Text>
                <Text>Критических сигналов: {block.signals.length} · одно подтверждение просмотра</Text>
                <details><summary>Номера INC</summary><p className="signal-members">{[...new Set(block.signals.map(s=>byKey.get(s.key)?.id??s.key))].join(', ')}</p></details>
              </Card>
              const incident=byKey.get(block.signals[0].key)
              if(!incident) return null
              return <Card className="signal-item" key={block.key} view="outlined">
              <Text variant="code-1">{incident.id}</Text><Text as="h3" variant="header-1">{incident.title}</Text>
              <dl className="signal-facts">
                <div><dt>Продукт</dt><dd>{incident.product}</dd></div>
                <div><dt>Срок решения</dt><dd>{incident.dueAt!=null ? fullTime(incident.dueAt)+' МСК' : incident.due ? incident.due+' МСК' : 'Не указан'}</dd></div>
                <div><dt>Группа назначения</dt><dd>{incident.team || 'Не указана'}</dd></div>
              </dl>
              {matched.get(incident.key)&&<Text variant="body-1">Похожий случай: {matched.get(incident.key)}. Проверить связь можно в карточке.</Text>}
            </Card>})}
            {extra > 0 && <Text role="status" variant="body-2">Поступило ещё: {extra}. Следующие события останутся неподтверждёнными.</Text>}
            <Flex gap="spacing-3" wrap="wrap">
              <Button view="action" size="xl" disabled={busy} onClick={()=>void acknowledge()}>Увидел{visible.length > 1 ? ' (' + visible.length + ')' : ''}</Button>
            </Flex>
          </div>
        </Dialog.Body>
      </Dialog>
    </RelatedIndex.Provider>
  )
}
