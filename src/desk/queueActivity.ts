import type {Incident} from './types.ts'
import {belongsToQueue, queueWindowMs, type QueueKey, type QueueMovement} from './types.ts'

export const queues = [
  {key: 'critical', title: 'Критические', description: 'Активные с наивысшим приоритетом', symbol: '!'},
  {key: 'assigned', title: 'На координаторах', description: 'Назначены на группу координаторов', symbol: '↳'},
  {key: 'high', title: 'Высокий приоритет', description: 'Активные с высоким приоритетом', symbol: '↑'},
  {
    key: 'research',
    title: 'Исследование ситуации',
    description: 'Сбой устранён, идёт разбор причин',
    symbol: '◎',
  },
] as const

export interface Activity {
  movements: QueueMovement[]
  entered: number
  exited: number
}

export function queueActivity(movements: QueueMovement[] = [], now: number) {
  const grouped: Record<QueueKey, Activity> = {
    critical: {entered: 0, exited: 0, movements: []},
    assigned: {entered: 0, exited: 0, movements: []},
    high: {entered: 0, exited: 0, movements: []},
    research: {entered: 0, exited: 0, movements: []},
  }
  for (let i = movements.length - 1; i >= 0; i--) {
    const move = movements[i]
    if (move.at <= now - queueWindowMs) break
    const group = grouped[move.queue]
    group.movements.push(move)
    if (move.entered) group.entered++
    else group.exited++
  }
  return grouped
}

export function latestTransitions(activity: Activity) {
  return [activity.movements.find((move) => move.entered), activity.movements.find((move) => !move.entered)]
    .filter((move) => move !== undefined)
    .sort((a, b) => b.at - a.at)
}

export function groupIncidents(incidents: Incident[]) {
  const groups: Record<QueueKey, Incident[]> = {critical: [], assigned: [], high: [], research: []}
  for (const item of incidents) {
    for (const {key} of queues) if (belongsToQueue(item, key)) groups[key].push(item)
  }
  return groups
}
