import {createContext, memo, useContext, useEffect, useMemo, useRef, useState} from 'react'
import {Button, Card, Flex, getConfig, Label, Link, Pagination, Progress, Select, Text, TextInput, useViewportSize} from '@gravity-ui/uikit'
import {Table, useRowVirtualizer, useTable} from '@gravity-ui/table'
import type {ColumnDef} from '@gravity-ui/table/tanstack'
import type {Incident, ShiftEvent} from './desk/types'
import {EventJournal} from './EventStream'
import {createPortal} from 'react-dom'
import {LiveOverview} from './control-room/LiveOverview'
import {queueOwnerLabels} from './control-room/attention'
import {incidentOrder,registrationTime} from './desk/order'
import {useWorkspace} from './desk/context'
import {QueueFilters} from './desk/QueueFilters'
import {active,standNow,dueInstant,fullTime, itsmStateLabels, type QueueKey} from './desk/types'
import type {IncidentDto} from './entities/incident/model/api-types'
import {queueFilterKey} from './features/incidents/model/queueFilters'
import {toIncident} from './features/incidents/model/toDesk'
import {useIncidentQueue} from './features/incidents/model/useIncidentQueue'
import {queueMessages} from './features/incidents/ui/queueMessages'
import {usesRealBackend} from './shared/api/mode'
import './Overview.css'

import {LatestActivity, MovementJournal, QueueCounts} from './QueueActivity'
import {queues, type Activity} from './desk/queueActivity'
import {boardLink, scopeQueueParams, followOverviewAnchor, overviewSection, selectedQueue} from './desk/queueNavigation'

export type OverviewQueue = QueueKey | 'events' | 'all'
type Props = {groups:Record<QueueKey,Incident[]>; navigationHost: HTMLElement | null; activity: Record<QueueKey,Activity>; listingHash:string; incidents: Incident[]; events: ShiftEvent[]; summary: boolean; wall: boolean; activeQueue: OverviewQueue}

const format = new Intl.NumberFormat('ru-RU')
const pageSizes = [5, 25, 50, 100]
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

const QueueOwners = createContext(new Map<string, string>())
function QueueOwner({item}: {item: Incident}) {
  const labels = useContext(QueueOwners)
  return <div className="overview-cell">
    <Text>{labels.get(item.key) ?? 'Активной задачи нет'}</Text>
    {item.team && <Text variant="caption-2" color="secondary">ITSM · {item.team}</Text>}
  </div>
}

const columns: ColumnDef<Incident>[] = [
  {accessorKey: 'id', size: 132, header: 'Номер', cell: ({row}) => <Link className="incident-number" href={'#drawer/' + row.original.key}><Text variant="code-inline-1">{row.original.id}</Text></Link>},
  {accessorKey: 'product', size: 345, header: 'Продукт и сбой', cell: ({row}) => <div className="overview-cell"><Text variant="subheader-2">{row.original.product}</Text><Text variant="body-1" className="overview-cell-symptom" title={row.original.title}>{row.original.title}</Text></div>},
  {accessorKey: 'team', size: 194, header: 'Кто ведёт', cell: ({row}) => <QueueOwner item={row.original}/>},
  {accessorKey: 'state', size: 150, header: 'Статус ITSM', cell: ({row}) => <Label size="s" theme={row.original.research ? 'utility' : row.original.state === 'Назначен' ? 'info' : active(row.original) ? 'normal' : 'success'}>{row.original.state}</Label>},
  {accessorKey: 'registered', size: 136, header: 'Регистрация', cell: ({row}) => <div className="overview-cell"><Text>{row.original.registered}</Text>{row.original.updatedAt&&<Text variant="caption-2" color="secondary">Обновлено {fullTime(row.original.updatedAt)}</Text>}</div>},
  {accessorKey: 'due', size: 110, header: 'Срок решения', cell: ({row}) => <Deadline item={row.original} />},
]

