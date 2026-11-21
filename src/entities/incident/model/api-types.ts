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

/** Категория риска нарушения срока решения (KAN-83, контракт docs/deadline-risk.html в mts_dashboard_data). */
export type DeadlineRiskLevel = 'low' | 'medium' | 'high' | 'unknown'
/** Основание оценки: код признака и человекочитаемый текст с числами. */
export interface DeadlineRiskReason {
  code: string
  text: string
}
/**
 * Оценка риска просрочки, приходит в составе карточки инцидента.
 * По контракту поле опционально: без дедлайна оценка не считается.
 * evaluatedAt — ISO-строка в UTC; типизирована как опциональная,
 * чтобы карточка не ломалась при частичном ответе.
 * score отдаётся только для отладки и в интерфейсе не показывается.
 */
export interface DeadlineRisk {
  risk: DeadlineRiskLevel
  evaluatedAt?: string
  reasons: DeadlineRiskReason[]
  score?: number
}

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
  solution?: string | null
  assignedEmployeeLogin?: string | null
  assignedEmployee: string | null
  deadline: string | null
  remainingSeconds: number | null
  overdue: boolean
  groups: IncidentGroup[]
  deadlineRisk?: DeadlineRisk | null
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

export interface SimilarIncidentsResponse {
  incidentId: string
  candidates: {
    incidentId: string
    header: string | null
    score: number
    reasons: string[]
  }[]
}

export interface IncidentRelationshipNode {
  id: string
  title: string | null
  stateEnum: string | null
  priorityId: number | null
}

export interface IncidentRelationshipEdge {
  parentId: string
  childId: string
}

export interface IncidentRelationshipsResponse {
  focusId: string
  nodes: IncidentRelationshipNode[]
  edges: IncidentRelationshipEdge[]
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
