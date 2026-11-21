import {memo, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject} from 'react'
import {Button, Card, Flex, Label, Link, Pagination, Progress, Select, Text, TextInput, useViewportSize} from '@gravity-ui/uikit'
import {Table, useRowVirtualizer, useTable} from '@gravity-ui/table'
import type {ColumnDef} from '@gravity-ui/table/tanstack'
import {type Incident, type ShiftEvent} from './demoData'
import {EventStream, EventJournal} from './EventStream'
import {ShiftCharts} from './ShiftCharts'
import {IncidentFlowCard} from './features/incidents/ui/IncidentFlowCard'
import {incidentOrder,registrationTime} from './desk/order'
import {groupIncidents, recentlyUpdated} from './desk/incidentGroups'
import {useWorkspace} from './desk/context'
import {QueueFilters} from './desk/QueueFilters'
import {active,standNow,dueInstant,fullTime} from './desk/types'
import './Overview.css'

const queues = [
  {key: 'critical', title: 'Критические', description: 'Активные с наивысшим приоритетом', symbol: '!'},
  {key: 'assigned', title: 'На координаторах', description: 'Назначены на группу координаторов', symbol: '↳'},
  {key: 'high', title: 'Высокий приоритет', description: 'Активные с высоким приоритетом', symbol: '↑'},
  {key: 'research', title: 'Исследование ситуации', description: 'Сбой устранён, идёт разбор причин', symbol: '◎'},
] as const

type QueueKey = typeof queues[number]['key']
const allQueues = [...queues, {key: 'all', title: 'Все инциденты', symbol: '≡'}] as const
type IncidentQueue = typeof allQueues[number]['key']
export type OverviewQueue = IncidentQueue | 'events'
type Props = {listingHash:string; incidents: Incident[]; events: ShiftEvent[]; summary: boolean; wall: boolean; activeQueue: OverviewQueue}

const format = new Intl.NumberFormat('ru-RU')
const pageSizes = [25, 50, 100]
const sortOptions = [
  {value: 'deadline', content: 'Приоритет и срок'},
  {value: 'registered', content: 'Сначала новые'},
  {value: 'updated', content: 'По обновлению'},
]

function CriticalTile({item}: {item: Incident}) {
  const start=registrationTime(item)
  const {desk,now,mode}=useWorkspace()
  const epoch=dueInstant(item)
  const remaining=epoch===null?null:Math.ceil((epoch-standNow(desk,now))/60000)
  const percent = epoch === null ? null : Math.max(0, Math.min(100,100*(standNow(desk,now)-start)/Math.max(1,epoch-start)))
  return (
    <Card view="outlined" className="overview-critical-tile mcc-glass mcc-tile">
      <Link
        view="primary"
        href={mode === 'api' ? '/incidents/' + encodeURIComponent(item.id) : '#incident/' + item.key}
        className="overview-tile-link"
      >
        <Flex direction="column" gap="spacing-1">
          <Text variant="body-1" color="secondary">{item.product}</Text>
          <Text variant="subheader-3">{item.title}</Text>
        </Flex>
        <Flex className="overview-product-value" justifyContent="space-between" alignItems="center" gap="spacing-2" wrap>
          <Flex className="overview-deadline" alignItems="baseline" gap="spacing-2">
            <Text variant="display-3">{remaining === null ? '—' : Math.abs(remaining)}</Text>
            <Text variant="body-2">{remaining === null ? 'срок не указан' : remaining < 0 ? 'мин просрочки' : 'мин до срока'}</Text>
          </Flex>
          <Label size="s" theme={item.state === 'Назначен' ? 'info' : 'normal'}>{item.state}</Label>
        </Flex>
        {percent !== null && <Progress size="xs" value={percent} className="overview-progress" />}
        <Flex alignItems="baseline" wrap="wrap" justifyContent="space-between" gap="spacing-2">
          <Text variant="code-inline-1" color="secondary">{item.id}</Text>
          <Text variant="body-1" color="secondary">Срок {item.due ?? '—'}</Text>
        </Flex>
      </Link>
    </Card>
  )
}

