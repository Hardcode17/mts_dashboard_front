import {cardChanges, historyFields, type TrackedField} from '../incidentHistory.ts'
import {coordinatorGroup, fullTime, moscowClockInstant, moscowTime, priorityNames, standNow, type Desk, type Incident, type ShiftEvent} from './types.ts'
import {isInvestigationReport, investigationHref} from './analysisLinks.ts'

export function historyValue(field: TrackedField, value: string | null | undefined) {
  if (value === undefined) return 'Нет сведений'
  if (value === null) return 'Не задано'
  if (field === 'due' && value.includes('T')) return fullTime(Date.parse(value)) + ' МСК'
  if (field === 'priority') return priorityNames[Number(value) - 1] ?? value
  return value
}

export function cardVersions(desk: Desk, key: string) {
  return desk.revisions[key] ?? []
}

export function shiftEventTime(event: ShiftEvent, shiftStart: number) {
  return event.at ?? moscowClockInstant(event.time, shiftStart)
}

export function revisionTime(desk: Desk, stamp: string, observed: boolean) {
  if (!stamp.includes('T')) return moscowClockInstant(stamp, desk.clockBase ?? desk.started)
  const at = Date.parse(stamp)
  return observed ? standNow(desk, at) : at
}

export type TimelineCategory = 'ITSM' | 'Смена' | 'Комната'
type Changes = ReturnType<typeof cardChanges>[number]['changes']
export interface TimelineEntry {
  id: string
  at: number
  source: string
  category: TimelineCategory
  text: string
  title?: string
  href?: string
  changes?: Changes
  timeBasis?: 'source' | 'observed' | 'clockOnly'
  observedAt?: number
  journalIds?: string[]
}

const closedStates = new Set(['Завершён', 'Завершен', 'Закрыт', 'Исследование ситуации'])

function matchingKinds(changes: Changes): ShiftEvent['kind'][] {
  return changes.flatMap(({field, before, after}): ShiftEvent['kind'][] => {
    if (field === 'team' && (after === coordinatorGroup || after === 'Координаторы МИ')) return ['assign']
    if (field === 'priority' && after === '4') return ['new']
    if (field === 'state') {
      if (closedStates.has(after ?? '') && !closedStates.has(before ?? '')) return ['restore']
      if (closedStates.has(before ?? '') && !closedStates.has(after ?? '')) return ['new']
    }
    return []
  })
}

