import type {Signal} from './types'
import type {OutageGroup} from './outageGroups'

export interface SignalBatch {
  key: string
  group?: {id: string; title: string}
  signals: Signal[]
}

// Limit interruptions by situation, but acknowledge only the exact events visible at opening.
export function signalBatches(pending: readonly Signal[], groups: readonly OutageGroup[] = [], limit = 5) {
  const membership = new Map<string, OutageGroup>()
  for (const group of groups)
    if (group.members.length > 1) for (const member of group.members) membership.set(member, group)
  const visible = new Map<string, SignalBatch>()
  for (const signal of pending) {
    const g = membership.get(signal.key)
    const key = g ? 'group/' + g.id : 'signal/' + signal.id
    const batch = visible.get(key)
    if (batch) batch.signals.push(signal)
    else if (visible.size < limit)
      visible.set(key, {key, group: g && {id: g.id, title: g.title}, signals: [signal]})
  }
  return [...visible.values()]
}
