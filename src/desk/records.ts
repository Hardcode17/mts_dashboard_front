import {initialIncidents, type Incident} from '../demoData'
import type {Source} from './types'

const initialKeys = new Set(initialIncidents.map(incident => incident.key))

export function workspaceIncidents(records: Record<string, Incident>, mode: Source): Incident[] {
  if (mode === 'case') return Object.values(records)
  return [
    ...initialIncidents.map(incident => records[incident.key] ?? incident),
    ...Object.values(records).filter(incident => !initialKeys.has(incident.key)),
  ]
}
