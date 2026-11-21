import type {IncidentNumber, IncidentState} from './api-types.ts'

export type DashboardGroup = 'critical' | 'coordinator' | 'high' | 'research'

export interface DashboardIncidentSummary {
  id: IncidentNumber
  productName?: string | null
  assignedGroupName?: string | null
  stateEnum: IncidentState
  priorityId: number
  submitDate: string
  deadline: string | null
  completionDate?: string | null
  groupMemberships: {group: DashboardGroup; matchedRule: string}[]
}

export interface DashboardIncidentCard extends DashboardIncidentSummary {
  header?: string | null
  description?: string | null
  service?: string | null
  serviceType?: string | null
  assignedEmployee: string | null
  assignedEmployeeLogin?: string | null
  solution?: string | null
  remainingSeconds: number | null
  overdue: boolean
  itsmUrl: string
  itsmDemo: boolean
  revision: number
  eventSeq: number
}

export interface DashboardIncidentPage {
  revision: number
  eventSeq: number
  beforeFirstSuccess: boolean
  groups: {
    key: DashboardGroup
    title: string
    rule: string
    active: boolean
    incidentCount: number
    incidents: DashboardIncidentSummary[]
    fixed: number | null
  }[]
  items: DashboardIncidentSummary[]
  nextCursor: string | null
}

export interface DashboardIncidentQuery {
  group?: DashboardGroup[]
  includeCompleted?: boolean
  cursor?: string
  limit?: number
}

export interface DashboardIdentity {
  subject: string
  username: string | null
  name: string | null
}

export interface DashboardShiftEvent {
  eventId: string
  eventSeq: number
  incidentId: string
  ackRequired: boolean
  occurredAt: string
  incident?: {header?: string | null}
}

export interface DashboardShiftPage {
  events: DashboardShiftEvent[]
  nextEventSeq: number
}

export interface DashboardHistoryEvent {
  eventSeq: number
  incidentId: string
  sourceVersion: number
  changeRevision: number
  changeKind: 'ADDED' | 'UPDATED' | 'MISSING' | 'RETURNED'
  sourceId: string
  observedAt: string
  sourceTime: string | null
  fields: {field: string; previous: unknown; current: unknown}[]
}

export interface DashboardIncidentHistory {
  incidentId: string
  lastObservedAt: string | null
  events: DashboardHistoryEvent[]
}
