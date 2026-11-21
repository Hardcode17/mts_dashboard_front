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
  if (now === due) return {label: 'Срок наступил', due, overdue: false}
  if (now < due) return {label: 'До срока ' + duration(Math.ceil((due - now) / 60_000)), due, overdue: false}
  const minutes = Math.floor((now - due) / 60_000)
  return {
    label: minutes ? 'Просрочено на ' + duration(minutes) : 'Просрочено менее чем на минуту',
    due,
    overdue: true,
  }
}
