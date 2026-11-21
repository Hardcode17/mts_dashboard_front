import {useEffect, useMemo} from 'react'
import {Button} from '@gravity-ui/uikit'
import type {Incident} from '../demoData'
import {useWorkspace} from '../desk/context'
import {active, standNow, moscowTime, type Desk} from '../desk/types'
import {groupIncidents, queues, queueActivity} from '../desk/queueActivity'
import {buildAttentionRows, serviceCount, wallHighlights, type AttentionRow} from '../control-room/attention'
import {MonitoringCharts} from './MonitoringCharts'
import type {MonitoringSummary} from './summary'
import {useMonitoringSummary} from './useMonitoringSummary'
import {usesRealBackend} from '../shared/api/mode'
import {exitMonitor, monitorMode} from './mode'
import mark from '../assets/mts-symbol.svg'
import './outage-wall.css'

function summarize(desk: Desk, incidents: Incident[], attention: AttentionRow[]): MonitoringSummary {
  const groups = groupIncidents(incidents)
  const priorities = [4, 3, 2, 1].map((priorityId) => ({priorityId, count: 0}))
  let activeCount = 0
  for (const item of incidents)
    if (!item.absent && active(item)) {
      activeCount++
      if (item.priority >= 1 && item.priority <= 4) priorities[4 - item.priority].count++
    }
  const load = new Map<string, number>()
  for (const row of attention) {
    const name = row.ownerState === 'owned' ? row.ownerLabel.replace(/^Ведёт /, '') : 'Без принятия'
    load.set(name, (load.get(name) ?? 0) + 1)
  }
  const counts = {
    critical: groups.critical.length,
    high: groups.high.length,
    coordinators: groups.assigned.length,
    research: groups.research.length,
  }
  const history = desk.monitorHistory ?? []
  const last = history.at(-1)
  // Between five-minute samples, display the actual current counts at the time of observation.
  const changed =
    !last || (Object.keys(counts) as (keyof typeof counts)[]).some((key) => counts[key] !== last[key])
  const at = new Date(standNow(desk, Date.now())).toISOString()
  const timeline =
    changed && !desk.sourceError && (desk.mode === 'volume' || desk.lastImport)
      ? [...history, {at, ...counts}]
      : history
  return {
    updatedAt: desk.lastImport ? new Date(desk.lastImport).toISOString() : null,
    activeCount,
    counts,
    timeline,
    priorities: priorities.filter((p) => p.count > 0),
    coordinatorLoad: [...load].map(([name, count]) => ({name, count})),
  }
}

