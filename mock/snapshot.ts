import type {DeadlineRisk} from '../src/entities/incident/model/api-types.ts'
import type {Incident} from '../src/demoData.ts'
import {moscowTime, coordinatorGroup, externalHttpAddress} from '../src/desk/types.ts'
import {itsmStateLabels} from '../src/desk/types.ts'

const riskLevels = ['low', 'medium', 'high', 'unknown'] as const

/**
 * Опциональное поле оценки риска просрочки (KAN-83). В проде его считает
 * бэкенд (KAN-82), в мок-файл оно добавлено вручную для локальной
 * разработки. Отсутствие поля допустимо — карточка без него не ломается.
 */
function parseDeadlineRisk(row: object, error: (field: string) => never): DeadlineRisk | undefined {
  const value = (row as Record<string, unknown>).deadlineRisk
  if (value === null || value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) error('deadlineRisk')
  const raw = value as Record<string, unknown>
  if (!(riskLevels as readonly unknown[]).includes(raw.risk)) error('deadlineRisk.risk')
  if (raw.evaluatedAt !== undefined && !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(String(raw.evaluatedAt)))
    error('deadlineRisk.evaluatedAt')
  if (!Array.isArray(raw.reasons) || !raw.reasons.every((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return false
    const {code, text} = r as Record<string, unknown>
    return typeof code === 'string' && code.trim() !== '' && typeof text === 'string' && text.trim() !== ''
  })) error('deadlineRisk.reasons')
  if (raw.score !== undefined && typeof raw.score !== 'number') error('deadlineRisk.score')
  return {
    risk: raw.risk as DeadlineRisk['risk'],
    evaluatedAt: raw.evaluatedAt === undefined ? undefined : String(raw.evaluatedAt),
    reasons: (raw.reasons as {code: string; text: string}[]).map(({code, text}) => ({code, text})),
    score: raw.score as number | undefined,
  }
}

export function parseSnapshot(raw: unknown): Incident[] {
  if (!Array.isArray(raw)) throw Error('Ожидается массив карточек ITSM.')
  const ids = new Set<string>()
  return raw.map((row, index) => {
    const error = (field: string) => {
      throw Error(
        'Строка ' + (index + 1) + ' · ' + String(row?.id ?? 'без номера') + ' · проверьте поле ' + field,
      )
    }
    if (!row || typeof row !== 'object' || Array.isArray(row)) error('карточка')
    const required = (f: string): string =>
      typeof row[f] === 'string' && row[f].trim() ? row[f].trim() : error(f)
    const date = (f: string, optional = false): number | null => {
      if (optional && (row[f] === null || row[f] === undefined || row[f] === '')) return null
      const s = required(f),
        t = Date.parse(s)
      return Number.isFinite(t) ? t : error(f)
    }
    const optional = (field: string): string | undefined => {
      if (row[field] == null || row[field] === '') return undefined
      return typeof row[field] === 'string' ? row[field].trim() || undefined : error(field)
    }
    const id = required('id')
    if (!/^INC[\d-]+$/i.test(id) || ids.has(id)) error('id (уникальный номер INC)')
    ids.add(id)
    const state = (itsmStateLabels as Record<string,string>)[required('stateEnum')]
    if (!state) error('stateEnum')
    const priority = row.priorityId
    if (!Number.isInteger(priority) || priority < 1 || priority > 4) error('priorityId')
    const registeredAt = date('submitDate')!,
      dueAt = date('deadline', true),
      assigned = date('lastAssignmentToTeamDateTime', true),
      restored = date('completionDate', true)
    const team = typeof row.assignedGroupName === 'string' ? row.assignedGroupName : ''
    const item: Incident = {
      key: id,
      sysId: optional('sysId'),
      assigneeLogin: optional('assignedEmployeeLogin'),
      meetingUrl: row.meetingUrl === undefined ? undefined : externalHttpAddress(row.meetingUrl),
      itsmUrl: row.itsmUrl === undefined ? undefined : externalHttpAddress(row.itsmUrl),
      itsmDemo: typeof row.itsmDemo === 'boolean' ? row.itsmDemo : undefined,
      parentId: row.parentId === null ? null : optional('parentId'),
      upstreamService: optional('upstreamService'),
      errorCode: optional('errorCode'),
      id,
      title: required('header'),
      product: required('productName'),
      team,
      state,
      priority,
      registered: moscowTime(registeredAt),
      registeredAt,
      assignedEpoch: assigned ?? undefined,
      restoredEpoch: restored ?? undefined,
      due: dueAt === null ? null : moscowTime(dueAt),
      dueAt,
      research: state === 'Исследование ситуации',
      deadlineRisk: parseDeadlineRisk(row, error),
      assignedAt: team === coordinatorGroup && assigned !== null ? moscowTime(assigned) : undefined,
      restoredAt:
        restored !== null && ['Завершён', 'Закрыт', 'Исследование ситуации'].includes(state)
          ? moscowTime(restored)
          : undefined,
      assignee: row.assignedEmployee ?? undefined,
      solution: row.solution ?? undefined,
      description: row.description ?? '',
      service: row.service ?? '',
      serviceType: row.serviceType ?? '',
      impact: row.impact ?? '',
      flags: [
        ['isNeedUp', 'Остались последствия'],
        ['isMaster', 'Основной'],
        ['isReason', 'Дочерний'],
        ['isEffect', 'Есть дочерние'],
        ['isDouble', 'Дубль'],
      ]
        .filter(([k]) => row[k] === true)
        .map(([, v]) => v),
    }
    for (const field of ['assignee', 'solution', 'description', 'service', 'serviceType', 'impact'] as const)
      if (item[field] !== undefined && typeof item[field] !== 'string') error(field)
    return item
  })
}
