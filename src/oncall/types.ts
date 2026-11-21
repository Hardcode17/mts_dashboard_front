export type Priority = 'P1' | 'P2' | 'P3' | 'P4'

export type IncidentStatus =
  | 'new'
  | 'assigned'
  | 'in_progress'
  | 'research'
  | 'resolved'
  | 'closed'

export type IncidentGroup =
  | 'critical'
  | 'on_coordinators'
  | 'high_priority'
  | 'research'

export interface AlertGroup {
  id: string
  status: IncidentStatus
  priority: Priority
  title: string
  product: string
  alertsCount: number
  integration: string
  createdAt: string
  slaDeadline?: string
  team: string
  users: string[]
  assignee?: string
}
