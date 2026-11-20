import {useMemo, useSyncExternalStore} from 'react'
import {Button, Card, Flex, Label, Link, Pagination, Progress, Select, Text, TextInput} from '@gravity-ui/uikit'
import {Table, useTable} from '@gravity-ui/table'
import type {ColumnDef} from '@gravity-ui/table/tanstack'
import {snapshotTime, type Incident, type ShiftEvent} from './demoData'
import {EventStream} from './EventStream'
import {ShiftCharts} from './ShiftCharts'
import {remainingMinutes} from './shiftMetrics'
import './Overview.css'

const queues = [
  {key: 'critical', title: 'Критические', description: 'Активные с наивысшим приоритетом', symbol: '!'},
  {key: 'assigned', title: 'На координаторах', description: 'Назначены на группу координаторов', symbol: '↳'},
  {key: 'high', title: 'Высокий приоритет', description: 'Активные с высоким приоритетом', symbol: '↑'},
  {key: 'research', title: 'Исследование ситуации', description: 'Сбой устранён, идёт разбор причин', symbol: '◎'},
] as const

type QueueKey = typeof queues[number]['key']
export type OverviewQueue = QueueKey | 'events' | 'all'
type Props = {incidents: Incident[]; events: ShiftEvent[]; summary: boolean; wall: boolean; activeQueue: OverviewQueue}

function groupIncidents(incidents: Incident[]) {
  const groups: Record<QueueKey, Incident[]> = {critical: [], assigned: [], high: [], research: []}
  for (const item of incidents) {
    const active = !item.research && !item.restoredAt
    if (active && item.priority === 4) groups.critical.push(item)
    if (item.assignedAt && (active || item.research)) groups.assigned.push(item)
    if (active && item.priority === 3) groups.high.push(item)
    if (item.research) groups.research.push(item)
  }
  return groups
}

const format = new Intl.NumberFormat('ru-RU')
const pageSizes = [25, 50, 100]
const sortOptions = [
  {value: 'deadline', content: 'Ближайший срок'},
  {value: 'registered', content: 'Сначала новые'},
]

function minutes(time: string) {
  const [hours, mins] = time.split(':').map(Number)
  return hours * 60 + mins
}

const snapshotMinute = minutes(snapshotTime)

function compareDeadline(a: Incident, b: Incident) {
  return (a.due ?? '24:00').localeCompare(b.due ?? '24:00') || a.id.localeCompare(b.id)
}

function CriticalTile({item}: {item: Incident}) {
  const end = item.due ? minutes(item.due) : null
  const start = minutes(item.registered)
  const remaining = end === null ? null : end - snapshotMinute
  const percent = end === null ? null : Math.max(0, Math.min(100, 100 * (snapshotMinute - start) / Math.max(1, end - start)))
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
          <Label size="s" theme={item.state === 'Назначен' ? 'info' : 'warning'}>{item.state}</Label>
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
  if (item.research || item.restoredAt) return <Text color="secondary">{item.restoredAt ? 'Устранён в ' + item.restoredAt : 'Сбой устранён'}</Text>
  if (!item.due) return <Text color="secondary">Срок не указан</Text>
  const remaining = minutes(item.due) - snapshotMinute
  return <div className="overview-cell">
    <Text variant="subheader-1" color={remaining < 0 ? 'danger' : 'primary'}>{remaining < 0 ? 'Просрочка ' : ''}{Math.abs(remaining)} мин</Text>
    <Text variant="caption-2" color="secondary">до {item.due}</Text>
  </div>
}

const columns: ColumnDef<Incident>[] = [
  {accessorKey: 'id', size: 132, header: 'Номер', cell: ({row}) => <Link className="incident-number" href={'#incident/' + row.original.key}><Text variant="code-inline-1">{row.original.id}</Text></Link>},
  {accessorKey: 'product', size: 345, header: 'Продукт и сбой', cell: ({row}) => <div className="overview-cell"><Text variant="subheader-2">{row.original.product}</Text><Text variant="body-1" className="overview-cell-symptom" title={row.original.title}>{row.original.title}</Text></div>},
  {accessorKey: 'team', size: 166, header: 'Назначенная команда'},
  {accessorKey: 'state', size: 150, header: 'Статус', cell: ({row}) => <Label size="s" theme={row.original.research ? 'utility' : row.original.state === 'В работе' ? 'warning' : row.original.state === 'Назначен' ? 'info' : 'success'}>{row.original.state}</Label>},
  {accessorKey: 'registered', size: 96, header: 'Регистрация'},
  {accessorKey: 'due', size: 110, header: 'Срок решения', cell: ({row}) => <Deadline item={row.original} />},
]