const IncidentTable = memo(function IncidentTable({rows, label, scroll}: {rows: Incident[]; label: string; scroll: HTMLDivElement | null}) {
  const {width} = useViewportSize()
  const table = useTable({data: rows, columns, getRowId: (item) => item.key})
  const mobile = width !== undefined && width <= 864
  const virtual = !mobile && rows.length >= 50
  const rowVirtualizer = useRowVirtualizer({
    enabled: virtual,
    count: rows.length,
    estimateSize: () => 64,
    overscan: 5,
    getItemKey: index => rows[index].key,
    getScrollElement: () => scroll,
  })
  if (mobile) return (
    <ul className="overview-incident-list" aria-label={label}>
      {rows.map(item => <li key={item.key}>
        <Link view="primary" href={'#drawer/' + item.key}>
          <Text variant="caption-2" color="secondary">{item.product} · {item.id}</Text>
          <Text variant="subheader-2">{item.title}</Text>
          <Deadline item={item} />
          <QueueOwner item={item}/>
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

type TableGroup = QueueKey | 'all'
type UpdateParams = (changes: Record<string,string>) => void

function timeUntilDeadline(item: Incident, now: number) {
  const deadline = dueInstant(item)
  return deadline === null ? null : Math.ceil((deadline - now) / 60000)
}

function queueIncident(item: IncidentDto, known: Map<string, Incident>): Incident {
  const summary = toIncident(item)
  const previous = known.get(item.id)
  return {
    ...previous,
    ...summary,
    title: previous?.title || item.header || item.id,
    service: previous?.service ?? summary.service,
    serviceType: previous?.serviceType ?? summary.serviceType,
    assignee: previous?.assignee ?? summary.assignee,
    assigneeLogin: previous?.assigneeLogin ?? summary.assigneeLogin,
    updatedAt: previous?.updatedAt ?? summary.updatedAt,
    solution: previous?.solution ?? summary.solution,
    description: previous?.description ?? summary.description,
    state: itsmStateLabels[item.stateEnum],
  }
}

function QueuePanel({groupKey, liveGroup, incidents, byKey, params, update, activity, live}: {
  groupKey: TableGroup; liveGroup: Incident[]; incidents: Incident[]; byKey: Map<string, Incident>;
  params: URLSearchParams; update: UpdateParams; activity?: Activity; live: boolean;
}) {
  const {desk, now} = useWorkspace()
  // The virtualizer needs a render after the scroll container is attached.
  const [scroll, setScroll] = useState<HTMLDivElement | null>(null)
  const reference = standNow(desk, now)
  const [snapshot, setSnapshot] = useState(liveGroup)
  const group = live ? liveGroup : snapshot
  const pending = useMemo(() => {
    if (live || snapshot === liveGroup) return null
    const pinned = new Map(snapshot.map(item => [item.key, item.updatedAt]))
    const added = liveGroup.filter(item => !pinned.has(item.key)).length
    if (added || snapshot.length !== liveGroup.length || liveGroup.some(item => item.updatedAt !== pinned.get(item.key))) return {added}
    return null
  }, [live, snapshot, liveGroup])
  const query = params.get('q') ?? ''
  const sort = params.get('sort') || 'deadline'
  const sizeParam = Number(params.get('size'))
  const size = pageSizes.includes(sizeParam) ? sizeParam : groupKey === 'all' ? 25 : 5
  const soonOnly = groupKey === 'critical' && params.get('sla') === 'soon'
  const clearFilters = Object.fromEntries(['q', 'priority', 'product', 'team', 'state', 'serviceType', 'deadline', 'sla', 'page'].map(key => [key, '']))
  const filtered = Object.keys(clearFilters).some(key => key !== 'page' && Boolean(params.get(key)))
  const encoded = params.toString()
  const clock = soonOnly || ['near', 'late'].includes(params.get('deadline') ?? '') ? Math.floor(reference / 1000) * 1000 : 0
  const filterKey = usesRealBackend ? queueFilterKey(params) : ''
  const clockBucket = ['near', 'late'].includes(params.get('deadline') ?? '') ? Math.floor(reference / 15000) : 0
  const server = useIncidentQueue(filterKey, groupKey, live ? desk.lastImport : 0, clockBucket)
  const awaitingServer = Boolean(filterKey && !server.items)
  const copy = queueMessages[getConfig().lang === 'ru' ? 'ru' : 'en']
  const results = useMemo(() => {
    if (filterKey) {
      const entries = server.items?.map(item => queueIncident(item, byKey)) ?? []
      if (!soonOnly) return entries
      return entries.filter(item => {
        const left = timeUntilDeadline(item, clock)
        return left !== null && left >= 0 && left <= 30
      })
    }
    const filters = new URLSearchParams(encoded)
    const words = query.trim().toLocaleLowerCase('ru-RU').split(/\s+/).filter(Boolean)
    return group.filter((item) => {
      if (soonOnly) {
        const left = timeUntilDeadline(item, clock)
        if (left === null || left < 0 || left > 30) return false
      }
      for(const field of ['priority','product','team','state','serviceType'] as const){
        const value=filters.get(field);if(value&&String(item[field]??'')!==value)return false
      }
      const deadline=filters.get('deadline'),due=dueInstant(item)
      if(deadline==='none'&&due!==null)return false
      if(deadline==='late'&&(!active(item)||due===null||due>=clock))return false
      if(deadline==='near'&&(!active(item)||due===null||due<clock||due-clock>desk.threshold*60000))return false
      if (!words.length) return true
      const text = [item.id, item.product, item.title, item.team].join(' ').toLocaleLowerCase('ru-RU')
      return words.every((word) => text.includes(word))
    }).sort(sort==='updated'?(a,b)=>(b.updatedAt??registrationTime(b))-(a.updatedAt??registrationTime(a))||incidentOrder(a,b):
      sort==='registered'?(a,b)=>registrationTime(b)-registrationTime(a)||a.id.localeCompare(b.id):incidentOrder)
  }, [filterKey, server.items, byKey, group, query, sort, encoded, soonOnly, clock, desk.threshold])
  const lastPage = Math.max(1, Math.ceil(results.length / size))
  const requestedPage = Number(params.get('page'))
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(lastPage, requestedPage)) : 1
  const first = (page - 1) * size
  const pageRows = useMemo(() => results.slice(first, first + size), [results, first, size])
  const total = groupKey === 'all' ? liveGroup.length : desk.apiCounts?.[groupKey === 'assigned' ? 'coordinators' : groupKey] ?? liveGroup.length
  const selected = groupKey === 'all' ? {title: 'Все инциденты', symbol: '≡'} : queues.find((queue) => queue.key === groupKey)!
  return <section id={'section-' + groupKey} tabIndex={-1} aria-label={selected.title} className={'overview-table-panel mcc-glass overview-kind-' + groupKey}>
      <div className="overview-table-toolbar">
        <div className="ops-section-head">
          <h2><i aria-hidden="true" />{selected.title}</h2>
          <div className="ops-section-volume">
            {activity && <QueueCounts activity={activity}/>}
             <span className="ops-total" aria-label={'Сейчас '+total}>{format.format(total)}</span>
          </div>
        </div>
        {filtered && !awaitingServer && <Text color="secondary">{pending ? 'В показанной выборке: ' : 'Найдено: '}{format.format(results.length)}</Text>}
        {soonOnly && <Label type="close" theme="warning" closeButtonLabel="Снять фильтр по сроку" onCloseClick={() => update({sla: '', page: ''})}>До 30 минут</Label>}
        {activity && groupKey !== 'all' && <LatestActivity queue={groupKey} activity={activity} desk={desk} byKey={byKey} />}
        {pending && <Button className="queue-apply" size="m" view="outlined" onClick={() => {setSnapshot(liveGroup); if (filterKey) server.retry()}}>{pending.added ? 'Обновить таблицу (+'+pending.added+')' : 'Показать обновления таблицы'}</Button>}
        <div className="overview-controls">
          <div className="mcc-field">
            <label htmlFor={'queue-search-'+groupKey}>Поиск</label>
            <TextInput id={'queue-search-'+groupKey} size="l" value={query} onUpdate={q => update({q, page:''})} hasClear
              placeholder="Номер, продукт, сбой или команда" controlProps={{'aria-label': groupKey === 'all' ? 'Поиск по всем инцидентам' : 'Поиск в очереди'}} />
          </div>
          <div className="mcc-field">
            <label htmlFor={'queue-order-'+groupKey}>Порядок</label>
            <Select id={'queue-order-'+groupKey} width="max" size="l" value={[sort]} options={sortOptions}
              onUpdate={([value]) => update({sort: usesRealBackend || value !== 'deadline' ? value : '', page:''})} />
          </div>
        </div>
      </div>
      <QueueFilters incidents={incidents} queue={groupKey} params={params} update={update} reset={() => update(clearFilters)} />
      {awaitingServer ? <div className="overview-table-empty">
        {server.failed ? <>
          <Text role="alert" color="danger">{copy.failed}</Text>
          <Button view="outlined" onClick={server.retry}>{copy.retry}</Button>
        </> : <Text role="status" color="secondary">{copy.loading}</Text>}
      </div> : pageRows.length ? <>
        <div ref={setScroll} className={'overview-table-scroll' + (pageRows.length >= 50 ? ' overview-table-scroll-long' : '')} tabIndex={0} role="region" aria-label="Список инцидентов">
          <IncidentTable rows={pageRows} label={selected.title} scroll={scroll} />
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

export function Overview({groups, navigationHost, activity, listingHash, incidents, events, wall, summary, activeQueue = 'critical'}: Props) {
  const {desk} = useWorkspace()
  const owners = useMemo(() => queueOwnerLabels(desk), [desk])
  const params = new URLSearchParams(listingHash.split('?')[1])
  const surface = wall ? 'wall' : summary ? 'overview' : undefined
  const stacked = Boolean(surface) || (activeQueue !== 'all' && activeQueue !== 'events')
  const target = queues.find(q => q.key === (surface ? params.get('section') : activeQueue))?.key ?? 'critical'
  const section = overviewSection(listingHash)
  const byKey = useMemo(() => new Map(incidents.map(i => [i.key, i])), [incidents])
  const boardParams = stacked ? scopeQueueParams(params, target) : new URLSearchParams()
  const [inView, setInView] = useState<QueueKey|null>(surface ? selectedQueue(listingHash) ?? null : target)
  const boardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!stacked) return
    let frame = 0
    function track() {
      if (!boardRef.current?.offsetHeight) return
      let visible: QueueKey|null = surface ? null : 'critical'
      for (const {key} of queues) {
        const rect = document.getElementById('section-' + key)?.getBoundingClientRect()
        if (rect && rect.top <= 84) visible = key
      }
      if (boardRef.current.getBoundingClientRect().bottom <= 84) visible = null
      setInView(visible)
    }
    function schedule() {
      if (frame) return
      frame = requestAnimationFrame(() => {frame = 0; track()})
    }
    schedule()
    window.addEventListener('scroll', schedule, {passive: true})
    window.addEventListener('resize', schedule)
    return () => {window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); cancelAnimationFrame(frame)}
  }, [stacked, surface])
  function sectionHref(key: QueueKey) {return boardLink(boardParams, key, surface ?? 'overview')}
  function replace(href: string) {
    history.replaceState(history.state, '', href)
    window.dispatchEvent(new Event('hashchange'))
  }
  function change(params: URLSearchParams, changes: Record<string,string>, prefix = '') {
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(prefix + key, value)
      else params.delete(prefix + key)
    }
  }
  function update(changes: Record<string,string>) {
    const next = new URLSearchParams(params)
    change(next, changes)
    replace(queueHref(activeQueue, next))
  }
  const movementQueue = queues.find(q => q.key === params.get('queue'))?.key
  const nav = <nav className="ops-queue-nav" aria-label="Очереди смены">
    <h2>Очереди смены</h2>
    {queues.map(q=><a key={q.key} href={sectionHref(q.key)} className={'overview-stat q-'+q.key}
      aria-current={stacked && q.key===inView ? 'location' : undefined}
      onClick={e => followOverviewAnchor(e, q.key)}>
      <i className="cr-dot"/><span>{q.title}</span><b className="overview-nav-count queue-total">{format.format(desk.apiCounts?.[q.key === 'assigned' ? 'coordinators' : q.key] ?? groups[q.key].length)}</b>
      <QueueCounts activity={activity[q.key]}/>
    </a>)}
    <a href="#queue/all" aria-current={activeQueue==='all'?'page':undefined}>Все инциденты<b>{format.format(incidents.length)}</b></a>
  </nav>
  const sidebar = navigationHost ? createPortal(nav, navigationHost) : null
  const board = <QueueOwners.Provider value={owners}><div className="ops-board" ref={boardRef}>
    {activeQueue === 'events' && !wall ? (
      movementQueue ? <MovementJournal key={movementQueue} queue={movementQueue} activity={activity[movementQueue]} byKey={byKey} desk={desk}/> :
        <section className="overview-log" aria-label="Журнал смены"><EventJournal incidents={incidents} events={events} params={params} update={update}/></section>
    ) : activeQueue === 'all' && !wall ? (
      <QueuePanel key="all" groupKey="all" liveGroup={incidents} incidents={incidents} byKey={byKey} params={params} update={update} live />
    ) : <div className="overview-section-stack">
      {queues.map(({key}) => {
        const local = new URLSearchParams()
        for (const [name,value] of boardParams) if (name.startsWith(key+'.')) local.set(name.slice(key.length+1),value)
        return <QueuePanel key={key} groupKey={key} liveGroup={groups[key]} incidents={incidents} byKey={byKey}
          params={local} activity={activity[key]} live={wall} update={changes=>{
            const next = new URLSearchParams(boardParams)
            change(next, changes, key+'.')
            replace(boardLink(next, surface ? section : target, surface ?? 'overview'))
          }}/>
      })}
    </div>}
  </div></QueueOwners.Provider>
  if (wall || summary) {
    const dueSoon = new URLSearchParams(boardParams)
    dueSoon.set('critical.sla', 'soon')
    dueSoon.delete('critical.page')
    const critical = [...groups.critical].sort(incidentOrder).slice(0, 3)
    const criticalTiles = <section className="ops-critical-section" data-overview-block="critical">
        <Flex justifyContent="space-between" alignItems="baseline" wrap="wrap" gap="spacing-2">
          <Text as="h2" variant="header-2">Ближайшие критические сроки</Text>
          <Flex alignItems="center" gap="spacing-3" wrap>
            <Text color="secondary">Показано {critical.length} из {format.format(desk.apiCounts?.critical ?? groups.critical.length)}</Text>
          </Flex>
        </Flex>
        <div className="overview-critical-grid">{!critical.length&&<Text color="secondary">Активных критических инцидентов нет.</Text>}{critical.map((item) => <CriticalTile key={item.key} item={item} />)}</div>
      </section>
    return <>{sidebar}<LiveOverview critical={groups.critical} incidents={incidents} activity={activity.critical} events={events} byKey={byKey} wall={wall} soonHref={boardLink(dueSoon, 'critical')} criticalTiles={criticalTiles}>{board}</LiveOverview></>
  }
  return <>{sidebar}{board}</>
}
