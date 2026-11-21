import type {Incident} from '../demoData'
import {itsmStateLabels, type ItsmState} from './types'

/**
 * Официальное изменение инцидента через бэкенд дашборда (KAN-58):
 * PATCH /api/dashboard/incidents/{incidentId}. Браузер не ходит в ITSM напрямую —
 * подтверждённое состояние всегда приходит ответом сервера.
 */
export interface OfficialChanges {
  assignedEmployeeLogin?: string | null
  /** Отображаемое имя выбранного исполнителя — только для предварительного показа. */
  assignedEmployeeName?: string
  assignedGroupName?: string
  stateEnum?: ItsmState
  solution?: string
}

/** Поля ответа карточки DashboardIncidentCardResponse, которые использует дашборд. */
export interface OfficialCard {
  id: string
  header?: string | null
  productName?: string | null
  assignedGroupName?: string | null
  assignedEmployee?: string | null
  assignedEmployeeLogin?: string | null
  stateEnum?: ItsmState | null
  state?: string | null
  solution?: string | null
  updatedAt?: string | null
  revision?: number
}

/** Сведение карточки к подтверждённому ответу сервера. */
export function confirmedIncident(record: Incident, card: OfficialCard): Incident {
  const next: Incident = {...record}
  if (typeof card.header === 'string' && card.header) next.title = card.header
  if (typeof card.productName === 'string' && card.productName) next.product = card.productName
  if (typeof card.assignedGroupName === 'string') next.team = card.assignedGroupName
  if (card.assignedEmployee !== undefined) next.assignee = card.assignedEmployee || undefined
  if (card.assignedEmployeeLogin !== undefined) next.assigneeLogin = card.assignedEmployeeLogin || undefined
  const state = card.stateEnum ? itsmStateLabels[card.stateEnum] : card.state || undefined
  if (state) {
    next.state = state
    next.research = state === 'Исследование ситуации'
  }
  if (card.solution !== undefined) next.solution = card.solution || undefined
  if (card.updatedAt) {
    const stamp = Date.parse(card.updatedAt)
    if (Number.isFinite(stamp)) next.updatedAt = Math.max(stamp, record.updatedAt ?? 0)
  }
  return next
}

/** Причина отказа из AppErrorResponse бэкенда ({code, message}) или текст стенда. */
export function officialFailure(status: number, body: unknown): string {
  const reply = (body ?? {}) as {code?: unknown; message?: unknown; error?: unknown}
  const message = typeof reply.message === 'string' && reply.message.trim()
    ? reply.message
    : typeof reply.error === 'string' && reply.error.trim()
      ? reply.error
      : 'HTTP ' + status
  return typeof reply.code === 'string' && reply.code !== message ? message + ' · ' + reply.code : message
}
