import {useMemo} from 'react'
import {Button, Card, Flex, Label, Link, Pagination, Progress, Select, Text, TextInput, useViewportSize} from '@gravity-ui/uikit'
import {Table, useTable} from '@gravity-ui/table'
import type {ColumnDef} from '@gravity-ui/table/tanstack'
import {type Incident, type ShiftEvent} from './demoData'
import {EventStream, EventJournal} from './EventStream'
import {ShiftCharts} from './ShiftCharts'
import {incidentOrder,registrationTime} from './desk/order'
import {useWorkspace} from './desk/context'
import {QueueFilters} from './desk/QueueFilters'
import {active,onCoordinators,standNow,dueInstant,fullTime} from './desk/types'
import './Overview.css'

const queues = [
  {key: 'critical', title: 'Критические', description: 'Активные с наивысшим приоритетом', symbol: '!'},
  {key: 'assigned', title: 'На координаторах', description: 'Назначены на группу координаторов', symbol: '↳'},
  {key: 'high', title: 'Высокий приоритет', description: 'Активные с высоким приоритетом', symbol: '↑'},
  {key: 'research', title: 'Исследование ситуации', description: 'Сбой устранён, идёт разбор причин', symbol: '◎'},
] as const

type QueueKey = typeof queues[number]['key']
export type OverviewQueue = QueueKey | 'events' | 'all'
type Props = {listingHash:string; incidents: Incident[]; events: ShiftEvent[]; summary: boolean; wall: boolean; activeQueue: OverviewQueue}

function groupIncidents(incidents: Incident[]) {
  const groups: Record<QueueKey, Incident[]> = {critical: [], assigned: [], high: [], research: []}
  for (const item of incidents) {
    const isActive = active(item)
    if (isActive && item.priority === 4) groups.critical.push(item)
    if (onCoordinators(item)) groups.assigned.push(item)
    if (isActive && item.priority === 3) groups.high.push(item)
    if (item.research) groups.research.push(item)
  }
  return groups
}

const format = new Intl.NumberFormat('ru-RU')
const pageSizes = [25, 50, 100]
const sortOptions = [
  {value: 'deadline', content: 'Приоритет и срок'},
  {value: 'registered', content: 'Сначала новые'},
  {value: 'updated', content: 'По обновлению'},
]

