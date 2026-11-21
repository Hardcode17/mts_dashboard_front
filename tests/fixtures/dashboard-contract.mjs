// Wire examples from backend docs/dashboard-api.openapi.yaml (x-fixture).
// Mirrored from src/test/resources/openapi/synthetic so frontend-only CI needs no sibling checkout.
const coordinatorName = 'КЦ ИТ Координаторы Массовых Инцидентов'
const coordinator = {group: 'coordinator', matchedRule: 'assignedToCoordinators'}
const critical = {group: 'critical', matchedRule: 'priorityId = 4'}
const high = {group: 'high', matchedRule: 'priorityId = 3'}
const research = {group: 'research', matchedRule: 'stateEnum = Research'}

const criticalAssigned = {
  id: 'INC000021095531', productName: 'Оплата заказов', assignedGroupName: coordinatorName,
  stateEnum: 'Assigned', priorityId: 4, submitDate: '2026-11-21T09:00:00Z',
  deadline: '2026-11-21T12:00:00Z', completionDate: null, groupMemberships: [coordinator, critical],
}
const criticalWithoutDeadline = {
  id: 'INC000021095532', productName: 'Оплата заказов', assignedGroupName: coordinatorName,
  stateEnum: 'WorkInProgress', priorityId: 4, submitDate: '2026-11-21T09:01:00Z',
  deadline: null, completionDate: null, groupMemberships: [coordinator, critical],
}
const highActive = {
  id: 'INC000021095538', productName: 'Оплата заказов', assignedGroupName: 'Оплата',
  stateEnum: 'WorkInProgress', priorityId: 3, submitDate: '2026-11-21T09:03:00Z',
  deadline: '2026-11-24T18:00:00Z', completionDate: null, groupMemberships: [high],
}
const coordinatorResearch = {
  id: 'INC000021095539', productName: 'Оплата заказов', assignedGroupName: coordinatorName,
  stateEnum: 'Research', priorityId: 3, submitDate: '2026-11-20T15:00:00Z',
  deadline: '2026-11-20T20:00:00Z', completionDate: '2026-11-20T19:40:00Z',
  groupMemberships: [coordinator, research],
}
function group(key, title, rule, active, incidents) {
  return {key, title, rule, active, incidentCount: incidents.length, incidents, fixed: null}
}
export const listDefault = {
  eventSeq: 43, revision: 42, beforeFirstSuccess: false,
  groups: [
    group('critical', 'Критические', 'Активный инцидент с priorityId = 4', true,
      [criticalAssigned, criticalWithoutDeadline]),
    group('coordinator', 'На координаторах', 'Активный инцидент или Research, назначенный на координаторов', true,
      [criticalAssigned, criticalWithoutDeadline, coordinatorResearch]),
    group('high', 'Высокий приоритет', 'Активный инцидент с priorityId = 3', true, [highActive]),
    group('research', 'Исследование ситуации', 'stateEnum = Research; карточка видна и с датой устранения', false,
      [coordinatorResearch]),
  ],
  items: [criticalAssigned, criticalWithoutDeadline, highActive, coordinatorResearch], nextCursor: null,
}
export const listBeforeFirstSuccess = {
  eventSeq: 0, revision: 0, beforeFirstSuccess: true, groups: [], items: [], nextCursor: null,
}
export const cardWithoutDeadline = {
  ...criticalWithoutDeadline,
  header: 'Часть заказов не оплачивается через СБП',
  description: 'Синтетическое описание для контрактных примеров KAN-20.',
  productMasterId: 'BI_pay', service: 'checkout-api', serviceType: 'Клиентский',
  assignedEmployee: null, stateReason: null, lastAssignmentToTeamDateTime: '2026-11-21T09:01:00Z',
  solution: null, remainingSeconds: null, overdue: false,
  itsmUrl: 'http://127.0.0.1:8082/api/mock/incidents/INC000021095532', itsmDemo: true,
  eventSeq: 43, revision: 42,
}
export const cardNotFound = {
  code: 'INCIDENT_NOT_FOUND', message: 'Incident INC000021095599 not found', eventSeq: 43, revision: 42,
}
export const snapshotStatusPublished = {
  lastReceivedAt: '2026-11-21T09:05:00.123456Z',
  lastSuccessAt: '2026-11-21T09:05:01.000000Z', revision: 42, stale: false,
}
export const snapshotStatusStale = {
  lastReceivedAt: '2026-11-21T09:05:00.123456Z',
  lastSuccessAt: null, revision: null, stale: true,
}

// Inline updateIncidentCard → 200 → afterAssignment example in the OpenAPI.
export const patchCard = {
  id: 'INC000021931151', header: 'Сбой приёма платежей на кассах', productName: 'Тестовый магазин',
  assignedGroupName: 'Support', assignedEmployeeLogin: 'demo2', assignedEmployee: 'Дежурный 3 (demo2)',
  stateEnum: 'WorkInProgress', priorityId: 2, submitDate: '2026-11-08T12:02:29Z',
  deadline: '2026-11-22T12:02:29Z', completionDate: null, solution: null,
  remainingSeconds: 86400, overdue: false,
  itsmUrl: 'http://127.0.0.1:8082/itsm_incident/INC000021931151/page', itsmDemo: true,
  groupMemberships: [], eventSeq: 2, revision: 1,
}
