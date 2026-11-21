import type {Incident} from '../../../desk/types.ts'
import {active} from '../../../desk/types.ts'

const minute = 60_000

type FlowBatch = {at: number; arrived: number; completed: number}
export type IncidentFlow = {activeCount: number; batches: readonly FlowBatch[]}

export function createIncidentFlowTracker() {
  const known = new Map<string, boolean>()
  let initialized = false
  let batches: FlowBatch[] = []

  return (incidents: readonly Incident[], at: number): IncidentFlow => {
    let activeCount = 0
    let arrived = 0
    let completed = 0
    for (const incident of incidents) {
      if (incident.absent) continue
      const isActive = active(incident)
      const wasActive = known.get(incident.id)
      if (isActive) activeCount++
      if (initialized && wasActive === undefined) arrived++
      if (wasActive === true && !isActive) completed++
      known.set(incident.id, isActive)
    }
    initialized = true
    batches = batches.filter(batch => batch.at > at - minute)
    if (arrived || completed) batches.push({at, arrived, completed})
    return {activeCount, batches}
  }
}

export function incidentFlowForLastMinute(flow: IncidentFlow, now: number) {
  let arrived = 0
  let completed = 0
  for (const batch of flow.batches) {
    if (batch.at <= now - minute || batch.at > now) continue
    arrived += batch.arrived
    completed += batch.completed
  }
  return {arrived, completed}
}
