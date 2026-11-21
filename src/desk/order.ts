import {active, dueInstant, type Incident} from './types.ts'

export function registrationTime(item: Incident) {
  return item.registeredAt ?? 0
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
