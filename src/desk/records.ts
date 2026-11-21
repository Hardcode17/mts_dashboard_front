import type {Incident} from './types.ts'

export function workspaceIncidents(records: Record<string, Incident>): Incident[] {
  return Object.values(records)
}
