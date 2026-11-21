export interface MonitoringCounts {
  critical: number
  high: number
  coordinators: number
  research: number
}

export interface MonitoringTimelinePoint extends MonitoringCounts {
  at: string
}

export interface MonitoringPriority {
  priorityId: number
  count: number
}

export interface MonitoringCoordinatorLoad {
  name: string
  count: number
}

export interface MonitoringSummary {
  activeCount: number
  counts: MonitoringCounts
  timeline: MonitoringTimelinePoint[]
  priorities: MonitoringPriority[]
  coordinatorLoad: MonitoringCoordinatorLoad[]
}