function CriticalTile({item}: {item: Incident}) {
  const start=registrationTime(item)
  const {desk,now}=useWorkspace()
  const epoch=dueInstant(item)
  const remaining=epoch===null?null:Math.ceil((epoch-standNow(desk,now))/60000)
  const percent = epoch === null ? null : Math.max(0, Math.min(100,100*(standNow(desk,now)-start)/Math.max(1,epoch-start)))
  return (
    <Card view="outlined" className="overview-critical-tile mcc-glass mcc-tile">
      <Link view="primary" href={'#incident/' + item.key} className="overview-tile-link">
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

const columns: ColumnDef<Incident>[] = [
  {accessorKey: 'id', size: 132, header: 'Номер', cell: ({row}) => <Link className="incident-number" href={'#drawer/' + row.original.key}><Text variant="code-inline-1">{row.original.id}</Text></Link>},
  {accessorKey: 'product', size: 345, header: 'Продукт и сбой', cell: ({row}) => <div className="overview-cell"><Text variant="subheader-2">{row.original.product}</Text><Text variant="body-1" className="overview-cell-symptom" title={row.original.title}>{row.original.title}</Text></div>},
  {accessorKey: 'team', size: 166, header: 'Назначенная команда'},
  {accessorKey: 'state', size: 150, header: 'Статус', cell: ({row}) => <Label size="s" theme={row.original.research ? 'utility' : row.original.state === 'Назначен' ? 'info' : active(row.original) ? 'normal' : 'success'}>{row.original.state}</Label>},
  {accessorKey: 'registered', size: 136, header: 'Регистрация', cell: ({row}) => <div className="overview-cell"><Text>{row.original.registered}</Text>{row.original.updatedAt&&<Text variant="caption-2" color="secondary">Обновлено {fullTime(row.original.updatedAt)}</Text>}</div>},
  {accessorKey: 'due', size: 110, header: 'Срок решения', cell: ({row}) => <Deadline item={row.original} />},
]

function IncidentTable({rows, label}: {rows: Incident[]; label: string}) {
  const {width} = useViewportSize()
  const table = useTable({data: rows, columns, getRowId: (item) => item.key})
  if (width !== undefined && width <= 700) return (
    <ul className="overview-incident-list" aria-label={label}>
      {rows.map(item => <li key={item.key}>
        <Link view="primary" href={'#drawer/' + item.key}>
          <Text variant="caption-2" color="secondary">{item.product} · {item.id}</Text>
          <Text variant="subheader-2">{item.title}</Text>
          <Deadline item={item} />
        </Link>
      </li>)}
    </ul>
  )
  return <Table table={table} size="s" stickyHeader verticalAlign="middle" className="overview-data-table" attributes={{'aria-label': label}} />
}

function queueHref(queue: OverviewQueue, params: URLSearchParams) {
  const query = params.toString()
  return (queue === 'events' ? '#events' : '#queue/' + queue) + (query ? '?' + query : '')
}

export function Overview({listingHash, incidents, events, wall, summary, activeQueue = 'critical'}: Props) {
  const {desk,now}=useWorkspace()
  const reference=standNow(desk,now)
  const hash=listingHash
  const params = new URLSearchParams(hash.split('?')[1])
  const query = params.get('q') ?? ''
  const sort = params.get('sort') || 'deadline'
  const sizeParam = Number(params.get('size'))
  const size = pageSizes.includes(sizeParam) ? sizeParam : pageSizes[0]
  const groups = useMemo(() => groupIncidents(incidents), [incidents])
  const groupKey = activeQueue === 'events' ? 'critical' : activeQueue
  const group = groupKey === 'all' ? incidents : groups[groupKey]
  const soonOnly = groupKey === 'critical' && params.get('sla') === 'soon'
  const clearFilters = Object.fromEntries(['q', 'priority', 'product', 'team', 'state', 'serviceType', 'deadline', 'sla', 'page'].map(key => [key, '']))
  const filtered = Object.keys(clearFilters).some(key => key !== 'page' && Boolean(params.get(key)))
  const words = query.trim().toLocaleLowerCase('ru-RU').split(/\s+/).filter(Boolean)
  const results = wall||summary||activeQueue==='events'?[]:group.filter((item) => {
    if (soonOnly) {
      const at=dueInstant(item);const left=at===null?null:Math.ceil((at-reference)/60000)
      if (left === null || left < 0 || left > 30) return false
    }
    for(const field of ['priority','product','team','state','serviceType'] as const){
      const value=params.get(field);if(value&&String(item[field]??'')!==value)return false
    }
    const deadline=params.get('deadline'),due=dueInstant(item)
    if(deadline==='none'&&due!==null)return false
    if(deadline==='late'&&(!active(item)||due===null||due>=reference))return false
    if(deadline==='near'&&(!active(item)||due===null||due<reference||due-reference>desk.threshold*60000))return false
    if (!words.length) return true
    const text = [item.id, item.product, item.title, item.team].join(' ').toLocaleLowerCase('ru-RU')
    return words.every((word) => text.includes(word))
  }).sort(sort==='updated'?(a,b)=>(b.updatedAt??registrationTime(b))-(a.updatedAt??registrationTime(a))||incidentOrder(a,b):
    sort==='registered'?(a,b)=>registrationTime(b)-registrationTime(a)||a.id.localeCompare(b.id):incidentOrder)
  const lastPage = Math.max(1, Math.ceil(results.length / size))
  const requestedPage = Number(params.get('page'))
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(lastPage, requestedPage)) : 1
  const first = (page - 1) * size
  const pageRows = results.slice(first, first + size)
  const selected = groupKey === 'all' ? {title: 'Все инциденты', symbol: '≡'} : queues.find((queue) => queue.key === groupKey)!
  const navParams = activeQueue === 'events' ? new URLSearchParams() : new URLSearchParams(params)
  navParams.delete('page')
  navParams.delete('sla')

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params)
    Object.entries(changes).forEach(([key, value]) => { if (value) next.set(key, value); else next.delete(key) })
    window.history.replaceState(window.history.state, '', queueHref(activeQueue, next))
    window.dispatchEvent(new Event('hashchange'))
  }

  if (wall || summary) {
    const critical = [...groups.critical].sort(incidentOrder).slice(0, 3)
    return <div className={wall ? 'overview-wall' : 'overview-summary'}>
      <div className="overview-wall-main">
        <div className="overview-wall-stats">
          {queues.map((queue) => <Link key={queue.key} view="primary" href={'#queue/' + queue.key} className={'overview-stat mcc-glass mcc-tile overview-kind-' + queue.key}>
            <Text variant="body-1" className="overview-stat-label">{queue.title}</Text>
            <Text variant="display-2">{format.format(groups[queue.key].length)}</Text>
          </Link>)}
        </div>
        {summary && <ShiftCharts incidents={incidents} critical={groups.critical} />}
        <Flex justifyContent="space-between" alignItems="baseline" wrap="wrap" gap="spacing-2">
          <Text as="h2" variant="header-2">Ближайшие критические сроки</Text>
          <Flex alignItems="center" gap="spacing-3" wrap>
            {summary && desk.mode==='volume' && <Link href="#investigation/incident">Пример разбора агентом</Link>}
            <Text color="secondary">Показано {critical.length} из {format.format(groups.critical.length)}</Text>
          </Flex>
        </Flex>
        <div className="overview-critical-grid">{!critical.length&&<Text color="secondary">Активных критических инцидентов нет.</Text>}{critical.map((item) => <CriticalTile key={item.key} item={item} />)}</div>
      </div>
      <EventStream incidents={incidents} events={events} />
    </div>
  }

  return <div className="overview-work">
    <nav className="overview-nav" aria-label="Очереди смены">
      <Text as="h2" variant="subheader-3">Очереди смены</Text>
      <div className="overview-definitions">
        {queues.map((queue) => <Link
          key={queue.key} view="primary" href={queueHref(queue.key, navParams)}
          aria-current={queue.key === activeQueue ? 'page' : undefined}
          className={'overview-nav-tile overview-kind-' + queue.key}
        >
          <span className="overview-nav-icon" aria-hidden="true">{queue.symbol}</span>
          <Text className="overview-nav-count" variant="header-2">{format.format(groups[queue.key].length)}</Text>
          <Text className="overview-nav-title" variant="subheader-2">{queue.title}</Text>
          <Text className="overview-nav-desc" color="secondary" variant="caption-2">{queue.description}</Text>
        </Link>)}
      </div>
      <Link view="primary" href={queueHref('all', navParams)} aria-current={activeQueue === 'all' ? 'page' : undefined} className="overview-nav-log">
        <Text variant="subheader-2">Все инциденты</Text><Text color="secondary">{format.format(incidents.length)}</Text>
      </Link>
      <Link view="primary" href="#events" aria-current={activeQueue === 'events' ? 'page' : undefined} className="overview-nav-log">
        <Text variant="subheader-2">Журнал событий</Text><Text aria-hidden="true">→</Text>
      </Link>
    </nav>
    {activeQueue === 'events' ? <section className="overview-log" aria-label="Журнал событий">

      <EventJournal incidents={incidents} events={events} params={params} update={update} />
    </section> : <section aria-label={selected.title} className={'overview-table-panel mcc-glass overview-kind-' + groupKey}>
      <div className="overview-table-toolbar">
        <Flex alignItems="baseline" gap="spacing-2" wrap="wrap">
          <span className="overview-nav-icon" aria-hidden="true">{selected.symbol}</span>
          <Text as="h2" variant="header-2">{selected.title}</Text>
          <Label size="s">{filtered ? format.format(results.length) + ' из ' + format.format(group.length) : format.format(group.length)}</Label>
          {soonOnly && <Label type="close" theme="warning" closeButtonLabel="Снять фильтр по сроку" onCloseClick={() => update({sla: '', page: ''})}>До 30 минут</Label>}
        </Flex>
        <div className="overview-controls">
          <TextInput size="l" value={query} onUpdate={(q) => update({q, page: ''})} hasClear
            placeholder="Номер, продукт, сбой или команда" controlProps={{'aria-label': groupKey === 'all' ? 'Поиск по всем инцидентам' : 'Поиск в очереди'}} />
          <Select size="l" label="Порядок" value={[sort]} options={sortOptions}
            onUpdate={([value]) => update({sort: value === 'deadline' ? '' : value, page: ''})} />
        </div>
      </div>
      <QueueFilters incidents={incidents} queue={groupKey} params={params} update={update} reset={() => update(clearFilters)} />
      {pageRows.length ? <>
        <div className="overview-table-scroll" tabIndex={0} role="region" aria-label="Список инцидентов">
          <IncidentTable rows={pageRows} label={selected.title} />
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
    </section>}
  </div>
}
