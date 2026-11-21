import {incidentRevisions, initialEvents, type Incident} from '../demoData.ts'
import {cardChanges, historyFields, type TrackedField} from '../incidentHistory.ts'
import {fullTime, priorityNames, standNow, type Desk} from './types.ts'
import {registrationTime} from './order.ts'

export function historyValue(field: TrackedField, value: string | null | undefined) {
  if (value === undefined) return 'Нет сведений'
  if (value === null) return 'Не задано'
  if (field === 'due' && value.includes('T')) return fullTime(Date.parse(value)) + ' МСК'
  if (field === 'priority') return priorityNames[Number(value) - 1] ?? value
  return value
}

export function cardTimeline(d: Desk, item: Incident) {
  const absolute = (stamp: string, observed = false) => {
    if (!stamp.includes('T')) return Date.parse('2026-11-21T' + stamp + ':00+03:00')
    const at = Date.parse(stamp)
    return observed ? standNow(d, at) : at
  }
  const lines = [{at: registrationTime(item), source: 'ITSM', text: 'Регистрация инцидента'}]
  const record = (at: number, source: string, text: string) => lines.push({at: standNow(d, at), source, text})
  const revisions =
    d.revisions[item.key] ?? (d.mode === 'volume' ? incidentRevisions.get(item.key) : undefined) ?? []
  for (const v of cardChanges(revisions)) {
    lines.push({
      at: absolute(v.changedAt ?? v.observedAt, !v.changedAt),
      source: 'ITSM',
      text: v.changes
        .map((c) => historyFields[c.field] + ': ' + historyValue(c.field, c.before) + ' → ' + historyValue(c.field, c.after))
        .join(' · '),
    })
  }
  for (const e of d.events.concat(d.mode === 'volume' ? initialEvents : []))
    if (e.key === item.key) {
      lines.push({at: e.at ?? absolute(e.time), source: 'Журнал смены', text: e.change})
    }
  for (const signal of d.signals)
    if (signal.key === item.key && signal.acknowledged)
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
        if (a.accepted) record(a.accepted, 'Координация', who + ' · принял в работу')
        if (a.ended) record(a.ended, 'Координация', who + ' · ' + a.reason)
      }
  const w = d.work[item.key]
  for (const n of w?.notes ?? [])
    record(n.at, n.author ?? 'Журнал смены', n.kind + ': ' + n.text + ' · ответственный: ' + n.owner)
  for (const e of w?.room?.timeline ?? []) record(e.at, 'Emergency Room', e.who + ' · ' + e.text)
  for (const m of w?.room?.members ?? [])
    if (!w?.room?.timeline?.some((e) => e.who === m.role)) {
      lines.push({at: absolute(m.invited), source: 'Emergency Room', text: m.role + ' · приглашение'})
      if (m.joined) lines.push({at: absolute(m.joined), source: 'МТС Линк', text: m.role + ' · подключился'})
      if (m.left) lines.push({at: absolute(m.left), source: 'МТС Линк', text: m.role + ' · вышел'})
    }
  return lines.sort((a, b) => b.at - a.at)
}