function Deadline({item}: {item: Incident}) {
  const {desk,now}=useWorkspace()
  if (!active(item)) return <Text color="secondary">{item.restoredAt ? 'Устранён в ' + item.restoredAt : 'Сбой устранён'}</Text>
  if (!item.due) return <Text color="secondary">Срок не указан</Text>
  const remaining = Math.ceil((dueInstant(item)!-standNow(desk,now))/60000)
  return <div className="overview-cell">
    <Text variant="subheader-1" color={remaining < 0 ? 'danger' : 'primary'}>{remaining < 0 ? 'Просрочка ' : ''}{Math.abs(remaining)} мин</Text>
    <Text variant="caption-2" color="secondary">до {item.dueAt?fullTime(item.dueAt):item.due}</Text>
  </div>
}

function IncidentNumberLink({item}: {item: Incident}) {
  const {mode} = useWorkspace()
  const href =
    mode === 'api'
      ? '/incidents/' + encodeURIComponent(item.id)
      : '#drawer/' + item.key

  return (
    <Link className="incident-number" href={href}>
      <Text variant="code-inline-1">{item.id}</Text>
    </Link>
  )
}

const columns: ColumnDef<Incident>[] = [
  {accessorKey: 'id', size: 132, header: 'Номер', cell: ({row}) => <IncidentNumberLink item={row.original} />},
  {accessorKey: 'product', size: 345, header: 'Продукт и сбой', cell: ({row}) => <div className="overview-cell"><Text variant="subheader-2">{row.original.product}</Text><Text variant="body-1" className="overview-cell-symptom" title={row.original.title}>{row.original.title}</Text></div>},
  {accessorKey: 'team', size: 166, header: 'Назначенная команда'},
  {accessorKey: 'state', size: 150, header: 'Статус', cell: ({row}) => <Label size="s" theme={row.original.research ? 'utility' : row.original.state === 'Назначен' ? 'info' : active(row.original) ? 'normal' : 'success'}>{row.original.state}</Label>},
  {accessorKey: 'registered', size: 136, header: 'Регистрация', cell: ({row}) => <div className="overview-cell"><Text>{row.original.registered}</Text>{row.original.updatedAt&&<Text variant="caption-2" color="secondary">Обновлено {fullTime(row.original.updatedAt)}</Text>}</div>},
  {accessorKey: 'due', size: 110, header: 'Срок решения', cell: ({row}) => <Deadline item={row.original} />},
]

const IncidentTable = memo(function IncidentTable({rows, label, scroll, api}: {
  rows: Incident[]
  label: string
  scroll: RefObject<HTMLDivElement | null>
  api: boolean
}) {
  const {width} = useViewportSize()
  const table = useTable({data: rows, columns, getRowId: (item) => item.key})
  const mobile = width !== undefined && width <= 864
  const virtual = !mobile && rows.length >= 50
  const rowVirtualizer = useRowVirtualizer({
    enabled: virtual,
    count: rows.length,
    estimateSize: () => 64,
    overscan: 5,
    getItemKey: (index) => rows[index].key,
    getScrollElement: () => scroll.current,
  })
  if (mobile) return (
    <ul className="overview-incident-list" aria-label={label}>
      {rows.map(item => <li key={item.key}>
        <Link view="primary" href={api ? '/incidents/' + encodeURIComponent(item.id) : '#drawer/' + item.key}>
          <Text variant="caption-2" color="secondary">{item.product} · {item.id}</Text>
          <Text variant="subheader-2">{item.title}</Text>
          <Deadline item={item} />
        </Link>
      </li>)}
    </ul>
  )
  return <Table table={table} rowVirtualizer={virtual ? rowVirtualizer : undefined} size="s" stickyHeader verticalAlign="middle" className="overview-data-table" attributes={{'aria-label': label}} />
})

function queueHref(queue: OverviewQueue, params: URLSearchParams) {
  const query = params.toString()
  return (queue === 'events' ? '#events' : '#queue/' + queue) + (query ? '?' + query : '')
}

