import {useEffect, useMemo, useRef, useState} from 'react'
import {Button, Drawer, ThemeProvider} from '@gravity-ui/uikit'
import {Table, useTable, type ColumnDef} from '@gravity-ui/table'
import type {Incident} from '../demoData'
import {dueInstant} from '../desk/types'
import {queues} from '../desk/queueActivity'
import {canonicalIds, clock, sceneAt, start} from './minute'
import {analyzeDemoIncident} from '../agentDemo'
import mark from '../assets/mts-symbol.svg'
import '../control-room/control-room.css'
import {ActivityFeed} from '../control-room/ActivityFeed'
import {ShiftIndicators} from '../control-room/ShiftIndicators'

const idLink = (i: Incident) => (
  <a className="cr-number" href={'#inc/' + i.id}>
    {i.id}
  </a>
)
const cols: ColumnDef<Incident>[] = [
  {accessorKey: 'id', header: 'Инцидент', cell: ({row}) => idLink(row.original)},
  {
    accessorKey: 'title',
    header: 'Продукт и симптом',
    cell: ({row}) => (
      <div className="cr-cell">
        <b>{row.original.product}</b>
        <span>{row.original.title}</span>
      </div>
    ),
  },
  {accessorKey: 'team', header: 'Группа назначения'},
  {accessorKey: 'state', header: 'Статус'},
  {accessorKey: 'due', header: 'Срок, МСК', cell: ({row}) => row.original.due ?? 'Без срока'},
]

function QueueSection({queue, rows, movement}: {
  queue: (typeof queues)[number]; rows: Incident[]; movement:{entered:number; exited:number}
}) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / 5)),
    current = Math.min(page, pages - 1)
  const pageRows = useMemo(() => rows.slice(current * 5, current * 5 + 5), [rows, current])
  const table = useTable({data: pageRows, columns: cols, getRowId: (i) => i.id})
  return (
    <section className={'cr-panel cr-queue q-' + queue.key} id={'q-' + queue.key}>
      <header>
        <h2>
          <i className="cr-dot" />
          {queue.title}
        </h2>
        <div className="cr-section-count">
          <span>За минуту: +{movement.entered} / −{movement.exited}</span>
          <b className="cr-count">{rows.length} сейчас</b>
        </div>
      </header>
      {rows.length > 0 ? (
        <div className="cr-table-scroll">
          <Table table={table} size="s" attributes={{'aria-label': queue.title}} />
        </div>
      ) : (
        <p>Очередь пуста.</p>
      )}
      <div className="cr-pages">
        <span>
          {rows.length ? current * 5 + 1 : 0}–{Math.min(rows.length, current * 5 + 5)} из {rows.length}
        </span>
        <Button
          size="s"
          view="flat"
          disabled={!current}
          aria-label={'Назад · ' + queue.title}
          onClick={() => setPage(current - 1)}
        >
          ←
        </Button>
        <Button
          size="s"
          view="flat"
          disabled={current + 1 >= pages}
          aria-label={'Далее · ' + queue.title}
          onClick={() => setPage(current + 1)}
        >
          →
        </Button>
      </div>
    </section>
  )
}

