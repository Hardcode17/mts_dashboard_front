import type {IncomingHttpHeaders} from 'node:http'
import type {Incident} from '../src/demoData.ts'
import {parseSnapshot} from './snapshot.ts'

export class ItsmError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const statuses = new Set(['Assigned', 'WorkInProgress', 'Resolved', 'Closed', 'Research'])
const finished = new Set(['Resolved', 'Closed', 'Research'])
function check(ok: unknown, status: number, message: string): asserts ok {
  if (!ok) throw new ItsmError(status, message)
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateChanges(changes: unknown): Record<string, unknown> {
  check(object(changes) && Object.keys(changes).length > 0, 400, 'Укажите хотя бы одно изменение.')
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'assignedEmployeeLogin' && value === null) continue
    check(
      ['assignedGroupName', 'assignedEmployeeLogin', 'stateEnum', 'solution'].includes(key) &&
        typeof value === 'string' &&
        value.trim() &&
        value.length <= 20000,
      400,
      'Недопустимые поля изменения ITSM.',
    )
  }
  check(!('stateEnum' in changes) || statuses.has(String(changes.stateEnum)), 400, 'Неизвестный статус ITSM.')
  check(!('solution' in changes) || finished.has(String(changes.stateEnum)), 400, 'Укажите статус решения.')
  return changes
}

