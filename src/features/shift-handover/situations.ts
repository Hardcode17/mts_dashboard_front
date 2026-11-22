import type {OutageGroup} from '../../desk/outageGroups.ts'
import type {HandoverItem} from './api.ts'

export function handoverSituations(items: HandoverItem[], groupOf: (item: HandoverItem) => string) {
  const situations = new Map<string, HandoverItem[]>()
  for (const item of items) {
    const key = groupOf(item)
    const previous = situations.get(key)
    if (previous) previous.push(item)
    else situations.set(key, [item])
  }
  return [...situations.entries()].map(([key, incidentTasks]) => ({key, incidentTasks}))
}

export function currentGroups(groups: readonly OutageGroup[]) {
  return new Map(groups.flatMap(group => group.members.map(member => [member, group] as const)))
}
