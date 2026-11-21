import {useEffect, useMemo, useState} from 'react'
import {Button, Card, Flex, Link, Pagination, Select, Text, TextInput} from '@gravity-ui/uikit'
import './EventStream.css'
import {useWorkspace} from './desk/context'
import {standNow, type Incident, type ShiftEvent} from './desk/types'
import {shiftEventTime} from './desk/timeline'

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
const numberFormat = new Intl.NumberFormat('ru-RU')

interface StreamProps {
  incidents: Incident[]
  events: ShiftEvent[]
}

function EventRows({
  events,
  byKey,
  focusKey,
  shiftStart,
}: {
  events: ShiftEvent[]
  byKey: Map<string, Incident>
  focusKey: string
  shiftStart: number
}) {
  return (
    <ol className="shift-stream-list" aria-label="События от новых к старым">
      {events.map((event) => {
        const incident = byKey.get(event.key)
        const kind = eventKinds[event.kind]
        const fields = (
          <>
            <Text
              className="shift-stream-time"
              as="time"
              dateTime={new Date(shiftEventTime(event, shiftStart)).toISOString()}
              color="secondary"
            >
              {event.time}
            </Text>
            <Text className="shift-stream-kind" variant="subheader-1">
              {kind.label}
            </Text>
            <Text className="shift-stream-product" variant="subheader-2">
              {incident?.product ?? event.key}
            </Text>
            <Text className="shift-stream-change">{event.change}</Text>
            {incident && (
              <Text className="shift-stream-id" variant="code-inline-1" color="secondary">
                {incident.id}
              </Text>
            )}
          </>
        )
        return (
          <li key={event.id} className={'shift-stream-event shift-stream-event--' + event.kind}>
            {incident ? (
              <Link
                className="shift-stream-entry"
                view="primary"
                id={'journal-event-' + event.id}
                href={
                  '#incident/' +
                  encodeURIComponent(incident.key) +
                  '?tab=timeline&event=' +
                  encodeURIComponent(event.id)
                }
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
                  sessionStorage.setItem(
                    focusKey,
                    JSON.stringify({
                      hash: location.hash,
                      id: event.id,
                      y: e.currentTarget.closest('ol')?.scrollTop ?? 0,
                    }),
                  )
                }}
              >
                {fields}
              </Link>
            ) : (
              <div className="shift-stream-entry">{fields}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function EventJournal({
  incidents,
  events,
  params,
  update,
}: StreamProps & {
  params: URLSearchParams
  update: (changes: Record<string, string>) => void
}) {
  const byKey = useMemo(() => new Map(incidents.map((item) => [item.key, item])), [incidents])
  const {desk, now} = useWorkspace()
  const focusKey = 'mcc-journal-return-' + desk.mode
  useEffect(() => {
    let frame: number
    function restoreFocus() {
      if (!location.hash.startsWith('#events')) return
      const saved = sessionStorage.getItem(focusKey)
      if (!saved) return
      let target: {hash: string; id: string; y: number}
      try {
        target = JSON.parse(saved)
      } catch {
        sessionStorage.removeItem(focusKey)
        return
      }
      if (target?.hash !== location.hash || typeof target.id !== 'string') return
      frame = requestAnimationFrame(() => {
        const link = document.getElementById('journal-event-' + target.id)
        if (!link?.getClientRects().length) return
        const list = link.closest('ol')
        if (list && Number.isFinite(target.y)) list.scrollTop = target.y
        link.focus({preventScroll: true})
        sessionStorage.removeItem(focusKey)
      })
    }
    restoreFocus()
    window.addEventListener('hashchange', restoreFocus)
    return () => {
      window.removeEventListener('hashchange', restoreFocus)
      cancelAnimationFrame(frame)
    }
  }, [focusKey])
  const currentMinute = Math.floor(standNow(desk, now) / 60000)
  const shiftStart = desk.clockBase ?? desk.started
  const [snapshot, setSnapshot] = useState(events)
  const query = params.get('q') ?? ''
  const product = params.get('product') ?? ''
  const kind = kindOptions.find((option) => option.value === params.get('kind'))?.value ?? 'all'
  const period = periods.find((option) => option.value === params.get('period'))?.value ?? 'shift'
  const found = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('ru')
    const since = (currentMinute - Number(period)) * 60000
    const end = (currentMinute + 1) * 60000
    return snapshot.filter((event) => {
      if (kind !== 'all' && event.kind !== kind) return false
      if (product && byKey.get(event.key)?.product !== product) return false
      if (period !== 'shift') {
        const at = shiftEventTime(event, shiftStart)
        if (at < since || at >= end) return false
      }
      if (!term) return true
      const item = byKey.get(event.key)
      return [item?.id, item?.product, item?.title, event.change, eventKinds[event.kind].label].some(
        (value) => value?.toLocaleLowerCase('ru').includes(term),
      )
    })
  }, [snapshot, byKey, query, product, kind, period, currentMinute, shiftStart])
  const requested = Number(params.get('page'))
  const page = Number.isSafeInteger(requested)
    ? Math.max(1, Math.min(Math.ceil(found.length / pageSize), requested))
    : 1
  const start = (page - 1) * pageSize
  const changed = snapshot[0]?.id !== events[0]?.id || snapshot.length !== events.length
  return (
    <Card className="mcc-glass shift-stream shift-stream--full">
      <div className="shift-stream-filters">
        <div className="mcc-field">
          <label htmlFor="journal-search">Поиск по журналу</label>
          <TextInput
            id="journal-search"
            size="l"
            type="search"
            value={query}
            hasClear
            placeholder="Номер инцидента, продукт или текст события"
            onUpdate={(q) => update({q, page: ''})}
          />
        </div>
        <div className="mcc-field">
          <label htmlFor="journal-kind">Тип события</label>
          <Select
            id="journal-kind"
            width="max"
            size="l"
            value={[kind]}
            options={kindOptions}
            onUpdate={([value]) => update({kind: value === 'all' ? '' : value, page: ''})}
          />
        </div>
        <div className="mcc-field">
          <label htmlFor="journal-period">Период журнала</label>
          <Select
            id="journal-period"
            width="max"
            size="l"
            value={[period]}
            options={periods}
            onUpdate={([value]) => update({period: value === 'shift' ? '' : value, page: ''})}
          />
        </div>
      </div>
      {product && (
        <Button
          size="s"
          view="outlined"
          onClick={() => update({product: '', page: ''})}
          aria-label="Снять фильтр продукта"
        >
          {product} ×
        </Button>
      )}
      <Flex
        className="shift-stream-status"
        justifyContent="space-between"
        alignItems="center"
        gap="spacing-3"
        wrap="wrap"
      >
        <Text role="status" color="secondary">
          Найдено событий: {numberFormat.format(found.length)}
          {found.length > 0 && (
            <>
              {' '}
              · {numberFormat.format(start + 1)}–
              {numberFormat.format(Math.min(start + pageSize, found.length))}
            </>
          )}
        </Text>
        {changed && (
          <Button
            view="outlined"
            onClick={() => {
              setSnapshot(events)
              update({page: ''})
            }}
          >
            Показать обновления
          </Button>
        )}
      </Flex>
      {found.length > 0 ? (
        <>
          <div className="shift-stream-columns" aria-hidden="true">
            <span>Время, МСК</span>
            <span>Тип</span>
            <span>Продукт и INC</span>
            <span>Событие</span>
          </div>
          <EventRows events={found.slice(start, start + pageSize)} byKey={byKey} focusKey={focusKey} shiftStart={shiftStart} />
          {found.length > pageSize && (
            <nav className="shift-stream-pagination" aria-label="Страницы журнала">
              <Pagination
                className="journal-page-controls"
                compact
                showInput
                page={page}
                pageSize={pageSize}
                total={found.length}
                onUpdate={(n) => update({page: String(n)})}
              />
            </nav>
          )}
        </>
      ) : (
        <Flex className="shift-stream-empty" direction="column" alignItems="flex-start" gap="spacing-2">
          <Text variant="subheader-2">
            {snapshot.length ? 'Совпадений нет' : 'В журнале пока нет событий'}
          </Text>
          {(query || product || kind !== 'all' || period !== 'shift') && (
            <Button view="flat" onClick={() => update({q: '', product: '', kind: '', period: '', page: ''})}>
              Сбросить поиск и фильтр
            </Button>
          )}
        </Flex>
      )}
    </Card>
  )
}
