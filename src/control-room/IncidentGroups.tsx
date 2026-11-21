import {useEffect, useMemo, useRef, useState} from 'react'
import {Button, Checkbox, Link, Pagination, Select, TextInput} from '@gravity-ui/uikit'
import type {Incident} from '../desk/types'
import {useWorkspace} from '../desk/context'
import {active, fullTime, standNow, type Desk} from '../desk/types'
import {buildAttentionRows, groupHref, serviceCount, type AttentionRow} from './attention'
import './IncidentGroups.css'

const incidentHref = (key: string) => '#incident/' + encodeURIComponent(key)
const memberPageSize = 20
const countFormat = new Intl.NumberFormat('ru-RU')
function dueLabel(at: number | null, now: number) {
  if (at === null) return 'Срок не указан'
  const minutes = Math.ceil((at - now) / 60000)
  if (minutes === 0) return 'Срок сейчас'
  const n = Math.abs(minutes)
  const span = n < 60 ? n + ' мин' : Math.floor(n / 60) + ' ч' + (n % 60 ? ' ' + (n % 60) + ' мин' : '')
  return minutes < 0 ? 'Просрочено на ' + span : span + ' до срока'
}

function matchesIncident(i: Incident, term: string) {
  return (
    !term ||
    [i.id, i.product, i.service, i.title, i.team].some((value) =>
      value?.toLocaleLowerCase('ru').includes(term),
    )
  )
}

function Owner({row}: {row: AttentionRow}) {
  return <span className={'ag-owner ag-owner-' + row.ownerState}>{row.ownerLabel}</span>
}

function Claim({row}: {row: AttentionRow}) {
  const {person, act, busy} = useWorkspace()
  if (row.ownerState === 'owned') return null
  return (
    <Button
      size="m"
      view="action"
      disabled={busy}
      onClick={() => void act({type: 'groupClaim', id: row.id, person, expected: row.group.revision})}
    >
      Взять в работу
    </Button>
  )
}