export default function OutageWall({theme, incidents}: {theme: 'light' | 'dark'; incidents: Incident[]}) {
  const {desk, now, checked, error} = useWorkspace()
  const rows = useMemo(() => buildAttentionRows(desk, incidents), [desk, incidents])
  const monitoring = useMonitoringSummary(usesRealBackend)
  const summary = useMemo(() => usesRealBackend ? monitoring.data : summarize(desk, incidents, rows), [desk, incidents, rows, monitoring.data])
  const {visible, newest, signal} = useMemo(() => wallHighlights(rows, desk.signals), [rows, desk.signals])
  const activity = useMemo(() => queueActivity(desk.movements, now).critical, [desk.movements, now])
  const stamp = standNow(desk, now)
  const updated = summary?.updatedAt ? Date.parse(summary.updatedAt) : null
  const lastCheck = usesRealBackend ? monitoring.lastSuccess : checked
  const stale = Boolean(error || desk.sourceError || !checked || now - checked > 15000 ||
    (usesRealBackend && (monitoring.connection !== 'ready' || updated === null || now - updated > 60000)))
  const nearest = rows.reduce<number | null>(
    (min, r) => (r.deadline !== null && (min === null || r.deadline < min) ? r.deadline : min),
    null,
  )
  const remaining = nearest === null ? null : Math.ceil((nearest - stamp) / 60000)
  const source = desk.mode === 'case' ? 'ITSM' : 'Демосмена'
  useEffect(() => {
    document.title = 'Видеостена смены · MCC'
    window.scrollTo(0, 0)
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitMonitor()
    }
    const fullscreen = () => {
      if (!document.fullscreenElement) exitMonitor()
    }
    document.addEventListener('fullscreenchange', fullscreen)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('fullscreenchange', fullscreen)
      window.removeEventListener('keydown', key)
      if (!monitorMode() && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])
  const counts = summary?.counts ?? (!desk.apiBeforeFirstSuccess ? desk.apiCounts : undefined)
  const sourceLabel = usesRealBackend && !summary
    ? monitoring.connection === 'loading' ? 'Загрузка мониторинга' : 'Мониторинг недоступен'
    : stale ? 'Данные устарели' : source + ' · данные свежие'
  const last = desk.events[0]
  return (
    <main className={'cr cr-' + theme + ' outage-wall'} aria-label="Видеостена смены">
      <header className="ow-head">
        <div>
          <img src={mark} alt="МТС" />
          <h1>Монитор смены</h1>
        </div>
        <div>
          <span className="ow-total">
            Активных INC <b>{summary?.activeCount ?? '—'}</b>
          </span>
          <span className={'ow-fresh' + (stale ? ' stale' : '')}>
            {sourceLabel}
            {lastCheck ? ' · ' + moscowTime(lastCheck) + ' МСК' : ''}
          </span>
          <time>{moscowTime(stamp)} МСК</time>
          <Button size="s" view="outlined" onClick={exitMonitor}>
            Выйти · Esc
          </Button>
        </div>
      </header>
      <section className="ow-counts" aria-label="Очереди смены">
        {queues.map((q) => (
          <div key={q.key} className={'ow-count q-' + q.key}>
            <h2>{q.title}</h2>
            <strong>{counts?.[q.key === 'assigned' ? 'coordinators' : q.key] ?? '—'}</strong>
            {q.key === 'critical' && (
              <span>
                За минуту <b>+{activity.entered}</b> / <b>−{activity.exited}</b>
              </span>
            )}
          </div>
        ))}
      </section>
      <section className="ow-incidents" aria-label="Аварии и координаторы">
        <header>
          <h2>Аварии смены</h2>
          <span>
            {rows.filter((r) => r.ownerState !== 'owned').length} без принявшего · всего {rows.length}
          </span>
        </header>
        <div className="ow-rows">
          {visible.map((r) => (
            <article key={r.id} className={'ow-row ' + r.ownerState} data-group={r.id}>
              <div>
                <b>{r.title}</b>
                <span>
                  {r === newest && signal && <em className="ow-new-signal">
                    {now - signal.at < 60_000 ? 'Новый крит' : 'Сигнал'} · {moscowTime(standNow(desk,signal.at))}
                  </em>}
                  {r.members.length === 1 ? r.members[0].id : r.members.length + ' INC'} · {serviceCount(r)}
                  {r.cycle ? ' · Назначение по кругу' : ''}
                </span>
              </div>
              <strong>{r.ownerLabel}</strong>
            </article>
          ))}
          {!rows.length && <p>Ситуаций, требующих внимания, нет.</p>}
        </div>
        {rows.length > visible.length && <small>Ещё {rows.length - visible.length} в рабочем списке</small>}
      </section>
      {summary
        ? <MonitoringCharts summary={summary} theme={theme} reducedMotion />
        : <p role="status">{monitoring.error || 'Загружаем графики мониторинга…'}</p>}
      <footer className="ow-footer">
        {stale ? (
          <strong>
            {monitoring.error || ('Последняя успешная проверка — ' + (lastCheck ? moscowTime(lastCheck) + ' МСК' : 'ожидаем данные'))}
          </strong>
        ) : (
          <span>{last ? last.time + ' · ' + last.change : 'Ожидание новых событий'}</span>
        )}
        <span>
          {remaining === null
            ? 'Без известного срока'
            : (remaining < 0 ? 'Просрочка ' : 'До ближайшего срока ') + Math.abs(remaining) + ' мин'}
        </span>
      </footer>
    </main>
  )
}
