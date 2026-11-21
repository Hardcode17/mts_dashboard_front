import type {DashboardHistoryEvent} from '../entities/incident/model/dashboard-contract.ts'
import {cardChanges, historyFields, type TrackedField} from '../incidentHistory.ts'
import {fullTime, itsmStateLabels, priorityNames, type Desk, type Incident, type ItsmState} from './types.ts'

export function parseHistoryTime(value: string | null | undefined): number | undefined {
  if (!value?.includes('T')) return undefined
  const at = Date.parse(value)
  return Number.isFinite(at) ? at : undefined
}

export function historyValue(field: TrackedField, value: string | null | undefined) {
  if (value === undefined) return 'Нет сведений'
  if (value === null) return 'Не задано'
  if (field === 'due') {
    const at = parseHistoryTime(value)
    if (at !== undefined) return fullTime(at) + ' МСК'
  }
  if (field === 'priority') return priorityNames[Number(value) - 1] ?? value
  if (field === 'state' && Object.hasOwn(itsmStateLabels, value)) return itsmStateLabels[value as ItsmState]
  return value
}

const apiHistoryFields: Readonly<Partial<Record<string, TrackedField>>> = {
  stateEnum: 'state',
  assignedGroupName: 'team',
  assignedEmployee: 'assignee',
  priorityId: 'priority',
  deadline: 'due',
  solution: 'solution',
}
const apiHistoryLabels = {
  ADDED: 'Карточка появилась в источнике',
  UPDATED: 'Карточка обновлена',
  MISSING: 'Карточка отсутствует в снимке источника',
  RETURNED: 'Карточка снова появилась в снимке источника',
}

function stringValue(value: unknown): string | null | undefined {
  if (value === null) return null
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

export function apiHistoryFact(event: DashboardHistoryEvent) {
  const changedAt = parseHistoryTime(event.sourceTime)
  const observedAt = parseHistoryTime(event.observedAt)
  return {
    id: event.eventSeq,
    label: apiHistoryLabels[event.changeKind],
    changedAt,
    observedAt,
    at: changedAt ?? observedAt,
    changes: event.changeKind === 'UPDATED' ? event.fields.flatMap(({field: key, previous, current}) => {
      const field = Object.hasOwn(apiHistoryFields, key) ? apiHistoryFields[key] : undefined
      const before = stringValue(previous)
      const after = stringValue(current)
      return field && before !== after ? [{field, before, after}] : []
    }) : [],
  }
}

interface TimelineEntry {
  at: number
  source: string
  text: string
}

export function cardTimeline(d: Desk, item: Incident, history?: readonly DashboardHistoryEvent[]): TimelineEntry[] {
  const lines: TimelineEntry[] = []
  const record = (at: number | undefined, source: string, text: string) => {
    if (at !== undefined && Number.isFinite(at)) lines.push({at, source, text})
  }
  record(item.registeredAt, 'ITSM', 'Регистрация инцидента')
  record(item.restoredEpoch, 'ITSM', 'Завершение инцидента')
  const fieldChanges = (changes: ReturnType<typeof apiHistoryFact>['changes']) => changes
    .map((c) => historyFields[c.field] + ': ' + historyValue(c.field, c.before) + ' → ' + historyValue(c.field, c.after))
    .join(' · ')
  for (const event of history ?? []) {
    if (event.incidentId !== item.id) continue
    const fact = apiHistoryFact(event)
    record(fact.at, fact.changedAt === undefined ? 'Журнал ITSM' : 'ITSM', fieldChanges(fact.changes) || fact.label)
  }
  const revisions = history === undefined ? d.revisions[item.key] ?? [] : []
  for (const v of cardChanges(revisions)) {
    record(parseHistoryTime(v.changedAt) ?? parseHistoryTime(v.observedAt), 'ITSM', fieldChanges(v.changes))
  }
  for (const e of d.events)
    if (e.key === item.key) record(e.at, 'Журнал смены', e.change)
  for (const signal of d.signals)
    if (signal.key === item.key && signal.acknowledged !== undefined)
      record(
        signal.acknowledged,
        'Общий экран',
        'Смена подтвердила просмотр критического события №' + signal.id,
      )
  for (const t of d.tasks)
    if (t.key === item.key)
      for (const a of t.attempts) {
        const who = d.people.find((p) => p.id === a.person)?.name ?? a.person
        record(a.assigned, 'Координация', who + ' · назначена внутренняя задача')
        record(a.accepted, 'Координация', who + ' · принял в работу')
        record(a.ended, 'Координация', who + ' · ' + (a.reason ?? 'назначение завершено'))
      }
  const w = d.work[item.key]
  for (const n of w?.notes ?? [])
    record(n.at, n.author ?? 'Журнал смены', n.kind + ': ' + n.text + ' · ответственный: ' + n.owner)
  for (const e of w?.room?.timeline ?? []) record(e.at, 'Emergency Room', e.who + ' · ' + e.text)
  return lines.sort((a, b) => b.at - a.at)
}
