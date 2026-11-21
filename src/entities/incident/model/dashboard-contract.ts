import type {DeadlineRisk, IncidentNumber, IncidentState} from './api-types.ts'

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
  solution?: string | null
  assignedEmployeeLogin?: string | null
  assignedEmployee: string | null
  remainingSeconds: number | null
  overdue: boolean
  itsmUrl: string
  itsmDemo: boolean
  revision: number
  eventSeq: number
  /** Оценка риска нарушения срока (KAN-83); отсутствует, если бэкенд её не посчитал. */
  deadlineRisk?: DeadlineRisk | null
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
