import {useEffect, useState} from 'react'
import {Button, Loader, Text} from '@gravity-ui/uikit'
import mtsSymbol from '../assets/mts-symbol.svg'
import {MonitoringCharts} from './MonitoringCharts.tsx'
import {MONITORING_POLL_MS, useMonitoringSummary, type MonitoringState} from './useMonitoringSummary.ts'
import type {MonitoringCounts} from './summary.ts'
import './monitoring.css'

const numberFormat = new Intl.NumberFormat('ru-RU')
const updatedFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  dateStyle: 'short',
  timeStyle: 'medium',
})
const timeFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

type FreshnessTone = 'fresh' | 'aging' | 'stale' | 'offline' | 'unknown'

interface Freshness {
  tone: FreshnessTone
  label: string
}

const categoryDefinitions: {key: keyof MonitoringCounts; title: string; hint: string; tone: string}[] = [
  {key: 'critical', title: 'Критические', hint: 'Приоритет 4', tone: 'critical'},
  {key: 'high', title: 'Высокий приоритет', hint: 'Приоритет 3', tone: 'high'},
  {key: 'coordinators', title: 'На координаторах', hint: 'КЦ ИТ Координаторы Массовых Инцидентов', tone: 'coordinators'},
  {key: 'research', title: 'Исследование ситуации', hint: 'StateEnum = Research', tone: 'research'},
]

function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}

function freshness(state: MonitoringState, now: number): Freshness {
  if (!state.data) {
    return state.connection === 'loading'
      ? {tone: 'unknown', label: 'Подключаемся'}
      : {tone: 'offline', label: 'Нет данных'}
  }
  if (state.connection === 'stale') return {tone: 'stale', label: 'Нет обновлений'}
  const source = state.data.updatedAt ? Date.parse(state.data.updatedAt) : null
  if (source === null || !Number.isFinite(source)) return {tone: 'unknown', label: 'Свежесть неизвестна'}
  const age = Math.max(0, now - source)
  if (age <= 15_000) return {tone: 'fresh', label: 'Данные свежие'}
  if (age <= 60_000) return {tone: 'aging', label: 'Данные обновляются'}
  return {tone: 'stale', label: 'Данные устарели'}
}

function formatUpdated(value: string | null): string {
  if (!value) return 'Не передано'
  const instant = Date.parse(value)
  return Number.isFinite(instant) ? updatedFormat.format(instant) : 'Не передано'
}

function timeElement(instant: number | null, fallback = '—') {
  if (instant === null || !Number.isFinite(instant)) return fallback
  return <time dateTime={new Date(instant).toISOString()}>{timeFormat.format(instant)}</time>
}

export function MonitoringPage({theme, onExit}: {
  theme: 'light' | 'dark'
  onExit: () => void
}) {
  const state = useMonitoringSummary()
  const now = useNow()
  const reducedMotion = useReducedMotion()
  const freshnessState = freshness(state, now)

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Мониторинг инцидентов · MCC'
    window.scrollTo(0, 0)
    document.getElementById('monitor-title')?.focus({preventScroll: true})
    return () => {
      document.title = previousTitle
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onExit()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onExit])

  const data = state.data
  const lastSuccess = state.lastSuccess
  const updatedInstant = data?.updatedAt ? Date.parse(data.updatedAt) : null

  return <main
    className="monitor"
    aria-labelledby="monitor-title"
    aria-busy={state.connection === 'loading'}
    data-connection={state.connection}
    data-freshness={freshnessState.tone}
  >
    <header className="monitor-topbar">
      <div className="monitor-brand">
        <img className="monitor-mark" src={mtsSymbol} alt="МТС" />
        <div className="monitor-brand-text">
          <Text as="h1" id="monitor-title" variant="display-3" tabIndex={-1}>Мониторинг инцидентов</Text>
          <Text as="p" color="secondary" variant="body-2">Центр управления инцидентами · режим большого экрана</Text>
        </div>
      </div>
      <div className="monitor-topbar-actions">
        <div className="monitor-freshness" data-tone={freshnessState.tone} role="group" aria-label="Свежесть данных">
          <span className="monitor-freshness-dot" aria-hidden="true" />
          <div>
            <Text variant="subheader-2">{freshnessState.label}</Text>
            <Text as="p" color="secondary" variant="caption-2">
              {lastSuccess === null ? 'Первая проверка ещё не завершилась' : <>Проверено {timeElement(lastSuccess)} МСК</>}
            </Text>
          </div>
        </div>
        <Button view="outlined" size="l" onClick={onExit} aria-keyshortcuts="Escape" title="Выйти из монитора (Esc)">
          Выйти <span className="monitor-esc" aria-hidden="true">· Esc</span>
        </Button>
      </div>
    </header>

    {state.error && <div className="monitor-connection" role="status" data-state={data ? 'stale' : 'offline'}>
      <span className="monitor-connection-dot" aria-hidden="true" />
      <div>
        <Text variant="subheader-2">Связь с мониторингом потеряна</Text>
        <Text as="p" color="secondary" variant="body-1">
          Повторяем подключение каждые {MONITORING_POLL_MS / 1000} секунд. {state.error}
        </Text>
      </div>
    </div>}

    <section className="monitor-summary" aria-labelledby="monitor-active-title">
      <div className="monitor-total">
        <Text as="h2" id="monitor-active-title" variant="subheader-2">Активных инцидентов</Text>
        <Text as="p" className="monitor-total-value" variant="display-1">
          {data ? numberFormat.format(data.activeCount) : '—'}
        </Text>
        <Text as="p" className="monitor-total-note" variant="body-1">
          Последнее обновление: {data ? formatUpdated(data.updatedAt) : '—'}{updatedInstant !== null ? ' МСК' : ''}
        </Text>
      </div>
      <dl className="monitor-meta">
        <div>
          <dt>Последнее обновление</dt>
          <dd>{data ? <>{updatedInstant !== null ? timeElement(updatedInstant) : 'Не передано'}{updatedInstant !== null ? ' МСК' : ''}</> : '—'}</dd>
        </div>
        <div>
          <dt>Последняя успешная проверка</dt>
          <dd>{timeElement(lastSuccess)}</dd>
        </div>
        <div>
          <dt>Индикатор свежести</dt>
          <dd data-tone={freshnessState.tone}>{freshnessState.label}</dd>
        </div>
      </dl>
    </section>

    <section className="monitor-categories" aria-label="Категории активных инцидентов">
      {categoryDefinitions.map((category) => <article key={category.key} className="monitor-category" data-tone={category.tone}>
        <Text as="h2" variant="subheader-2">{category.title}</Text>
        <Text as="p" className="monitor-category-count" variant="display-1">
          {data ? numberFormat.format(data.counts[category.key]) : '—'}
        </Text>
        <Text as="p" color="secondary" variant="body-1">{category.hint}</Text>
      </article>)}
    </section>

    {data
      ? <MonitoringCharts summary={data} theme={theme} reducedMotion={reducedMotion} />
      : <section className="monitor-boot" aria-label="Загрузка мониторинга">
        {state.connection === 'loading' ? <><Loader size="l" /><Text variant="subheader-2">Подключаемся к сводке мониторинга…</Text></> : <Text variant="subheader-2">Сводка недоступна. Ожидаем восстановление связи.</Text>}
      </section>}

    <footer className="monitor-footer">
      <Text color="secondary" variant="body-1">Обновление каждые {MONITORING_POLL_MS / 1000} секунд · категории могут пересекаться</Text>
      <Text color="secondary" variant="body-1">Только просмотр · для выхода нажмите Esc</Text>
    </footer>
  </main>
}