export function itsmGateway(config: {itsm?: string; dashboard?: string}) {
  const spring = Boolean(config.dashboard)
  const base = config.dashboard || config.itsm
  if (!base) return null
  const origin = new URL(base)
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error('Проверьте адрес ITSM или серверного API в конфигурации стенда.')
  const root = origin.href.replace(/\/$/, '')
  const locks = new Map<string, Promise<unknown>>()

  async function request(path: string, headers: IncomingHttpHeaders, patch?: Record<string, unknown>) {
    let response: Response
    try {
      response = await fetch(root + path, {
        method: patch ? 'PATCH' : 'GET',
        headers: {
          accept: 'application/json',
          ...(patch ? {'content-type': 'application/json'} : {}),
          ...(spring && headers.authorization ? {authorization: headers.authorization} : {}),
        },
        body: patch ? JSON.stringify(patch) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      throw new ItsmError(
        503,
        patch
          ? 'Нет подтверждения от ITSM. Перечитайте карточку перед повторной отправкой.'
          : 'ITSM недоступна. Повторите подключение.',
      )
    }
    if (!response.ok) {
      const status = [400, 401, 403, 404, 409, 429, 503].includes(response.status) ? response.status : 502
      const messages: Record<number, string> = {
        400: 'ITSM отклонила введённые значения.',
        401: 'Требуется вход в серверный API.',
        403: 'Нет доступа к изменению в ITSM.',
        404: 'Инцидент или справочник не найден в ITSM.',
        409: 'ITSM отклонила изменение текущего состояния.',
        429: 'ITSM просит повторить запрос позже.',
        503: 'ITSM временно недоступна.',
      }
      throw new ItsmError(status, messages[status] ?? 'Ошибка ответа ITSM.')
    }
    try {
      return (await response.json()) as unknown
    } catch {
      throw new ItsmError(502, 'В ответе ITSM ожидается JSON.')
    }
  }

  function path(id: string) {
    check(
      id.trim() && id !== '.' && id !== '..' && id.length <= 512,
      502,
      'Некорректный идентификатор записи ITSM.',
    )
    return (spring ? '/api/dashboard/incidents/' : '/itsm_incident/') + encodeURIComponent(id)
  }
  function normalize(raw: unknown, item: Incident) {
    check(object(raw) && raw.id === item.id, 502, 'Ответ ITSM относится к другому INC.')
    if (!spring)
      check(
        typeof raw.sysId === 'string' && raw.sysId && (!item.sysId || raw.sysId === item.sysId),
        502,
        'ITSM вернула другой идентификатор записи.',
      )
    let card: Incident
    try {
      ;[card] = parseSnapshot([spring ? {
        ...raw, header: raw.header || item.id, productName: raw.productName || 'Продукт не указан',
      } : raw])
      if (spring && Array.isArray(raw.groupMemberships)) {
        card.groups = raw.groupMemberships.map(({group}) => group === 'coordinator' ? 'coordinators' : group)
      }
    } catch {
      throw new ItsmError(502, 'ITSM вернула некорректную карточку.')
    }
    return {
      card,
      stateEnum: String(raw.stateEnum),
      login: typeof raw.assignedEmployeeLogin === 'string' ? raw.assignedEmployeeLogin : null,
    }
  }

  async function detail(item: Incident, headers: IncomingHttpHeaders) {
    const raw = await request(path(spring ? item.id : item.sysId || item.id), headers)
    return {...normalize(raw, item), eventSeq: object(raw) ? raw.eventSeq : undefined}
  }

  async function editor(item: Incident, headers: IncomingHttpHeaders) {
    const [{card, stateEnum, login}, directory] = await Promise.all([
      detail(item, headers),
      request(spring ? '/api/dashboard/users' : '/user', headers),
    ])
    check(
      Array.isArray(directory) &&
        directory.every((p) => object(p) && typeof p.login === 'string' && typeof p.displayName === 'string'),
      502,
      'Некорректный справочник сотрудников ITSM.',
    )
    return {
      external: true,
      team: card.team,
      login,
      stateEnum,
      solution: card.solution || '',
      users: directory.map((p) => ({
        login: p.login as string,
        name: p.displayName as string,
        team: typeof p.groupName === 'string' ? p.groupName : '',
      })),
    }
  }

  async function patch(item: Incident, value: unknown, headers: IncomingHttpHeaders) {
    const changes = validateChanges(value)
    let externalId = item.id
    if (!spring) {
      const source = item.sysId ? item : normalize(await request(path(item.id), headers), item).card
      check(source.sysId, 502, 'У инцидента нет идентификатора ITSM.')
      externalId = source.sysId
    }
    const {card, stateEnum, login} = normalize(
      await request(path(externalId), headers, changes),
      spring ? item : {...item, sysId: externalId},
    )
    const applied: Record<string, unknown> = {
      assignedEmployeeLogin: login,
      assignedGroupName: card.team,
      stateEnum,
      solution: card.solution,
    }
    for (const [field, value] of Object.entries(changes)) {
      check(applied[field] === value, 502, 'Ответ ITSM не подтвердил все поля. Перечитайте карточку.')
    }
    return card
  }

  async function serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const pending = (locks.get(id) ?? Promise.resolve()).then(operation)
    const tail = pending.catch(() => {})
    locks.set(id, tail)
    try {
      return await pending
    } finally {
      if (locks.get(id) === tail) locks.delete(id)
    }
  }
  return {detail, editor, patch, serial}
}

/** A snapshot can arrive while the external write is in flight. */
export function mergeConfirmation(
  before: Incident,
  latest: Incident,
  reply: Incident,
  changes: unknown,
): Incident {
  const conflict = () => {
    throw new ItsmError(409, 'ITSM ответила после обновления карточки. Перечитайте текущее состояние.')
  }
  if (
    (latest.absent && !before.absent) ||
    (latest.sysId && latest.sysId !== (reply.sysId ?? before.sysId)) ||
    (before.sysId && latest.sysId !== before.sysId)
  )
    conflict()
  const requested = object(changes) ? changes : {}
  const assignGroup = latest.team === before.team || latest.team === reply.team
  const assignPerson =
    (latest.assigneeLogin === before.assigneeLogin && latest.assignee === before.assignee) ||
    (latest.assigneeLogin === reply.assigneeLogin && latest.assignee === reply.assignee)
  const useStatus =
    (latest.state === before.state && latest.solution === before.solution) ||
    (latest.state === reply.state && latest.solution === reply.solution)
  if (
    (!assignGroup && 'assignedGroupName' in requested) ||
    (!assignPerson && 'assignedEmployeeLogin' in requested) ||
    (!useStatus && ('stateEnum' in requested || 'solution' in requested))
  )
    conflict()
  const useAssignmentTime =
    latest.assignedEpoch === before.assignedEpoch ||
    (reply.assignedEpoch != null && (latest.assignedEpoch ?? 0) <= reply.assignedEpoch)
  return {
    ...latest,
    sysId: reply.sysId ?? latest.sysId,
    ...(reply.groups && assignGroup && useStatus && {groups: reply.groups}),
    ...(assignGroup && {team: reply.team}),
    ...(assignPerson && {assignee: reply.assignee, assigneeLogin: reply.assigneeLogin}),
    ...(useStatus && {
      state: reply.state,
      research: reply.research,
      restoredEpoch: reply.restoredEpoch,
      restoredAt: reply.restoredAt,
      solution: reply.solution,
    }),
    ...(useAssignmentTime && {assignedAt: reply.assignedAt, assignedEpoch: reply.assignedEpoch}),
  }
}
