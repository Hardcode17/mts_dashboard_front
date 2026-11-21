import {useEffect, useMemo, useRef, useState} from 'react'
import {Card, Link, Pagination, SegmentedRadioGroup, Select, Text} from '@gravity-ui/uikit'
import type {Incident} from './desk/types'
import {historyFields, type TrackedField} from './incidentHistory'
import {useWorkspace} from './desk/context'
import {cardTimeline, cardVersions, historyValue, revisionTime, type TimelineEntry} from './desk/timeline'
import {fullTime, type Desk} from './desk/types'
import './Chronology.css'

const filters = ['Все', 'ITSM', 'Смена', 'Комната'] as const
const pageSize = 25
const clock = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'Europe/Moscow',
})
const calendar = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Moscow',
})

function Changes({
  changes,
}: {
  changes: {field: TrackedField; before?: string | null; after?: string | null}[]
}) {
  return (
    <table className="chronology-values">
      <thead>
        <tr>
          <th scope="col">Поле</th>
          <th scope="col">Было</th>
          <th scope="col">
            <span aria-hidden="true">→ </span>Стало
          </th>
        </tr>
      </thead>
      <tbody>
        {changes.map(({field, before, after}) => (
          <tr key={field}>
            <th scope="row">{historyFields[field]}</th>
            <td>{historyValue(field, before)}</td>
            <td>{historyValue(field, after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Comparison({desk, versions}: {desk: Desk; versions: ReturnType<typeof cardVersions>}) {
  const [before, setBefore] = useState(0)
  const [after, setAfter] = useState<number | null>(null)
  const left = Math.min(before, versions.length - 1)
  const right = Math.min(after ?? versions.length - 1, versions.length - 1)
  const options = useMemo(
    () =>
      versions.map((v, i) => ({
        value: String(i),
        content: '#' + (i + 1) + ' · ' + fullTime(revisionTime(desk, v.observedAt, true)),
      })),
    [versions, desk],
  )
  const differences = useMemo(() => {
    const snapshot = (index: number) => {
      const values: Record<string, string | null | undefined> = {}
      for (let i = 0; i <= index; i++) Object.assign(values, versions[i].values)
      return values
    }
    const old = snapshot(left),
      next = snapshot(right)
    return (Object.keys(historyFields) as TrackedField[])
      .filter((field) => old[field] !== next[field])
      .map((field) => ({field, before: old[field], after: next[field]}))
  }, [versions, left, right])
  return (
    <>
      <div className="chronology-versions">
        <div className="mcc-field">
          <label htmlFor="revision-before">Исходная версия</label>
          <Select
            id="revision-before"
            width="max"
            value={[String(left)]}
            options={options}
            onUpdate={([v]) => setBefore(Number(v))}
          />
        </div>
        <div className="mcc-field">
          <label htmlFor="revision-after">Версия для сравнения</label>
          <Select
            id="revision-after"
            width="max"
            value={[String(right)]}
            options={options}
            onUpdate={([v]) => setAfter(Number(v))}
          />
        </div>
      </div>
      {differences.length ? <Changes changes={differences} /> : <p>Значения совпадают.</p>}
    </>
  )
}

function EventRow({entry, selected}: {entry: TimelineEntry; selected: boolean}) {
  const details = useRef<HTMLDetailsElement>(null)
  const row = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (!selected) return
    const frame = requestAnimationFrame(() => {
      if (details.current) details.current.open = true
      row.current?.focus({preventScroll: true})
      row.current?.scrollIntoView({block: 'nearest'})
    })
    return () => cancelAnimationFrame(frame)
  }, [selected, entry.id])
  return (
    <li
      ref={row}
      className={'chronology-row' + (selected ? ' is-selected' : '')}
      tabIndex={selected ? -1 : undefined}
      aria-current={selected ? 'true' : undefined}
      data-entry={entry.id}
    >
      <div className="chronology-time">
        <time
          dateTime={
            entry.timeBasis === 'clockOnly' ? clock.format(entry.at) : new Date(entry.at).toISOString()
          }
        >
          {clock.format(entry.at)}
        </time>
        {entry.timeBasis !== 'clockOnly' && <small>{calendar.format(entry.at)}</small>}
      </div>
      <div className="chronology-source">
        <span>{entry.source}</span>
        {entry.timeBasis === 'observed' && <small>Замечено пультом</small>}
      </div>
      {entry.changes ? (
        <details ref={details} className="chronology-details">
          <summary>{entry.title}</summary>
          <Changes changes={entry.changes} />
          {entry.timeBasis === 'source' && entry.observedAt != null && (
            <small>
              Время изменения передала ITSM. Пульт получил снимок {fullTime(entry.observedAt)} МСК.
            </small>
          )}
        </details>
      ) : (
        <span className="chronology-message">
          {entry.href ? <Link href={entry.href}>{entry.text}</Link> : entry.text}
        </span>
      )}
    </li>
  )
}

interface Props {
  incident: Incident
  compareOpen?: boolean
  focusEvent?: string
}

function Timeline({incident, compareOpen = false, focusEvent}: Props) {
  const {desk} = useWorkspace()
  const [filter, setFilter] = useState<string>('Все')
  const [chosenPage, setPage] = useState<number | null>(null)
  const [comparing, setComparing] = useState(compareOpen)
  const entries = useMemo(() => cardTimeline(desk, incident), [desk, incident])
  const versions = cardVersions(desk, incident.key)
  const visible = useMemo(
    () => (filter === 'Все' ? entries : entries.filter((e) => e.category === filter)),
    [entries, filter],
  )
  const currentIndex = focusEvent ? visible.findIndex((e) => e.journalIds?.includes(focusEvent)) : -1
  const lastPage = Math.max(1, Math.ceil(visible.length / pageSize))
  const page = Math.min(chosenPage ?? Math.floor(Math.max(0, currentIndex) / pageSize) + 1, lastPage)
  return (
    <Card className="incident-panel incident-chronology" view="outlined">
      <div className="chronology-head">
        <Text as="h2" variant="header-1">
          Хронология
        </Text>
        <SegmentedRadioGroup
          size="m"
          aria-label="Источник событий"
          value={filter}
          options={filters.map((value) => ({value, content: value}))}
          onUpdate={(value) => {
            setFilter(value)
            setPage(1)
          }}
        />
      </div>
      <div className="chronology-table-head" aria-hidden="true">
        <span>Время, МСК</span>
        <span>Источник</span>
        <span>Событие</span>
      </div>
      <ol className="chronology-list" aria-label="События инцидента, время московское">
        {visible.slice((page - 1) * pageSize, page * pageSize).map((e) => (
          <EventRow key={e.id} entry={e} selected={!!focusEvent && !!e.journalIds?.includes(focusEvent)} />
        ))}
      </ol>
      {!visible.length && <p role="status">По этому источнику событий пока нет.</p>}
      {visible.length > pageSize && (
        <nav aria-label="Страницы хронологии">
          <Pagination
            size="m"
            compact
            showInput
            page={page}
            pageSize={pageSize}
            total={visible.length}
            onUpdate={setPage}
          />
        </nav>
      )}
      {versions.length > 1 ? (
        <details
          className="chronology-compare"
          open={comparing}
          onToggle={(e) => setComparing(e.currentTarget.open)}
        >
          <summary>Сравнить версии карточки</summary>
          {comparing && <Comparison desk={desk} versions={versions} />}
        </details>
      ) : (
        <small>
          {versions.length
            ? 'Сохранена одна версия ITSM. Сравнение появится со второй версии.'
            : 'Снимки ITSM пока не получены.'}
        </small>
      )}
    </Card>
  )
}

export function IncidentChronology(props: Props) {
  return (
    <Timeline
      key={props.incident.key + '/' + (props.focusEvent ?? '') + '/' + !!props.compareOpen}
      {...props}
    />
  )
}
