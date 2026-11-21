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
  updatedAt: string | null
  activeCount: number
  counts: MonitoringCounts
  timeline: MonitoringTimelinePoint[]
  priorities: MonitoringPriority[]
  coordinatorLoad: MonitoringCoordinatorLoad[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function parseIsoInstant(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const instant = Date.parse(value)
  return Number.isFinite(instant) ? instant : null
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null
}

function parseCounts(value: unknown): MonitoringCounts | null {
  const record = asRecord(value)
  if (!record) return null
  const critical = nonNegativeInteger(record.critical)
  const high = nonNegativeInteger(record.high)
  const coordinators = nonNegativeInteger(record.coordinators)
  const research = nonNegativeInteger(record.research)
  if (critical === null || high === null || coordinators === null || research === null) return null
  return {critical, high, coordinators, research}
}

function parseTimeline(value: unknown): MonitoringTimelinePoint[] {
  if (!Array.isArray(value)) return []
  const points = value.flatMap((entry) => {
    const record = asRecord(entry)
    if (!record || parseIsoInstant(record.at) === null) return []
    const counts = parseCounts(record)
    if (!counts) return []
    return [{at: record.at as string, ...counts}]
  })
  return points.sort((first, second) => Date.parse(first.at) - Date.parse(second.at))
}

function parsePriorities(value: unknown): MonitoringPriority[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const record = asRecord(entry)
    const priorityId = record?.priorityId
    const count = nonNegativeInteger(record?.count)
    if (typeof priorityId !== 'number' || !Number.isSafeInteger(priorityId) || count === null) return []
    return [{priorityId, count}]
  })
}

function parseCoordinatorLoad(value: unknown): MonitoringCoordinatorLoad[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const record = asRecord(entry)
    if (typeof record?.name !== 'string') return []
    const name = record.name.trim()
    const count = nonNegativeInteger(record.count)
    return name && count !== null ? [{name, count}] : []
  })
}

/**
 * Keeps the API boundary explicit: malformed history is dropped instead of
 * being replaced with synthetic observations or zero-valued points.
 */
export function parseMonitoringSummary(payload: unknown): MonitoringSummary {
  const record = asRecord(payload)
  if (!record) throw new Error('Мониторинг вернул пустой ответ')
  const activeCount = nonNegativeInteger(record.activeCount)
  const counts = parseCounts(record.counts)
  if (activeCount === null || !counts) throw new Error('В ответе мониторинга нет счётчиков')
  const updatedAt = parseIsoInstant(record.updatedAt) === null ? null : (record.updatedAt as string)
  return {
    updatedAt,
    activeCount,
    counts,
    timeline: parseTimeline(record.timeline),
    priorities: parsePriorities(record.priorities),
    coordinatorLoad: parseCoordinatorLoad(record.coordinatorLoad),
  }
}