function IncidentTable({rows, label}: {rows: Incident[]; label: string}) {
  const table = useTable({data: rows, columns, getRowId: (item) => item.key})
  return <Table table={table} size="s" stickyHeader verticalAlign="middle" className="overview-data-table" attributes={{'aria-label': label}} />
}

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function queueHref(queue: OverviewQueue, params: URLSearchParams) {
  const query = params.toString()
  return (queue === 'events' ? '#events' : '#queue/' + queue) + (query ? '?' + query : '')
}

export function Overview({incidents, events, wall, summary, activeQueue = 'critical'}: Props) {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash)
  const params = new URLSearchParams(hash.split('?')[1])
  const query = params.get('q') ?? ''
  const sort = params.get('sort') === 'registered' ? 'registered' : 'deadline'
  const sizeParam = Number(params.get('size'))
  const size = pageSizes.includes(sizeParam) ? sizeParam : pageSizes[0]
  const groups = useMemo(() => groupIncidents(incidents), [incidents])
  const groupKey = activeQueue === 'events' ? 'critical' : activeQueue
  const group = groupKey === 'all' ? incidents : groups[groupKey]
  const soonOnly = groupKey === 'critical' && params.get('sla') === 'soon'
  const words = query.trim().toLocaleLowerCase('ru-RU').split(/\s+/).filter(Boolean)
  const results = group.filter((item) => {
    if (soonOnly) {
      const left = remainingMinutes(item.due, snapshotTime)
      if (left === null || left < 0 || left > 30) return false
    }
    if (!words.length) return true
    const text = [item.id, item.product, item.title, item.team].join(' ').toLocaleLowerCase('ru-RU')
    return words.every((word) => text.includes(word))
  }).sort(sort === 'registered' ? (a, b) => b.registered.localeCompare(a.registered) || a.id.localeCompare(b.id) : compareDeadline)
  const lastPage = Math.max(1, Math.ceil(results.length / size))
  const requestedPage = Number(params.get('page'))
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(lastPage, requestedPage)) : 1
  const first = (page - 1) * size
  const pageRows = results.slice(first, first + size)
  const selected = groupKey === 'all' ? {title: 'Все инциденты', symbol: '≡'} : queues.find((queue) => queue.key === groupKey)!
  const navParams = new URLSearchParams(params)
  navParams.delete('page')
  navParams.delete('sla')

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params)
    Object.entries(changes).forEach(([key, value]) => { if (value) next.set(key, value); else next.delete(key) })
    window.history.replaceState(window.history.state, '', queueHref(activeQueue, next))
    window.dispatchEvent(new Event('hashchange'))
  }

  if (wall || summary) {
    const critical = [...groups.critical].sort(compareDeadline).slice(0, 3)
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
          <Text color="secondary">Показано {critical.length} из {format.format(groups.critical.length)}</Text>
        </Flex>
        <div className="overview-critical-grid">{critical.map((item) => <CriticalTile key={item.key} item={item} />)}</div>
      </div>
      {wall && <EventStream incidents={incidents} events={events} expanded={false} />}
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
      <Link view="primary" href={queueHref('events', navParams)} aria-current={activeQueue === 'events' ? 'page' : undefined} className="overview-nav-log">
        <Text variant="subheader-2">Журнал событий</Text><Text aria-hidden="true">→</Text>
      </Link>
    </nav>
    {activeQueue === 'events' ? <section className="overview-log" aria-label="Журнал событий">

      <EventStream incidents={incidents} events={events} expanded />
    </section> : <section aria-label={selected.title} className={'overview-table-panel mcc-glass overview-kind-' + groupKey}>
      <div className="overview-table-toolbar">
        <Flex alignItems="baseline" gap="spacing-2" wrap="wrap">
          <span className="overview-nav-icon" aria-hidden="true">{selected.symbol}</span>
          <Text as="h2" variant="header-2">{selected.title}</Text>
          <Label size="s">{format.format(group.length)}</Label>
          {soonOnly && <Label type="close" theme="warning" closeButtonLabel="Снять фильтр по сроку" onCloseClick={() => update({sla: '', page: ''})}>До 30 минут</Label>}
        </Flex>
        <div className="overview-controls">
          <TextInput size="l" value={query} onUpdate={(q) => update({q, page: ''})} hasClear
            placeholder="Номер, продукт, сбой или команда" controlProps={{'aria-label': groupKey === 'all' ? 'Поиск по всем инцидентам' : 'Поиск в очереди'}} />
          <Select size="l" label="Порядок" value={[sort]} options={sortOptions}
            onUpdate={([value]) => update({sort: value === 'registered' ? value : '', page: ''})} />
        </div>
      </div>
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
        <Text variant="subheader-2">{query ? 'Ничего не найдено' : 'Очередь пуста'}</Text>
        {query && <Button view="outlined" onClick={() => update({q: '', page: ''})}>Сбросить поиск</Button>}
      </div>}
    </section>}
  </div>
}