function scrollToQueue(queue: IncidentQueue, animate: boolean) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  document.getElementById('overview-queue-' + queue)?.scrollIntoView({
    behavior: animate && !reduceMotion ? 'smooth' : 'instant',
  })
}

type QueueSectionProps = {
  queue: typeof allQueues[number]
  group: Incident[]
  incidents: Incident[]
  queryString: string
  update: (changes: Record<string, string>) => void
}

function QueueSection({queue, group, incidents, queryString, update}: QueueSectionProps) {
  const {desk, now, mode} = useWorkspace()
  const tableScroll = useRef<HTMLDivElement>(null)
  const params = useMemo(() => new URLSearchParams(queryString), [queryString])
  const reference = standNow(desk, now)
  const groupKey = queue.key
  const sectionId = 'overview-queue-' + groupKey
  const query = params.get('q') ?? ''
  const sort = params.get('sort') || 'updated'
  const sizeParam = Number(params.get('size'))
  const size = pageSizes.includes(sizeParam) ? sizeParam : pageSizes[0]
  const soonOnly = groupKey === 'critical' && params.get('sla') === 'soon'
  const clearFilters = Object.fromEntries(['q', 'priority', 'product', 'team', 'state', 'serviceType', 'deadline', 'sla', 'page'].map(key => [key, '']))
  const filtered = Object.keys(clearFilters).some(key => key !== 'page' && Boolean(params.get(key)))
  const deadline = params.get('deadline')
  const filterTime = soonOnly || deadline === 'late' || deadline === 'near' ? reference : 0
  const threshold = desk.threshold
  const results = useMemo(() => {
    const words = query.trim().toLocaleLowerCase('ru-RU').split(/\s+/).filter(Boolean)
    return group.filter((item) => {
      if (soonOnly) {
        const at=dueInstant(item);const left=at===null?null:Math.ceil((at-filterTime)/60000)
        if (left === null || left < 0 || left > 30) return false
      }
      for(const field of ['priority','product','team','state','serviceType'] as const){
        const value=params.get(field);if(value&&String(item[field]??'')!==value)return false
      }
      const due = dueInstant(item)
      if(deadline==='none'&&due!==null)return false
      if(deadline==='late'&&(!active(item)||due===null||due>=filterTime))return false
      if(deadline==='near'&&(!active(item)||due===null||due<filterTime||due-filterTime>threshold*60000))return false
      if (!words.length) return true
      const text = [item.id, item.product, item.title, item.team].join(' ').toLocaleLowerCase('ru-RU')
      return words.every((word) => text.includes(word))
    }).sort(sort === 'updated' ? recentlyUpdated :
      sort === 'registered' ? (a, b) => registrationTime(b) - registrationTime(a) || a.id.localeCompare(b.id) : incidentOrder)
  }, [deadline, filterTime, group, params, query, soonOnly, sort, threshold])
  const lastPage = Math.max(1, Math.ceil(results.length / size))
  const requestedPage = Number(params.get('page'))
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(lastPage, requestedPage)) : 1
  const first = (page - 1) * size
  const pageRows = useMemo(() => results.slice(first, first + size), [first, results, size])

  useEffect(() => {
    tableScroll.current?.scrollTo({top: 0})
  }, [page, size])

  return <section id={sectionId} aria-labelledby={sectionId + '-title'} className={'overview-table-panel mcc-glass overview-kind-' + groupKey}>
      <div className="overview-table-toolbar">
        <Flex alignItems="baseline" gap="spacing-2" wrap="wrap">
          <span className="overview-nav-icon" aria-hidden="true">{queue.symbol}</span>
          <Text as="h2" id={sectionId + '-title'} variant="header-2">{queue.title}</Text>
          <Label size="s">{filtered ? format.format(results.length) + ' из ' + format.format(group.length) : format.format(group.length)}</Label>
          {soonOnly && <Label type="close" theme="warning" closeButtonLabel="Снять фильтр по сроку" onCloseClick={() => update({sla: '', page: ''})}>До 30 минут</Label>}
        </Flex>
        <div className="overview-controls">
          <div className="mcc-field">
            <label htmlFor={sectionId + '-search'}>Поиск</label>
            <TextInput id={sectionId + '-search'} size="l" value={query} onUpdate={q => update({q, page:''})} hasClear
              placeholder="Номер, продукт, сбой или команда" controlProps={{'aria-label': groupKey === 'all' ? 'Поиск по всем инцидентам' : 'Поиск в очереди'}} />
          </div>
          <div className="mcc-field">
            <label htmlFor={sectionId + '-order'}>Порядок</label>
            <Select id={sectionId + '-order'} width="max" size="l" value={[sort]} options={sortOptions}
              onUpdate={([value]) => update({sort: value === 'updated' ? '' : value, page:''})} />
          </div>
        </div>
      </div>
      <QueueFilters incidents={incidents} queue={groupKey} params={params} update={update} reset={() => update(clearFilters)} />
      {pageRows.length ? <>
        <div className={pageRows.length >= 50 ? 'overview-table-scroll overview-table-scroll-long' : 'overview-table-scroll'}
          ref={tableScroll} tabIndex={0} role="region" aria-label="Список инцидентов">
          <IncidentTable rows={pageRows} label={queue.title} scroll={tableScroll} api={mode === 'api'} />
        </div>
        <div className="overview-table-footer">
          <Text color="secondary">{format.format(first + 1)}–{format.format(first + pageRows.length)} из {format.format(results.length)}</Text>
          <Pagination page={page} pageSize={size} total={results.length} pageSizeOptions={pageSizes} compact
            className="overview-pagination" onUpdate={(nextPage, nextSize) => update({page: nextSize === size ? String(nextPage) : '', size: String(nextSize)})} />
        </div>
      </> : <div className="overview-table-empty">
        <Text variant="subheader-2">{filtered ? 'По заданным условиям инцидентов нет' : 'Очередь пуста'}</Text>
        {filtered && <Button view="outlined" onClick={() => update(clearFilters)}>Сбросить поиск и фильтры</Button>}
      </div>}
    </section>
}