export function cardTimeline(desk: Desk, item: Incident) {
  const registeredAt = item.registeredAt
  const rows: TimelineEntry[] = registeredAt == null ? [] : [
    {
      id: 'registered',
      at: registeredAt,
      source: 'ITSM',
      category: 'ITSM',
      text: 'Регистрация инцидента',
      timeBasis: 'source',
    },
  ]
  const atShift = (at: number) => standNow(desk, at)
  // Both views describe a single transition when its type and observation instant agree.
  const revisionsByEvent = new Map<string, TimelineEntry>()
  const revisions = cardChanges(cardVersions(desk, item.key)).reverse()
  for (const [index, v] of revisions.entries()) {
    const observedAt = revisionTime(desk, v.observedAt, true)
    const at = v.changedAt ? revisionTime(desk, v.changedAt, false) : observedAt
    const row: TimelineEntry = {
      id: 'revision-' + index,
      at,
      observedAt,
      timeBasis: v.changedAt ? 'source' : 'observed',
      category: 'ITSM',
      source: 'ITSM',
      changes: v.changes,
      title:
        v.changes.length === 1
          ? v.changes[0].field === 'solution'
            ? 'Изменён текст решения'
            : historyFields[v.changes[0].field] + ' · ' + historyValue(v.changes[0].field, v.changes[0].after)
          : 'Изменены поля · ' + v.changes.map((c) => historyFields[c.field]).join(', '),
      text: v.changes
        .map(
          (c) =>
            historyFields[c.field] +
            ': ' +
            historyValue(c.field, c.before) +
            ' → ' +
            historyValue(c.field, c.after),
        )
        .join(' · '),
    }
    rows.push(row)
    for (const kind of matchingKinds(v.changes)) {
      revisionsByEvent.set('observed/' + observedAt + '/' + kind, row)
      revisionsByEvent.set('source/' + at + '/' + kind, row)
    }
  }
  for (const event of desk.events) {
    if (event.key !== item.key) continue
    const at = shiftEventTime(event, desk.clockBase ?? desk.started)
    const revision = revisionsByEvent.get((event.at === undefined ? 'source/' : 'observed/') + at + '/' + event.kind)
    if (revision) {
      revision.journalIds ??= []
      if (!revision.journalIds.length) revision.title = event.change
      revision.journalIds.push(event.id)
    } else {
      const fromItsm = event.kind !== 'due'
      rows.push({
        id: 'event-' + event.id,
        journalIds: [event.id],
        at,
        text: event.change,
        source: fromItsm ? 'ITSM' : 'Пульт смены',
        category: fromItsm ? 'ITSM' : 'Смена',
        timeBasis: fromItsm && event.at != null ? 'observed' : undefined,
      })
    }
  }
  function shift(id: string, at: number, text: string, source = 'Смена') {
    rows.push({id, at: atShift(at), category: 'Смена', source, text})
  }
  for (const s of desk.signals) {
    if (s.key === item.key && s.acknowledged)
      shift('ack-' + s.id, s.acknowledged, 'Смена подтвердила просмотр критического сигнала')
  }
  for (const task of desk.tasks) {
    if (task.key !== item.key) continue
    for (const a of task.attempts) {
      const who = desk.people.find((p) => p.id === a.person)?.name ?? a.person
      shift('assigned-' + a.id, a.assigned, 'Внутренняя задача назначена · ' + who)
      if (a.accepted) shift('accepted-' + a.id, a.accepted, 'Задача принята · ' + who)
      if (a.ended) shift('ended-' + a.id, a.ended, who + ' · ' + (a.reason || 'Назначение завершено'))
    }
  }
  const group = desk.outageGroups?.find((g) => g.owner && g.acceptedAt && g.members.includes(item.key))
  if (group?.acceptedAt) {
    const owner = desk.people.find((p) => p.id === group.owner)?.name ?? group.owner
    shift('outage-' + group.id, group.acceptedAt, 'Связанную аварию ведёт ' + owner)
  }
  const work = desk.work[item.key]
  for (const note of work?.notes ?? []) {
    shift(
      'note-' + note.id,
      note.at,
      note.kind + ' · ' + note.text + ' · ответственный: ' + note.owner,
      note.author ?? 'Смена',
    )
  }
  for (const report of work?.reports ?? []) {
    if (isInvestigationReport(report)) {
      rows.push({
        id: 'report-' + report.id,
        at: atShift(report.at),
        category: 'Смена',
        source: 'Смена',
        text: 'Сохранён разбор ИИ №' + report.id,
        href: investigationHref(item.key, desk.mode, report.id),
      })
    } else {
      const text =
        report.title === 'Решение о маршрутизации'
          ? report.title + ' · ' + report.content
          : 'Сохранено · ' + report.title
      shift('report-' + report.id, report.at, text)
    }
  }
  const room = work?.room
  const recordedVisits = new Set<string>()
  for (const [index, event] of (room?.timeline ?? []).entries()) {
    const at = atShift(event.at)
    const action = event.text === 'Приглашение доставлено' ? 'Приглашение' : event.text
    recordedVisits.add(JSON.stringify([event.who, moscowTime(at), action]))
    rows.push({
      id: 'room-' + event.at + '-' + index,
      at,
      category: 'Комната',
      source: 'Emergency Room',
      text: event.who + ' · ' + event.text,
    })
  }
  // Legacy rooms have only a local clock per invitation or visit. Do not display an inferred date.
  for (const [index, m] of (room?.members ?? []).entries()) {
    for (const [stamp, title, source] of [
      [m.invited, 'Приглашение', 'Emergency Room'],
      [m.joined, 'Подключился', 'МТС Линк'],
      [m.left, 'Вышел', 'МТС Линк'],
    ] as const) {
      if (stamp && !recordedVisits.has(JSON.stringify([m.role, stamp, title])))
        rows.push({
          id: 'visit-' + index + '-' + title,
          at: moscowClockInstant(stamp, registeredAt ?? desk.clockBase ?? desk.started),
          source,
          category: 'Комната',
          timeBasis: 'clockOnly',
          text: m.role + ' · ' + title,
        })
    }
  }
  return rows.sort((a, b) => b.at - a.at)
}
