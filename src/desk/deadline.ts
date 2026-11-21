import type {Incident} from '../demoData.ts'
import {active, dueInstant, moscowTime} from './types.ts'

function duration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (!hours) return remainder + ' мин'
  return hours + ' ч' + (remainder ? ' ' + remainder + ' мин' : '')
}

export function incidentDeadline(item: Incident, now: number) {
  const instant = dueInstant(item)
  const due = instant !== null && Number.isFinite(instant) ? instant : null
  if (!active(item)) {
    const at =
      item.restoredEpoch != null && Number.isFinite(item.restoredEpoch)
        ? moscowTime(item.restoredEpoch)
        : item.restoredAt
    const label = at ? 'Восстановлено в ' + at + ' МСК' : 'Время восстановления не указано'
    return {label, due, overdue: false}
  }
  if (due === null) return {label: 'Срок не указан', due, overdue: false}
  const status = item.deadlineStatus
  const left = status
    ? status.remainingSeconds * 1000 - Math.max(0, now - status.observedAt)
    : due - now
  if (left === 0 && !status?.overdue) return {label: 'Срок наступил', due, overdue: false}
  if (left > 0 && !status?.overdue) return {label: 'До срока ' + duration(Math.ceil(left / 60_000)), due, overdue: false}
  const minutes = Math.max(0, Math.floor(-left / 60_000))
  return {
    label: minutes ? 'Просрочено на ' + duration(minutes) : 'Просрочено менее чем на минуту',
    due,
    overdue: true,
  }
}