export default function ControlRoom() {
  const [second, setSecond] = useState(60),
    [running, setRunning] = useState(false),
    [product, setProduct] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    sessionStorage.getItem('mcc-prototype-theme') === 'light' ? 'light' : 'dark',
  )
  const [hash, setHash] = useState(location.hash)
  const [activeSection, setActiveSection] = useState('overview')
  const returnHash = useRef('#overview')
  const scene = useMemo(() => sceneAt(second), [second])
  const feedRows = useMemo(()=>scene.feed.map(m=>({id:m.item.id,kind:m.kind,time:clock(m.second),product:m.item.product,
    title:m.item.title,number:m.item.id,href:'#inc/'+m.item.id})),[scene])
  const playing = running && second < 60
  const [route, id] = hash.slice(1).split('/')
  const selected = route === 'inc' || route === 'analysis' ? scene.records.get(id) : undefined
  const report = useMemo(
    () => (route === 'analysis' && selected ? analyzeDemoIncident(selected) : undefined),
    [route, selected],
  )
  useEffect(() => {
    document.title = 'Пульт смены · MCC'
    const update = () => {
      if (!/^#(?:inc|analysis)\//.test(location.hash)) returnHash.current = location.hash || '#overview'
      setHash(location.hash)
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  useEffect(() => {
    if (!playing) return
    const tick = window.setInterval(() => setSecond((s) => Math.min(60, s + 1)), 170)
    return () => clearInterval(tick)
  }, [playing])
  useEffect(() => {
    const sections = ['overview', 'feed', ...queues.map((q) => 'q-' + q.key)]
    function track() {
      const current = sections
        .filter((id) => (document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= 110)
        .at(-1)
      setActiveSection(current ?? 'overview')
    }
    track()
    window.addEventListener('scroll', track, {passive: true})
    return () => window.removeEventListener('scroll', track)
  }, [])
  function replay() {
    if (second === 60) {
      setSecond(0)
      setRunning(true)
    } else setRunning(!playing)
  }
  function close() {
    history.replaceState(null, '', location.pathname + returnHash.current)
    setHash(returnHash.current)
  }
  const next = scene.nearest
  const minutes = next ? Math.ceil((dueInstant(next)! - start - second * 1000) / 60000) : null
  const item = selected
  return (
    <ThemeProvider theme={theme}>
      <div className={'cr cr-' + theme}>
        <header className="cr-top">
          <a className="cr-brand" href="#overview">
            <img src={mark} alt="МТС" />
            <strong>MCC</strong>
          </a>
          <span className="cr-brand-sub">Центр управления инцидентами</span>
          <div className="cr-strip" aria-label="Критические и движение за минуту">
            <span>Критические <b>{scene.groups.critical.length}</b></span>
            <span>За минуту <b>+{scene.entered}</b> / <b>−{scene.exited}</b></span>
          </div>
          <div className="cr-top-status">
            <span className="cr-live">
              <i />
              Демосмена
            </span>
            <time>
              {clock(second)} <small>МСК</small>
            </time>
            <Button
              size="s"
              view="outlined"
              aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              onClick={() => {
                const t = theme === 'dark' ? 'light' : 'dark'
                setTheme(t)
                sessionStorage.setItem('mcc-prototype-theme', t)
              }}
            >
              <span className="cr-theme-name">{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</span>
              <span className="cr-theme-icon" aria-hidden="true">
                {theme === 'dark' ? '☼' : '☾'}
              </span>
            </Button>
          </div>
        </header>
        <div className="cr-shell">
          <aside className="cr-nav">
            <nav aria-label="Разделы пульта">
              <a href="#overview" aria-current={activeSection === 'overview' ? 'location' : undefined}>
                <span aria-hidden="true">▦</span>Обзор смены
              </a>
              <a href="#feed" aria-current={activeSection === 'feed' ? 'location' : undefined}>
                <span aria-hidden="true">≋</span>Лента событий
              </a>
              <h2>Очереди смены</h2>
              {queues.map((q) => (
                <a
                  key={q.key}
                  className={'q-' + q.key}
                  href={'#q-' + q.key}
                  aria-current={activeSection === 'q-' + q.key ? 'location' : undefined}
                >
                  <i className="cr-dot" />
                  {q.title}
                  <b>{scene.groups[q.key].length}</b>
                </a>
              ))}
            </nav>
            <div className="cr-nav-bottom">
              <div className="cr-lab">
                <i className="cr-dot" />
                Сценарий смены
              </div>
              <span className="cr-muted">21 ноября · 12:57–12:58</span>
              <a href="/#overview">Рабочий дашборд ↗</a>
            </div>
          </aside>
          <main className="cr-work" id="overview">
            <div className="cr-heading">
              <h1>Обзор смены</h1>
              <Button size="m" view="outlined" onClick={replay}>
                {playing ? 'Ⅱ Приостановить' : second === 60 ? '↻ Повторить минуту' : '▷ Продолжить'}
              </Button>
            </div>
            <ShiftIndicators count={scene.groups.critical.length} entered={scene.entered} exited={scene.exited}
              trend={scene.trend} ins={scene.ins} outs={scene.outs} at={clock} next={next} minutes={minutes}
              incidentHref={item => '#inc/'+item.id} />
            <div className="cr-live-grid">
              <ActivityFeed rows={feedRows} product={product} clearProduct={() => setProduct('')} />
              <div className="cr-sidepanels">
                <section className="cr-panel cr-products">
                  <header>
                    <h2>По продуктам</h2>
                    <span className="cr-muted">Критические</span>
                  </header>
                  <div className="cr-product-labels">
                    <span>Продукт</span>
                    <span>Вход / выход</span>
                    <span>Сейчас</span>
                  </div>
                  {scene.products.map((p) => (
                    <a
                      key={p.name}
                      href="#feed"
                      aria-label={'События продукта ' + p.name}
                      onClick={() => setProduct(p.name)}
                      className={product === p.name ? 'cr-product selected' : 'cr-product'}
                    >
                      <span>{p.name}</span>
                      <span className="cr-product-moves">
                        <b>+{p.entered}</b> / −{p.exited}
                      </span>
                      <strong>{p.active}</strong>
                    </a>
                  ))}
                </section>
                <section className="cr-panel cr-agent">
                  <header>
                    <h2>Разбор агента</h2>
                    <span className="cr-muted cr-mono">12:42 МСК</span>
                  </header>
                  <div className="cr-agent-product">
                    <i className="cr-dot" />
                    МТС Маркет · Оплата
                  </div>
                  <b>Задержка подтверждения оплаты</b>
                  <p>Фоновая сверка заняла 18 из 24 соединений с БД.</p>
                  <a className="cr-inspect-link" href="#analysis/INC000021940112">
                    Проверить гипотезу →
                  </a>
                </section>
              </div>
            </div>
            <div className="cr-queue-head">
              <h2>Очереди смены</h2>
              <span className="cr-muted">по приоритету и сроку</span>
            </div>
            {queues.map((q) => (
              <QueueSection key={q.key} queue={q} rows={scene.groups[q.key]} movement={scene.movement[q.key]} />
            ))}
          </main>
        </div>
        <Drawer
          open={Boolean(item)}
          placement="right"
          onOpenChange={(v) => {
            if (!v) close()
          }}
        >
          {item && (
            <section className="cr-inspector" aria-label="Карточка прототипа">
              <header>
                <span className="cr-mono">{item.id}</span>
                <Button size="s" view="outlined" onClick={close}>
                  Закрыть
                </Button>
              </header>
              <h2>{item.title}</h2>
              <dl>
                {[
                  ['Продукт', item.product],
                  ['Статус', item.state],
                  ['Приоритет', ['Низкий', 'Средний', 'Высокий', 'Наивысший'][item.priority - 1]],
                  ['Ответственная команда', item.team],
                  ['Регистрация', item.registered + ' МСК'],
                  ['Срок решения', item.due ? item.due + ' МСК' : 'Без срока'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <h3>События за минуту</h3>
              {scene.feed.some((m) => m.item.id === item.id) ? (
                scene.feed
                  .filter((m) => m.item.id === item.id)
                  .map((m) => (
                    <p key={m.kind}>
                      {clock(m.second)} ·{' '}
                      {m.kind === 'in' ? 'Поступил новый критический INC' : 'Сбой устранён'}
                    </p>
                  ))
              ) : (
                <p>Переходов за эту минуту не было.</p>
              )}
              {report ? (
                <div className="cr-report">
                  <h3>Свидетельства</h3>
                  <ol>
                    {report.evidence.map((e) => (
                      <li key={e.source}>
                        <strong>{e.source}</strong>
                        <span>{e.finding}</span>
                        <code>{e.record}</code>
                      </li>
                    ))}
                  </ol>
                  <h3>{report.hypothesis ? 'Гипотеза' : 'Недостаточно данных'}</h3>
                  <p>{report.hypothesis ?? report.question}</p>
                  <h3>Следующая проверка</h3>
                  <p>{report.next}</p>
                  <p>{report.recipient}</p>
                </div>
              ) : (
                canonicalIds.has(item.id) && (
                  <Button href={'#analysis/' + item.id} view="outlined">
                    Разобрать причину
                  </Button>
                )
              )}
              {canonicalIds.has(item.id) && (
                <Button href={'/incidents/' + item.id + '?source=volume'} view="action">
                  Открыть полную карточку →
                </Button>
              )}
            </section>
          )}
        </Drawer>
      </div>
    </ThemeProvider>
  )
}