function GroupList({
  rows,
  compact,
  query,
  setQuery,
}: {
  rows: AttentionRow[]
  compact: boolean
  query: string
  setQuery: (value: string) => void
}) {
  const {now, desk} = useWorkspace()
  const [mode, setMode] = useState('all'),
    [page, setPage] = useState(1)
  const term = query.trim().toLocaleLowerCase('ru')
  const results = useMemo(
    () =>
      rows.filter(
        (row) =>
          (mode === 'all' ||
            (mode === 'cycle'
              ? row.cycle
              : mode === 'open'
                ? row.ownerState !== 'owned'
                : row.ownerState === 'owned')) &&
          (!term ||
            row.title.toLocaleLowerCase('ru').includes(term) ||
            row.ownerLabel.toLocaleLowerCase('ru').includes(term) ||
            row.members.some((i) => matchesIncident(i, term))),
      ),
    [rows, mode, term],
  )
  const size = compact ? 3 : 10,
    current = Math.max(1, Math.min(page, Math.ceil(results.length / size)))
  const unclaimed = rows.filter((row) => row.ownerState !== 'owned').length
  return (
    <section id="attention" tabIndex={-1} className="cr-panel ag-panel" aria-label="Ситуации смены">
      <header>
        <h2>{compact ? 'Требуют внимания' : 'Ситуации смены'}</h2>
        <span className="cr-mono ag-counter">
          Ждут принятия · {countFormat.format(unclaimed)} / всего {countFormat.format(rows.length)}
        </span>
      </header>
      {!compact && (
        <div className="ag-filters">
          <div className="mcc-field">
            <label htmlFor="ag-search">Поиск ситуации</label>
            <TextInput
              id="ag-search"
              value={query}
              onUpdate={(q) => {
                setQuery(q)
                setPage(1)
              }}
              hasClear
              placeholder="Группа, INC, сервис или координатор"
            />
          </div>
          <div className="mcc-field">
            <label htmlFor="ag-kind">Показать</label>
            <Select
              id="ag-kind"
              width="max"
              value={[mode]}
              onUpdate={([v]) => {
                setMode(v)
                setPage(1)
              }}
              options={[
                {value: 'all', content: 'Все ситуации'},
                {value: 'open', content: 'Без принявшего'},
                {value: 'owned', content: 'В работе'},
                {value: 'cycle', content: 'Возврат назначения'},
              ]}
            />
          </div>
        </div>
      )}
      {results.length ? (
        <ul className="ag-list">
          {results.slice((current - 1) * size, current * size).map((row) => (
            <li key={row.id}>
              <div className="ag-info">
                <a href={groupHref(row.id)} className="ag-title">
                  {row.title}
                </a>
                <span className="ag-meta">
                  {countFormat.format(row.members.length)} INC · {serviceCount(row)}
                  {row.reason && <> · {row.reason}</>}
                </span>
              </div>
              <div className="ag-row-state">
                <Owner row={row} />
                <span className="ag-meta">{dueLabel(row.deadline, standNow(desk, now))}</span>
              </div>
              <Claim row={row} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="ag-meta">
          {rows.length ? 'Совпадений нет.' : 'Активных ситуаций для координации пока нет.'}
        </p>
      )}
      {compact ? (
        rows.length > size && <Link href="#attention">Все ситуации ({countFormat.format(rows.length)}) →</Link>
      ) : (
        results.length > size && (
          <Pagination
            className="ag-pages"
            page={current}
            pageSize={size}
            total={results.length}
            compact
            showInput
            onUpdate={setPage}
          />
        )
      )}
    </section>
  )
}

function MemberEditor({row, incidents, desk}: {row: AttentionRow; incidents: Incident[]; desk: Desk}) {
  const {act, person, busy} = useWorkspace()
  const [adding, setAdding] = useState(false),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1)
  const [selection, setSelection] = useState<Set<string>>(() => new Set()),
    [feedback, setFeedback] = useState('')
  const [seenRevision, setSeenRevision] = useState(row.group.revision)
  const searchRef = useRef<HTMLInputElement>(null)
  const members = useMemo(() => new Set(row.group.members), [row.group.members])
  const term = query.trim().toLocaleLowerCase('ru')
  const candidates = useMemo(() => {
    const source = adding
      ? incidents.filter((i) => active(i) && !i.absent && !members.has(i.key))
      : row.members
    return (adding && !term ? [] : source).filter((i) => matchesIncident(i, term))
  }, [adding, incidents, members, row.members, term])
  const selected = Array.from(selection).filter((key) => (adding ? !members.has(key) : members.has(key)))
  const selectedSet = new Set(selected)
  const current = Math.max(1, Math.min(page, Math.ceil(candidates.length / memberPageSize)))
  const shown = candidates.slice((current - 1) * memberPageSize, current * memberPageSize)
  const selectable = (i: Incident) => adding || row.id !== 'inc:' + i.key
  const pageKeys = shown.filter(selectable).map((i) => i.key)
  const allChecked = pageKeys.length > 0 && pageKeys.every((key) => selectedSet.has(key))
  const partial = pageKeys.some((key) => selectedSet.has(key)) && !allChecked
  const otherGroups = useMemo(
    () =>
      new Map(
        (desk.outageGroups ?? [])
          .filter((g) => g.method !== 'single' && g.id !== row.id)
          .flatMap((g) => g.members.map((key) => [key, g.title] as const)),
      ),
    [desk.outageGroups, row.id],
  )
  // A changed group may have been edited by another operator while this selection was open.
  const stale = selected.length > 0 && seenRevision !== row.group.revision
  function pick(keys: string[], on: boolean) {
    if (!selection.size) setSeenRevision(row.group.revision)
    setFeedback('')
    setSelection((old) => {
      const next = new Set(old)
      for (const key of keys) {
        if (on) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }
  function switchMode(next: boolean) {
    setAdding(next)
    setQuery('')
    setPage(1)
    setSelection(new Set())
    setFeedback('')
    setSeenRevision(row.group.revision)
    if (next) requestAnimationFrame(() => searchRef.current?.focus())
  }
  async function submit() {
    if (!selected.length || stale) return
    const ok = await act({
      type: adding ? 'groupAdd' : 'groupExclude',
      id: row.id,
      ids: selected,
      person,
      expected: row.group.revision,
    })
    if (ok) {
      setFeedback((adding ? 'Добавлено INC: ' : 'Исключено INC: ') + selected.length)
      setSelection(new Set())
    }
  }
  return (
    <section className="cr-panel ag-panel" aria-label="Управление составом">
      <header>
        <h2>
          Состав группы <span className="ag-counter">{row.members.length} INC</span>
        </h2>
        <Button view="outlined" onClick={() => switchMode(!adding)}>
          {adding ? 'Вернуться к составу' : 'Добавить INC'}
        </Button>
      </header>
      <div className="mcc-field ag-member-search">
        <label htmlFor="ag-member-search">
          {adding ? 'Найти активный INC вне группы' : 'Найти в составе'}
        </label>
        <TextInput
          id="ag-member-search"
          controlRef={searchRef}
          value={query}
          hasClear
          placeholder="Номер, продукт, сервис или симптом"
          onUpdate={(v) => {
            setQuery(v)
            setPage(1)
          }}
        />
      </div>
      {adding && !term ? (
        <p className="ag-meta">Введите номер INC или часть названия продукта.</p>
      ) : !shown.length ? (
        <p className="ag-meta">Подходящих инцидентов нет.</p>
      ) : (
        <>
          <div className="ag-selection-bar">
            <Checkbox
              disabled={!pageKeys.length}
              checked={allChecked}
              indeterminate={partial}
              onUpdate={(on) => pick(pageKeys, on)}
            >
              Выбрать страницу
            </Checkbox>
            {term && candidates.length > shown.length && selected.length < candidates.length && (
              <Button
                size="s"
                view="flat"
                onClick={() =>
                  pick(
                    candidates.filter(selectable).map((i) => i.key),
                    true,
                  )
                }
              >
                Выбрать все найденные ({candidates.length})
              </Button>
            )}
            <span className="ag-meta">
              {(current - 1) * memberPageSize + 1}–{(current - 1) * memberPageSize + shown.length} из{' '}
              {countFormat.format(candidates.length)}
            </span>
          </div>
          <ul className="ag-members">
            {shown.map((i) => (
              <li key={i.key}>
                <Checkbox
                  checked={selectedSet.has(i.key)}
                  disabled={!selectable(i)}
                  onUpdate={(on) => pick([i.key], on)}
                  controlProps={{'aria-label': 'Выбрать ' + i.id}}
                />
                <div className="ag-member-main">
                  <Link href={incidentHref(i.key)}>{i.id}</Link>
                  <span>{i.title}</span>
                  <small>
                    {[i.product, i.service && i.service !== i.product ? i.service : '', i.team]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </div>
                <div className="ag-member-context">
                  {adding && row.group.excluded.includes(i.key) && <small>Ранее исключён</small>}
                  {adding && otherGroups.has(i.key) && (
                    <small>Будет перенесён из группы «{otherGroups.get(i.key)}»</small>
                  )}
                  {!adding && row.group.included.includes(i.key) && <small>Добавлен вручную</small>}
                  {!adding && <Link href={'#itsm/' + encodeURIComponent(i.key)}>Изменить в ITSM</Link>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {candidates.length > memberPageSize && (
        <Pagination
          className="ag-pages"
          page={current}
          pageSize={memberPageSize}
          total={candidates.length}
          compact
          showInput
          onUpdate={setPage}
        />
      )}
      {(selected.length > 0 || feedback) && (
        <div className="ag-selection-bar ag-commit">
          {selected.length > 0 && (
            <>
              {stale ? (
                <>
                  <span role="status">Состав или координатор группы изменились.</span>
                  <Button
                    size="s"
                    view="outlined"
                    onClick={() => {
                      setSelection(new Set())
                      setSeenRevision(row.group.revision)
                    }}
                  >
                    Перечитать состав
                  </Button>
                </>
              ) : (
                <Button view={adding ? 'action' : 'outlined'} disabled={busy} onClick={() => void submit()}>
                  {adding ? 'Добавить выбранные' : 'Исключить выбранные'} ({selected.length})
                </Button>
              )}
              <Button size="s" view="flat-secondary" onClick={() => setSelection(new Set())}>
                Снять выбор
              </Button>
            </>
          )}
          {feedback && <span role="status">{feedback}</span>}
        </div>
      )}
    </section>
  )
}

function GroupDetail({row, incidents}: {row: AttentionRow; incidents: Incident[]}) {
  const {desk, now} = useWorkspace()
  return (
    <div className="ag-detail">
      <Link href="#attention">← Все ситуации</Link>
      <section className="cr-panel ag-panel" aria-label="Карточка группы">
        <header>
          <h2>{row.title}</h2>
          <Owner row={row} />
        </header>
        <div className="ag-metrics">
          <strong>{row.members.length} INC</strong>
          <span>{serviceCount(row)}</span>
          <span>{dueLabel(row.deadline, standNow(desk, now))}</span>
        </div>
        {row.group.method !== 'single' && (
          <p className="ag-meta">
            {
              {
                parent: 'Подтверждённая иерархия ITSM',
                manual: 'Состав координатора',
                evidence: 'Общая зависимость по наблюдениям',
                model: 'Гипотеза модели по наблюдениям',
              }[row.group.method]
            }
          </p>
        )}
        {row.group.evidence.length > 0 && (
          <div>
            <h3>Основания</h3>
            <ul className="ag-evidence">
              {row.group.evidence.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </div>
        )}
        {row.cycle && (
          <div className="ag-cycle">
            <h3>Возврат назначения</h3>
            <Link href={incidentHref(row.cycle.item.key)}>{row.cycle.item.id}</Link> ·{' '}
            {row.cycle.teams.join(' → ')}
          </div>
        )}
        <div className="ag-actions">
          <Claim row={row} />
          {row.group.owner && row.group.acceptedAt && (
            <span className="ag-meta">Принято {fullTime(standNow(desk, row.group.acceptedAt))} МСК</span>
          )}
        </div>
      </section>
      <MemberEditor key={row.id} row={row} incidents={incidents} desk={desk} />
    </div>
  )
}

export function IncidentGroups({incidents, compact = false}: {incidents: Incident[]; compact?: boolean}) {
  const {desk} = useWorkspace()
  const rows = useMemo(() => buildAttentionRows(desk, incidents), [desk, incidents])
  const [query, setQuery] = useState('')
  const selected = compact ? null : new URLSearchParams(location.hash.split('?')[1]).get('group')
  const row = selected ? rows.find((r) => r.id === selected) : undefined
  const backRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected && !compact) backRef.current?.focus({preventScroll: true})
  }, [selected, compact])
  return (
    <div className="ag-container" ref={backRef} tabIndex={-1}>
      {row ? (
        <GroupDetail row={row} incidents={incidents} />
      ) : (
        <>
          {selected && <p role="status">Эта группа больше не активна в выбранном источнике.</p>}
          <GroupList rows={rows} compact={compact} query={query} setQuery={setQuery} />
        </>
      )}
    </div>
  )
}