export function Overview({listingHash, incidents, events, wall, summary, activeQueue}: Props) {
  const {desk} = useWorkspace()
  const groups = useMemo(() => groupIncidents(incidents), [incidents])
  const [queueQueries, setQueueQueries] = useState<Partial<Record<IncidentQueue, string>>>({})
  const sidebarDestination = useRef<IncidentQueue | null>(null)
  const search = listingHash.split('?')[1] ?? ''
  const params = new URLSearchParams(search)
  const showQueues = !wall && !summary && activeQueue !== 'events'

  if (showQueues && (queueQueries[activeQueue] ?? '') !== search) {
    setQueueQueries({...queueQueries, [activeQueue]: search})
  }

  useEffect(() => {
    if (showQueues) scrollToQueue(activeQueue, sidebarDestination.current === activeQueue)
    sidebarDestination.current = null
  }, [activeQueue, showQueues])

  const serverCounts = desk.apiCounts
  const groupCount = (queue: QueueKey) => {
    if (!serverCounts) return groups[queue].length
    return serverCounts[queue === 'assigned' ? 'coordinators' : queue]
  }

  function update(queue: OverviewQueue, previous: URLSearchParams, changes: Record<string, string>) {
    const next = new URLSearchParams(previous)
    Object.entries(changes).forEach(([key, value]) => { if (value) next.set(key, value); else next.delete(key) })
    if (queue !== activeQueue) {
      setQueueQueries(queries => ({...queries, [queue]: next.toString()}))
      return
    }
    const href = queueHref(queue, next)
    if (href === listingHash) return
    window.history.replaceState(window.history.state, '', href)
    window.dispatchEvent(new Event('hashchange'))
  }

  function getQueueQuery(queue: IncidentQueue) {
    return queue === activeQueue && showQueues ? search : queueQueries[queue] ?? ''
  }

  function getQueueHref(queue: IncidentQueue) {
    return queueHref(queue, new URLSearchParams(getQueueQuery(queue)))
  }

  function navigateToQueue(event: MouseEvent<HTMLAnchorElement>, queue: IncidentQueue) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (queue === activeQueue) {
      event.preventDefault()
      scrollToQueue(queue, true)
    } else {
      sidebarDestination.current = queue
    }
  }

  if (wall || summary) {
    const critical = [...groups.critical].sort(incidentOrder).slice(0, 3)
    return <div className={wall ? 'overview-wall' : 'overview-summary'}>
      <div className="overview-wall-main">
        {desk.lastImport > 0 && <Text color="secondary" variant="caption-2">
          Последнее обновление снимка: {fullTime(desk.lastImport)} МСК
        </Text>}
        <div className="overview-wall-stats">
          {queues.map((queue) => <Link key={queue.key} view="primary" href={'#queue/' + queue.key} className={'overview-stat mcc-glass mcc-tile overview-kind-' + queue.key}>
            <Text variant="body-1" className="overview-stat-label">{queue.title}</Text>
            <Text variant="display-2">{format.format(groupCount(queue.key))}</Text>
          </Link>)}
        </div>
        <IncidentFlowCard />
        {summary && <ShiftCharts incidents={incidents} critical={groups.critical} />}
        <Flex justifyContent="space-between" alignItems="baseline" wrap="wrap" gap="spacing-2">
          <Text as="h2" variant="header-2">Ближайшие критические сроки</Text>
          <Flex alignItems="center" gap="spacing-3" wrap>
            {summary && desk.mode==='volume' && <Link href="#investigation/incident">Пример разбора агентом</Link>}
          <Text color="secondary">Показано {critical.length} из {format.format(groupCount('critical'))}</Text>
          </Flex>
        </Flex>
        <div className="overview-critical-grid">{!critical.length&&<Text color="secondary">Активных критических инцидентов нет.</Text>}{critical.map((item) => <CriticalTile key={item.key} item={item} />)}</div>
      </div>
      <EventStream incidents={incidents} events={events} />
    </div>
  }

  return <div className="overview-work">
    <nav className={'overview-nav' + (showQueues ? ' overview-nav-sticky' : '')} aria-label="Очереди смены">
      <Text as="h2" variant="subheader-3">Очереди смены</Text>
      <div className="overview-definitions">
        {queues.map(queue => <Link
          key={queue.key} view="primary" href={getQueueHref(queue.key)}
          aria-current={queue.key === activeQueue ? 'location' : undefined}
          onClick={event => navigateToQueue(event, queue.key)}
          className={'overview-nav-tile overview-kind-' + queue.key}
        >
          <span className="overview-nav-icon" aria-hidden="true">{queue.symbol}</span>
          <Text className="overview-nav-count" variant="header-2">{format.format(groupCount(queue.key))}</Text>
          <Text className="overview-nav-title" variant="subheader-2">{queue.title}</Text>
          <Text className="overview-nav-desc" color="secondary" variant="caption-2">{queue.description}</Text>
        </Link>)}
      </div>
      <Link view="primary" href={getQueueHref('all')} aria-current={activeQueue === 'all' ? 'location' : undefined}
        onClick={event => navigateToQueue(event, 'all')} className="overview-nav-log">
        <Text variant="subheader-2">Все инциденты</Text><Text color="secondary">{format.format(incidents.length)}</Text>
      </Link>
      <Link view="primary" href="#events" aria-current={activeQueue === 'events' ? 'page' : undefined} className="overview-nav-log">
        <Text variant="subheader-2">Журнал событий</Text><Text aria-hidden="true">→</Text>
      </Link>
    </nav>
    {activeQueue === 'events' ? <section className="overview-log" aria-label="Журнал событий">
      <EventJournal incidents={incidents} events={events} params={params} update={changes => update('events', params, changes)} />
    </section> : <div className="overview-queues">
      {allQueues.map(queue => {
        const queryString = getQueueQuery(queue.key)
        return <QueueSection key={queue.key} queue={queue} group={queue.key === 'all' ? incidents : groups[queue.key]}
          incidents={incidents} queryString={queryString}
          update={changes => update(queue.key, new URLSearchParams(queryString), changes)} />
      })}
    </div>}
  </div>
}
