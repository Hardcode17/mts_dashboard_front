export type IncidentNumber = string
export type PriorityId = 1 | 2 | 3 | 4
export type Priority = PriorityId
export type IncidentState =
  | 'Assigned'
  | 'WorkInProgress'
  | 'Resolved'
  | 'Closed'
  | 'Research'
export type Status = IncidentState
export type IncidentGroup =
  | 'critical'
  | 'coordinators'
  | 'high'
  | 'research'
export type Group = IncidentGroup
export type DeadlineState =
  | 'overdue'
  | 'withinDeadline'
  | 'unspecified'
  | 'inactive'

export interface IncidentDto {
  id: IncidentNumber
  header: string
  description: string | null
  productName: string | null
  service: string | null
  serviceType: string | null
  submitDate: string
  updatedAt?: string
  completionDate: string | null
  stateEnum: IncidentState
  priorityId: number
  assignedGroupName: string | null
  assignedEmployee: string | null
  deadline: string | null
  remainingSeconds: number | null
  overdue: boolean
  groups: IncidentGroup[]
}

/**
 * UI view model from the one product/service relation in the current backend
 * model. The API does not currently return a service array or service criticality.
 */
export interface AffectedService {
  productName: string | null
  service: string | null
}

export type IncidentHistoryField =
  | 'stateEnum'
  | 'assignedGroupName'
  | 'assignedEmployeeLogin'
  | 'priorityId'
  | 'deadline'
  | 'solution'
  | null

export interface IncidentHistoryEvent {
  eventSeq: number
  kind: 'appeared' | 'changed' | 'missing'
  field: IncidentHistoryField
  oldValue: string | number | null
  newValue: string | number | null
  sourceId: string
  observedAt: string
  sourceAt: string | null
}

export interface AssignmentEvent
  extends Omit<IncidentHistoryEvent, 'field'> {
  field: 'assignedGroupName' | 'assignedEmployeeLogin'
}

export interface IncidentCounts {
  critical: number
  coordinators: number
  high: number
  research: number
}

export interface IncidentListResponse {
  revision: number | null
  eventSeq: number
  beforeFirstSuccess: boolean
  counts: IncidentCounts
  items: IncidentDto[]
}

export interface IncidentDetailResponse {
  revision: number | null
  incident: IncidentDto
  itsmUrl: string
  itsmDemo: boolean
  meetingUrl: string | null
}

export interface SnapshotStatus {
  lastReceivedAt: string | null
  lastSuccessAt: string | null
  revision: number | null
  stale: boolean
}

export interface ApiErrorDto {
  code: string
  message: string
}
