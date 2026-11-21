import type {Incident} from '../src/demoData.ts'
import {coordinatorGroup, itsmStateLabels, moscowTime} from '../src/desk/types.ts'
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
    const id = required('id')
    if (!/^INC[\d-]+$/i.test(id) || ids.has(id)) error('id (уникальный номер INC)')
    ids.add(id)
    const state = (itsmStateLabels as Record<string, string>)[required('stateEnum')]
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
