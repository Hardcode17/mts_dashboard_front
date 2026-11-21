import type {Incident} from '../../../demoData.ts'
import type {IncidentDto, IncidentListResponse, SnapshotStatus} from '../../../entities/incident/model/api-types.ts'
import {emptyWork, type Desk} from '../../../desk/types.ts'

function displayTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function displayState(state: IncidentDto['stateEnum']): string {
  const labels: Record<IncidentDto['stateEnum'], string> = {
    Assigned: 'Назначен',
    WorkInProgress: 'В работе',
    Resolved: 'Завершён',
    Closed: 'Закрыт',
    Research: 'Исследование ситуации',
  }

  return labels[state]
}

export function toIncident(dto: IncidentDto): Incident {
  const state = displayState(dto.stateEnum)
  const dueAt = dto.deadline === null ? null : Date.parse(dto.deadline)
  const registeredAt = Date.parse(dto.submitDate)

  return {
    key: dto.id,
    id: dto.id,
    title: dto.header,
    product: dto.productName ?? 'Продукт не указан',
    service: dto.service ?? '',
    team: dto.assignedGroupName ?? '',
    assignee: dto.assignedEmployee ?? undefined,
    state,
    registered: displayTime(dto.submitDate),
    registeredAt,
    updatedAt: Date.parse(dto.updatedAt),
    due: dueAt === null ? null : displayTime(dto.deadline!),
    dueAt,
    priority: dto.priorityId,
    research: dto.stateEnum === 'Research',
    description: dto.description ?? '',
    groups: dto.groups,
  }
}

export function toApiDesk(
  response: IncidentListResponse,
  snapshot: SnapshotStatus,
  now: number,
): Desk {
  const records = response.items.map(toIncident)
  const successAt = snapshot.lastSuccessAt
    ? Date.parse(snapshot.lastSuccessAt)
    : 0

  return {
    mode: 'case',
    version: response.revision ?? 0,
    started: now,
    seq: response.eventSeq,
    records: Object.fromEntries(records.map((incident) => [incident.key, incident])),
    input: 'file',
    sourceError: snapshot.stale ? 'Показан последний успешно опубликованный снимок.' : '',
    revisions: {},
    events: [],
    signals: [],
    quietUntil: 0,
    threshold: 20,
    warnings: {},
    people: [],
    tasks: [],
    notices: [],
    enabled: [],
    failedChannels: [],
    work: Object.fromEntries(records.map((incident) => [incident.key, emptyWork()])),
    presets: {},
    lastImport: successAt,
    lastChanges: [],
    demoCount: 0,
    apiCounts: response.counts,
  }
}
