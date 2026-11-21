import {useMemo, useState} from 'react'
import {Button, Card, Flex, Link, Pagination, Select, Text, TextInput} from '@gravity-ui/uikit'
import {type Incident, type ShiftEvent} from './demoData'
import './EventStream.css'
import {useWorkspace} from './desk/context'
import {standNow,moscowTime} from './desk/types'

const eventKinds = {
  new: {label: 'Новый критический', symbol: '!'},
  assign: {label: 'Назначение', symbol: '↳'},
  due: {label: 'Срок близко', symbol: '◷'},
  restore: {label: 'Восстановление', symbol: '✓'},
}
const kindOptions = [
  {value: 'all', content: 'Все типы'},
  ...Object.entries(eventKinds).map(([value, {label}]) => ({value, content: label})),
]
const pageSize = 25
const periods = [
  {value: 'shift', content: 'Вся смена'},
  {value: '60', content: 'Последний час'},
  {value: '15', content: 'Последние 15 минут'},
]
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
const numberFormat = new Intl.NumberFormat('ru-RU')

interface StreamProps {
  incidents: Incident[]
  events: ShiftEvent[]
}

function EventRows({events, byKey}: {events: ShiftEvent[]; byKey: Map<string, Incident>}) {
  return (
    <ol className="shift-stream-list" aria-label="События от новых к старым">
      {events.map(event => {
        const incident = byKey.get(event.key)
        const kind = eventKinds[event.kind]
        const fields = <>
          <span className="shift-stream-symbol" aria-hidden="true">{kind.symbol}</span>
          <Text className="shift-stream-kind" variant="subheader-1">{kind.label}</Text>
          <Text className="shift-stream-time" as="time" dateTime={event.time} color="secondary">{event.time}</Text>
          <Text className="shift-stream-product" variant="subheader-2">{incident?.product ?? event.key}</Text>
          <Text className="shift-stream-change">{event.change}</Text>
          {incident && <Text className="shift-stream-id" variant="code-inline-1" color="secondary">{incident.id}</Text>}
        </>
        return (
          <li key={event.id} className={'shift-stream-event shift-stream-event--' + event.kind}>
            {incident
              ? <Link className="shift-stream-entry" view="primary" href={'#incident/' + incident.key}>{fields}</Link>
              : <div className="shift-stream-entry">{fields}</div>}
          </li>
        )
      })}
    </ol>
  )
}

export function EventJournal({incidents, events, params, update}: StreamProps & {
  params: URLSearchParams; update: (changes: Record<string, string>) => void
}) {
  const byKey = useMemo(() => new Map(incidents.map(item => [item.key, item])), [incidents])
  const {desk,now}=useWorkspace()
  const currentMinute=Math.floor(standNow(desk,now)/60000)
  const [snapshot, setSnapshot] = useState(events)
  const query = params.get('q') ?? ''
  const kind = kindOptions.find(option => option.value === params.get('kind'))?.value ?? 'all'
  const period = periods.find(option => option.value === params.get('period'))?.value ?? 'shift'
  const found = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('ru')
    const from = period === 'shift' ? 0 : toMinutes(moscowTime(currentMinute*60000)) - Number(period)
    return snapshot.filter(event => {
      if (kind !== 'all' && event.kind !== kind) return false
      if(period!=='shift'&&(event.at?event.at<(currentMinute-Number(period))*60000:toMinutes(event.time)<from))return false
      if (!term) return true
      const item = byKey.get(event.key)
      return [item?.id, item?.product, item?.title, event.change, eventKinds[event.kind].label]
        .some(value => value?.toLocaleLowerCase('ru').includes(term))
    })
  }, [snapshot, byKey, query, kind, period,currentMinute])
  const requested = Number(params.get('page'))
  const page = Number.isSafeInteger(requested) ? Math.max(1, Math.min(Math.ceil(found.length/pageSize), requested)) : 1
  const start = (page - 1) * pageSize
  const changed = snapshot[0]?.id !== events[0]?.id || snapshot.length !== events.length
  return (
    <Card className="mcc-glass shift-stream shift-stream--full">
      <div className="shift-stream-filters">
        <TextInput size="l" type="search" value={query} hasClear
          placeholder="Номер инцидента, продукт или текст события"
          controlProps={{'aria-label': 'Поиск по журналу'}}
          onUpdate={q => update({q, page: ''})} />
        <Select size="l" aria-label="Тип события" value={[kind]} options={kindOptions}
          onUpdate={([value]) => update({kind: value === 'all' ? '' : value, page: ''})}/>
        <Select size="l" aria-label="Период журнала" value={[period]} options={periods}
          onUpdate={([value]) => update({period: value === 'shift' ? '' : value, page: ''})}/>
      </div>
      <Flex className="shift-stream-status" justifyContent="space-between" alignItems="center" gap="spacing-3" wrap="wrap">
        <Text role="status" color="secondary">
          Найдено событий: {numberFormat.format(found.length)}
          {found.length > 0 && <> · {numberFormat.format(start + 1)}–{numberFormat.format(Math.min(start + pageSize, found.length))}</>}
        </Text>
        {changed && <Button view="outlined" onClick={() => {setSnapshot(events); update({page: ''})}}>Показать обновления</Button>}
      </Flex>
      {found.length > 0 ? <>
        <EventRows events={found.slice(start, start + pageSize)} byKey={byKey}/>
        {found.length > pageSize && <nav className="shift-stream-pagination" aria-label="Страницы журнала">
          <Pagination compact showInput page={page} pageSize={pageSize} total={found.length} onUpdate={n => update({page: String(n)})}/>
        </nav>}
      </> : <Flex className="shift-stream-empty" direction="column" alignItems="flex-start" gap="spacing-2">
        <Text variant="subheader-2">{snapshot.length ? 'Совпадений нет' : 'В журнале пока нет событий'}</Text>
        {(query || kind !== 'all' || period !== 'shift') && <Button view="flat" onClick={() => update({q: '', kind: '', period: '', page: ''})}>Сбросить поиск и фильтр</Button>}
      </Flex>}
    </Card>
  )
}

export function EventStream({incidents, events}: StreamProps) {
  const byKey = useMemo(() => new Map(incidents.map(item => [item.key, item])), [incidents])
  return (
    <Card className="mcc-glass shift-stream shift-stream--compact">
      <Flex className="shift-stream-heading" justifyContent="space-between" alignItems="baseline" gap="spacing-2">
        <Text as="h2" variant="header-1">Последние события</Text>
        <Text color="secondary" variant="caption-2">МСК</Text>
      </Flex>
      <EventRows events={events.slice(0, 5)} byKey={byKey}/>
      {events.length === 0 && <Text as="p" className="shift-stream-empty" color="secondary">Событий пока нет</Text>}
      <div className="shift-stream-more"><Link href="#events">Весь журнал →</Link></div>
    </Card>
  )
}
