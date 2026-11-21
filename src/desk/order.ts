import type {Incident} from '../demoData.ts'
import {active, dueInstant} from './types.ts'

export function registrationTime(item: Incident) {
  return item.registeredAt ?? Date.parse('2026-11-21T' + item.registered + ':00+03:00')
}

export function incidentOrder(a: Incident, b: Incident) {
  const critical = (item: Incident) => Number(active(item) && item.priority === 4)
  return (
    critical(b) - critical(a) ||
    b.priority - a.priority ||
    (dueInstant(a) ?? Infinity) - (dueInstant(b) ?? Infinity) ||
    registrationTime(a) - registrationTime(b) ||
    a.id.localeCompare(b.id)
  )
}
