import type {Incident} from '../demoData'
import {incidentOrder, registrationTime} from './order.ts'
import {active, onCoordinators} from './types.ts'

export function recentlyUpdated(first: Incident, second: Incident) {
  return (second.updatedAt ?? registrationTime(second)) -
    (first.updatedAt ?? registrationTime(first)) || incidentOrder(first, second)
}

export function groupIncidents(incidents: Incident[]) {
  const groups = {critical: [] as Incident[], assigned: [] as Incident[], high: [] as Incident[], research: [] as Incident[]}
  for (const item of incidents) {
    const isActive = active(item)
    if (isActive && item.priority === 4) groups.critical.push(item)
    if (onCoordinators(item)) groups.assigned.push(item)
    if (isActive && item.priority === 3) groups.high.push(item)
    if (item.research) groups.research.push(item)
  }
  return groups
}
