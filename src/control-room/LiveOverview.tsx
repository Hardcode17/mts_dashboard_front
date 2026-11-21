import {Fragment, useMemo, useState, type ReactNode} from 'react'
import {Button, Card, Checkbox, Flex, Text} from '@gravity-ui/uikit'
import type {Incident, ShiftEvent} from '../demoData'
import type {Activity} from '../desk/queueActivity'
import {useWorkspace} from '../desk/context'
import {dueInstant, standNow, moscowTime} from '../desk/types'
import {ShiftIndicators} from './ShiftIndicators'
import {minuteSeries} from './shiftSummary'
import {ActivityFeed} from './ActivityFeed'
import {IncidentGroups} from './IncidentGroups'
import {ShiftCharts} from '../ShiftCharts'
import {
  defaultOverviewOrder, moveOverviewBlock, overviewBlockTitles, readHiddenOverviewBlocks, readOverviewOrder,
  saveHiddenOverviewBlocks, saveOverviewOrder, type OverviewBlockId, type OverviewMoveDirection,
} from '../overviewLayout'

export function LiveOverview({
  critical,
  activity,
  incidents,
  events,
  byKey,
  wall,
  children,
  criticalTiles,
  soonHref,
}: {
  critical: Incident[]
  activity: Activity
  incidents: Incident[]
  events: ShiftEvent[]
  byKey: Map<string, Incident>
  wall: boolean
  soonHref: string
  children: ReactNode
  criticalTiles: ReactNode
}) {
  const {desk, now} = useWorkspace()
  const [editing, setEditing] = useState(false)
  const [order, setOrder] = useState(() => readOverviewOrder())
  const [hidden, setHidden] = useState(() => readHiddenOverviewBlocks())
  const [status, setStatus] = useState('')
  function move(id: OverviewBlockId, direction: OverviewMoveDirection) {
    setOrder(saveOverviewOrder(moveOverviewBlock(order, id, direction)))
    setStatus('Блок «' + overviewBlockTitles[id] + '» перемещён ' + (direction < 0 ? 'выше.' : 'ниже.'))
  }
  function changeVisibility(ids: OverviewBlockId[]) {
    setHidden(ids)
    saveHiddenOverviewBlocks(ids)
  }
  const feedRows = useMemo(
    () =>
      events.map((e) => {
        const i = byKey.get(e.key)
        const kind = e.kind === 'new' ? ('in' as const) : e.kind === 'restore' ? ('out' as const) : e.kind
        return {
          id: e.id,
          kind,
          time: e.time,
          product: i?.product ?? e.key,
          number: i?.id ?? e.key,
          title: i?.title && !e.change.includes(i.title) ? i.title + ' · ' + e.change : e.change,
          href: '#drawer/' + e.key,
        }
      }),
    [events, byKey],
  )
  const stamp = standNow(desk, now)
  const count = desk.apiCounts?.critical ?? critical.length
  const series = useMemo(() => minuteSeries(count, activity, now), [count, activity, now])
  const nearest = useMemo(
    () =>
      critical.reduce<Incident | undefined>((best, i) => {
        const due = dueInstant(i)
        return due !== null && (!best || due < dueInstant(best)!) ? i : best
      }, undefined),
    [critical],
  )
  const blocks = {
    stats: <ShiftIndicators
        count={count}
        entered={activity.entered}
        exited={activity.exited}
        {...series}
        at={(sec, seconds = true) => {
          const time = stamp - (60 - sec) * 1000
          return seconds ? new Date(time + 10800000).toISOString().slice(11, 19) : moscowTime(time)
        }}
        next={nearest}
        minutes={nearest ? Math.ceil((dueInstant(nearest)! - stamp) / 60000) : null}
        incidentHref={(i) => '#incident/' + i.key}
      />,
    charts: !wall && <ShiftCharts incidents={incidents} critical={critical} soonHref={soonHref} />,
    critical: criticalTiles,
  }
  return (
    <div className={wall ? 'ops-wall-summary' : 'overview-summary'}>
      {!wall && <Button className="overview-settings-toggle" view={editing ? 'flat-secondary' : 'outlined'} size="s"
        aria-expanded={editing} aria-controls={editing ? 'overview-layout-settings' : undefined}
        onClick={() => setEditing(!editing)}>{editing ? 'Готово' : 'Настроить порядок блоков'}</Button>}
      {!wall && editing && (
        <Card id="overview-layout-settings" view="outlined" className="overview-layout-config" role="region" aria-labelledby="overview-layout-title">
          <Flex justifyContent="space-between" alignItems="baseline" wrap gap="spacing-2">
            <Text as="h2" id="overview-layout-title" variant="subheader-2">Порядок блоков</Text>
            <Button size="s" view="flat-secondary" onClick={() => {
              setOrder(saveOverviewOrder(defaultOverviewOrder))
              changeVisibility([])
              setStatus('Восстановлена исходная сводка.')
            }}>Сбросить по умолчанию</Button>
          </Flex>
          <ol aria-label="Текущий порядок блоков">
            {order.map((id, index) => <li key={id}>
              <Checkbox checked={!hidden.includes(id)} onUpdate={visible => changeVisibility(visible ? hidden.filter(item => item !== id) : [...hidden, id])}>
                {overviewBlockTitles[id]}
              </Checkbox>
              <Flex gap="spacing-1">
                <Button size="s" view="outlined" disabled={index === 0} aria-label={'Переместить блок «' + overviewBlockTitles[id] + '» выше'} onClick={() => move(id, -1)}>Выше</Button>
                <Button size="s" view="outlined" disabled={index === order.length - 1} aria-label={'Переместить блок «' + overviewBlockTitles[id] + '» ниже'} onClick={() => move(id, 1)}>Ниже</Button>
              </Flex>
            </li>)}
          </ol>
          <Text color="secondary" variant="caption-2" role="status">{status || 'Настройки сохраняются на этом устройстве.'}</Text>
        </Card>
      )}
      {(wall ? defaultOverviewOrder : order).map(id => <Fragment key={id}>
        {(wall || !hidden.includes(id)) && blocks[id]}
        {id === 'stats' && <IncidentGroups incidents={incidents} compact/>}
      </Fragment>)}
      {children}
      <ActivityFeed rows={feedRows} journal />
    </div>
  )
}
