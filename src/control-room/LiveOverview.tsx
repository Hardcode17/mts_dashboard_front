import {useMemo, type ReactNode} from 'react'
import type {Incident, ShiftEvent} from '../demoData'
import type {Activity} from '../desk/queueActivity'
import {useWorkspace} from '../desk/context'
import {dueInstant, standNow, moscowTime} from '../desk/types'
import {ShiftIndicators} from './ShiftIndicators'
import {minuteSeries} from './shiftSummary'
import {ActivityFeed} from './ActivityFeed'
import {IncidentGroups} from './IncidentGroups'
import {ShiftCharts} from '../ShiftCharts'

export function LiveOverview({
  critical,
  activity,
  incidents,
  events,
  byKey,
  wall,
  children,
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
}) {
  const {desk, now} = useWorkspace()
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
  const series = useMemo(() => minuteSeries(critical.length, activity, now), [critical.length, activity, now])
  const nearest = useMemo(
    () =>
      critical.reduce<Incident | undefined>((best, i) => {
        const due = dueInstant(i)
        return due !== null && (!best || due < dueInstant(best)!) ? i : best
      }, undefined),
    [critical],
  )
  return (
    <div className={wall ? 'ops-wall-summary' : 'overview-summary'}>
      <ShiftIndicators
        count={critical.length}
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
      />
      <IncidentGroups incidents={incidents} compact/>
      {!wall && <ShiftCharts incidents={incidents} critical={critical} soonHref={soonHref} />}
      {children}
      <ActivityFeed rows={feedRows} journal />
    </div>
  )
}
