import {lazy, Suspense, useEffect, useMemo, useReducer, useState} from 'react'
import {Button, Card, Dialog, Flex, Label, Link, Loader, SegmentedRadioGroup, Text} from '@gravity-ui/uikit'
import {additionalIncidents, initialEvents, initialIncidents, snapshotTime} from './demoData'
import type {ShiftEvent} from './demoData'
import {Overview} from './Overview'
import mtsSymbol from './assets/mts-symbol.svg'
import './App.css'

const IncidentView = lazy(() => import('./IncidentView').then(module => ({default: module.IncidentView})))

function isCardRoute(hash: string) {
  return hash.startsWith('#incident/') || hash.startsWith('#investigation/')
}

function useDashboardLocation() {
  const [route, setRoute] = useState(() => {
    const hash = window.location.hash || '#overview'
    return {hash, listing: isCardRoute(hash) ? '#overview' : hash}
  })
  useEffect(() => {
    const update = () => {
      const hash = window.location.hash || '#overview'
      setRoute(previous => previous.hash === hash ? previous : {
        hash,
        listing: isCardRoute(hash) ? previous.listing : hash,
      })
    }
    window.addEventListener('hashchange', update)
    update()
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}

const initialSignals = {received: 0, acknowledged: 0, displayed: 0, quietUntil: 0}
type SignalAction = {type: 'receive' | 'review' | 'acknowledge' | 'reset'; now: number}

function signalsReducer(state: typeof initialSignals, action: SignalAction) {
  switch (action.type) {
    case 'receive': {
      if (state.received >= additionalIncidents.length) return state
      const received = state.received + 1
      const open = state.displayed > state.acknowledged
      return {...state, received, displayed: !open && action.now >= state.quietUntil ? received : state.displayed}
    }
    case 'review':
      return {...state, displayed: state.received}
    case 'acknowledge':
      return {...state, acknowledged: state.displayed, quietUntil: action.now + 30_000}
    case 'reset':
      return initialSignals
  }
}

export default function App({theme, changeTheme}: {
  theme: 'light' | 'dark'
  changeTheme: (value: 'light' | 'dark') => void
}) {
  const [signals, dispatch] = useReducer(signalsReducer, initialSignals)
  const {hash, listing} = useDashboardLocation()
  const [view, key] = hash.slice(1).split('?')[0].split('/')
  const listPath = listing.slice(1).split('?')[0]
  const wall = listPath === 'wall'
  const summary = listPath === 'overview'
  const listTitle = wall ? 'Общий экран смены' : summary ? 'Сводка смены' : listPath === 'events' ? 'Журнал событий' : 'Очереди инцидентов'
  const queue = listPath.split('/')[1]
  const activeQueue = listPath === 'events' ? 'events' :
    queue === 'assigned' || queue === 'high' || queue === 'research' || queue === 'all' ? queue : 'critical'
  const {incidents, events} = useMemo(() => {
    const added = additionalIncidents.slice(0, signals.received)
    const recent: ShiftEvent[] = added.slice().reverse().map(incident => ({
      id: 'new-' + incident.key, time: snapshotTime, key: incident.key, kind: 'new', change: incident.title,
    }))
    return {incidents: [...initialIncidents, ...added], events: [...recent, ...initialEvents]}
  }, [signals.received])
  const selected = incidents.find(incident => incident.key === key)
  const showDetails = selected && (view === 'incident' || view === 'investigation')
  const open = signals.displayed > signals.acknowledged
  const pending = signals.received - signals.acknowledged
  const shown = additionalIncidents.slice(signals.acknowledged, signals.displayed)
  const extra = signals.received - signals.displayed
  const canReceive = signals.received < additionalIncidents.length
  const send = (type: SignalAction['type']) => dispatch({type, now: Date.now()})

  useEffect(() => {
    if (open || !pending) return
    const timer = window.setTimeout(() => dispatch({type: 'review', now: Date.now()}),
      Math.max(0, signals.quietUntil - Date.now()))
    return () => window.clearTimeout(timer)
  }, [signals.quietUntil, pending, open])

  useEffect(() => {
    window.scrollTo(0, 0)
    document.title = (showDetails ? selected.title : listTitle) + ' · MCC'
  }, [view, key, showDetails, selected, listTitle])

  return (
    <>
      <header className="masthead">
        <Flex className="masthead-inner" alignItems="center" justifyContent="space-between" gap="spacing-3">
          <a className="identity" href="#overview"><img src={mtsSymbol} className="mts-mark" alt="МТС"/><Text variant="subheader-2">Центр управления инцидентами</Text></a>
          <nav className="primary-nav" aria-label="Разделы дашборда">
            <Link href="#overview" aria-current={summary && !showDetails ? 'page' : undefined}>Сводка</Link>
            <Link href="#queue/critical" aria-current={listPath.startsWith('queue/') && !showDetails ? 'page' : undefined}>Очереди</Link>
            <Link href="#events" aria-current={listPath === 'events' && !showDetails ? 'page' : undefined}>Журнал</Link>
          </nav>
          <Flex alignItems="center" gap="spacing-3" className="snapshot">
            <Label className="snapshot-source" theme="info" size="s">Данные стенда</Label>
            <Text className="snapshot-clock" color="secondary" variant="body-1">21 ноября · {snapshotTime} МСК</Text>
            <SegmentedRadioGroup<'light' | 'dark'> aria-label="Тема оформления" value={theme} onUpdate={changeTheme} size="m">
              <SegmentedRadioGroup.Option value="light">Светлая</SegmentedRadioGroup.Option>
              <SegmentedRadioGroup.Option value="dark">Тёмная</SegmentedRadioGroup.Option>
            </SegmentedRadioGroup>
          </Flex>
        </Flex>
      </header>
      <main className={'workspace' + (wall && !showDetails ? ' wall' : '')}>
        {showDetails && <Suspense fallback={<div role="status" aria-label="Загрузка карточки"><Loader /></div>}>
          <IncidentView key={selected.key} incident={selected} backHref={listing} investigating={view === 'investigation' && key === 'incident'} />
        </Suspense>}
        <div hidden={Boolean(showDetails)}>
          <div className="overview-heading">
            <div><Text as="h1" variant="display-3">{listTitle}</Text>
              <Text as="p" variant="body-2" color="secondary">Карточек в снимке: {incidents.length.toLocaleString('ru-RU')} · Событий: {events.length.toLocaleString('ru-RU')}</Text>
            </div>
            <Flex gap="spacing-2" wrap="wrap">
              <Button size="l" view="outlined" disabled={!canReceive} onClick={() => send('receive')}>Демо: новый крит</Button>
              <Button size="l" view="action" href={wall ? '#queue/critical' : '#wall'}>{wall ? 'Вернуться на рабочее место' : 'На общий экран'}</Button>
            </Flex>
          </div>
          {!!pending && !open && <div className="pending-signals" role="status">
            <Text variant="subheader-1">Ожидают подтверждения: {pending}</Text>
            <Button size="m" onClick={() => send('review')}>Посмотреть</Button>
          </div>}
          <Overview incidents={incidents} events={events} wall={wall} summary={summary} activeQueue={activeQueue} />
          <footer className="overview-footer"><Text color="secondary" variant="caption-2">Демонстрационные данные · {snapshotTime} МСК</Text>
            <Button view="flat-secondary" onClick={() => send('reset')}>Сбросить сценарий</Button>
          </footer>
        </div>
      </main>
      <Dialog open={open} disableEscapeKeyDown disableOutsideClick hasCloseButton={false}
        aria-labelledby="signal-title" modalClassName="signal-modal" className="signal-screen">
        <Dialog.Body>
          <div className="signal-content">
            <Text variant="subheader-1" className="signal-severity">⚠ Наивысший приоритет</Text>
            <Text as="h2" id="signal-title" variant="display-3">{shown.length > 1 ? 'Новые критические инциденты' : 'Новый критический инцидент'}</Text>
            <Text variant="body-2">Подтвердите просмотр, чтобы вернуться к обзору смены.</Text>
            {shown.map(incident => <Card className="signal-item" key={incident.key} view="outlined">
              <Text variant="code-1">{incident.id}</Text><Text as="h3" variant="header-1">{incident.title}</Text>
              <Text variant="body-2">{incident.product} · {incident.team} · Срок {incident.due} МСК</Text>
            </Card>)}
            {extra > 0 && <Text role="status" variant="body-2">Поступило ещё: {extra}. Следующие события останутся неподтверждёнными.</Text>}
            <Flex gap="spacing-3" wrap="wrap">
              <Button view="action" size="xl" onClick={() => {send('acknowledge'); window.location.hash = listing}}>Увидел{shown.length > 1 ? ' (' + shown.length + ')' : ''}</Button>
              <Button view="contrast-light" size="xl" disabled={!canReceive} onClick={() => send('receive')}>Демо: ещё один крит</Button>
            </Flex>
          </div>
        </Dialog.Body>
      </Dialog>
    </>
  )
}
