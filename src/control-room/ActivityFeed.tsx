import {useMemo, useState} from 'react'
import {Button, TextInput} from '@gravity-ui/uikit'

const kinds = {
  in: ['Новые', '↗ Новый крит'],
  out: ['Устранены', '✓ Устранён'],
  assign: ['Назначения', '↳ Назначение'],
  due: ['Сроки', '◷ Срок близко'],
} as const

export interface FeedRow {
  id: string
  kind: keyof typeof kinds
  time: string
  product: string
  title: string
  number: string
  href: string
}

export function ActivityFeed({
  rows,
  product = '',
  clearProduct,
  journal = false,
}: {
  rows: FeedRow[]
  product?: string
  clearProduct?: () => void
  journal?: boolean
}) {
  const [kind, setKind] = useState('all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(9)
  const found = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('ru')
    return rows.filter(
      (r) =>
        (kind === 'all' || r.kind === kind) &&
        (!product || r.product === product) &&
        (!term || [r.number, r.title, r.product].some((v) => v.toLocaleLowerCase('ru').includes(term))),
    )
  }, [rows, kind, product, query])
  const options = Object.entries(kinds)
    .filter(([key]) => journal || key === 'in' || key === 'out')
    .map(([key, [name]]) => [key, name])
  return (
    <section className="cr-panel cr-feed" id="feed" tabIndex={-1} aria-label="Лента событий">
      <header>
        <h2>Лента событий</h2>
        <span className="cr-muted cr-mono">{found.length.toLocaleString('ru-RU')} событий</span>
      </header>
      <div className="cr-feed-tools">
        <div className="cr-choices" role="group" aria-label="Тип события">
          {[['all', 'Все'], ...options].map(([key, name]) => (
            <Button
              key={key}
              size="s"
              view={kind === key ? 'normal' : 'flat-secondary'}
              selected={kind === key}
              onClick={() => {
                setKind(key)
                setLimit(9)
              }}
            >
              {name}
            </Button>
          ))}
        </div>
        <TextInput
          size="s"
          value={query}
          onUpdate={(q) => {
            setQuery(q)
            setLimit(9)
          }}
          hasClear
          placeholder="Найти INC или продукт"
          controlProps={{'aria-label': 'Поиск по ленте'}}
        />
      </div>
      {product && clearProduct && (
        <Button size="s" view="outlined" onClick={clearProduct} aria-label="Снять фильтр продукта">
          {product} ×
        </Button>
      )}
      <ol className="cr-events">
        {found.slice(0, limit).map((r) => (
          <li key={r.id}>
            <a href={r.href} className={'cr-event ' + r.kind}>
              <time>{r.time}</time>
              <span className="cr-kind">{kinds[r.kind][1]}</span>
              <span className="cr-event-main">
                <b>{r.product}</b>
                <span>{r.title}</span>
              </span>
              <span className="cr-event-id">{r.number}</span>
            </a>
          </li>
        ))}
      </ol>
      {!found.length && <p className="cr-muted">{rows.length ? 'Совпадений нет.' : 'Событий пока нет.'}</p>}
      {journal ? (
        <a
          className="cr-inspect-link"
          href={
            '#events?' +
            new URLSearchParams({
              ...(query ? {q: query} : {}),
              ...(product ? {product} : {}),
              ...(kind !== 'all' ? {kind: kind === 'in' ? 'new' : kind === 'out' ? 'restore' : kind} : {}),
            })
          }
        >
          Весь журнал →
        </a>
      ) : (
        limit < found.length && (
          <Button size="s" view="flat-secondary" onClick={() => setLimit(limit + 15)}>
            Показать ещё {Math.min(15, found.length - limit)} ↓
          </Button>
        )
      )}
    </section>
  )
}
