import type {IncomingMessage, ServerResponse} from 'node:http'
import {execute, items} from './engine.ts'
import type {Incident} from '../src/demoData.ts'
import type {Desk, Source} from '../src/desk/types.ts'
import {itsmEnumForState, itsmStateLabels, type DirectoryUser, type ItsmState} from '../src/desk/types.ts'
import {directoryLogin, userDirectory} from './directory.ts'

/** Отказ маршрута /api/dashboard в формате AppErrorResponse бэкенда (KAN-58). */
class Rejection extends Error {
  readonly status: number
  readonly code: string
  readonly extra: Record<string, unknown>
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

const patchKeys = ['assignedEmployeeLogin', 'assignedEmployee', 'stateEnum', 'assignedGroupName', 'solution'] as const

function officialCard(d: Desk, i: Incident, users: DirectoryUser[]) {
  return {
    id: i.id,
    header: i.title,
    description: i.description ?? '',
    productName: i.product,
    service: i.service ?? '',
    serviceType: i.serviceType ?? '',
    assignedGroupName: i.team,
    assignedEmployee: i.assignee ?? null,
    assignedEmployeeLogin: directoryLogin(users, i.assignee) ?? null,
    stateEnum: itsmEnumForState(i.state) ?? null,
    state: i.state,
    priorityId: i.priority,
    submitDate: i.registeredAt ? new Date(i.registeredAt).toISOString() : null,
    lastAssignmentToTeamDateTime: i.assignedEpoch ? new Date(i.assignedEpoch).toISOString() : null,
    deadline: i.dueAt != null ? new Date(i.dueAt).toISOString() : null,
    completionDate: i.restoredEpoch ? new Date(i.restoredEpoch).toISOString() : null,
    solution: i.solution ?? '',
    updatedAt: i.updatedAt ? new Date(i.updatedAt).toISOString() : null,
    itsmUrl: null,
    itsmDemo: true,
    eventSeq: d.seq,
    revision: d.version,
  }
}

export function localOfficial(desks: Map<Source, Desk>, save: (desk: Desk, writeCards: boolean) => void) {
  function send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'})
    res.end(JSON.stringify(body))
    return true
  }
  /** PATCH /api/dashboard/incidents/{id} — официальный контракт KAN-58 поверх мок-стенда. */
  async function patchOfficialCard(incidentId: string, body: unknown) {
    if (!/^INC[\d-]*$/i.test(incidentId))
      throw new Rejection(400, 'INVALID_INCIDENT_ID', 'incidentId должен быть номером вида INC000021095531')
    const changes = (body ?? {}) as Record<string, unknown>
    const keys = Object.keys(changes)
    if (!keys.length || !keys.every((key) => (patchKeys as readonly string[]).includes(key)))
      throw new Rejection(400, 'INCIDENT_PATCH_INVALID', 'Изменение должно содержать только поля контракта')
    for (const [key, value] of Object.entries(changes)) {
      if (value === null && (key === 'assignedEmployeeLogin' || key === 'assignedEmployee')) continue
      if (typeof value !== 'string' || !value.trim())
        throw new Rejection(400, 'INCIDENT_PATCH_INVALID', 'Проверьте поле «' + key + '»')
      const limit = key === 'assignedEmployeeLogin' ? 128 : key === 'assignedGroupName' || key === 'assignedEmployee' ? 300 : Infinity
      if ([...value].length > limit)
        throw new Rejection(400, 'INCIDENT_PATCH_INVALID', 'Поле «' + key + '» длиннее допустимого лимита')
    }
    const stateEnum = changes.stateEnum as ItsmState | undefined
    if (stateEnum !== undefined && !(stateEnum in itsmStateLabels))
      throw new Rejection(400, 'INCIDENT_PATCH_INVALID', 'Неизвестный статус: ' + String(stateEnum))
    if (changes.solution !== undefined && !['Resolved', 'Closed', 'Research'].includes(String(stateEnum)))
      throw new Rejection(400, 'INCIDENT_PATCH_INVALID', 'Текст решения передаётся только с завершающим статусом')
    const users = userDirectory(desks)
    if (typeof changes.assignedEmployeeLogin === 'string' && !users.some((u) => u.login === changes.assignedEmployeeLogin))
      throw new Rejection(400, 'ITSM_USER_NOT_FOUND', 'Исполнителя ' + changes.assignedEmployeeLogin + ' нет в справочнике')
    const targets: {d: Desk; key: string; before: Incident | undefined}[] = []
    for (const d of desks.values()) {
      const found = items(d).find((i) => i.id === incidentId)
      if (found) targets.push({d, key: found.key, before: d.records[found.key]})
    }
    if (!targets.length) {
      const d = desks.get('case')!
      throw new Rejection(404, 'INCIDENT_NOT_FOUND', 'Инцидент ' + incidentId + ' не найден', {
        eventSeq: d.seq,
        revision: d.version,
      })
    }
    const current = targets[0].d.records[targets[0].key] ?? items(targets[0].d).find((i) => i.id === incidentId)!
    const nextLabel = stateEnum === undefined ? undefined : itsmStateLabels[stateEnum]
    if (current.state === 'Закрыт' && nextLabel !== undefined && nextLabel !== 'Закрыт')
      throw new Rejection(409, 'INCIDENT_CONFLICT', 'Закрытый инцидент нельзя перевести в другой статус')
    const data: Record<string, unknown> = {}
    if (typeof changes.assignedGroupName === 'string') data.team = changes.assignedGroupName.trim()
    if (changes.assignedEmployeeLogin !== undefined)
      data.assignee = users.find((u) => u.login === changes.assignedEmployeeLogin)?.name ?? ''
    if (nextLabel !== undefined) {
      data.state = nextLabel
      if (typeof changes.solution === 'string') data.solution = changes.solution
      else if (stateEnum === 'Assigned' || stateEnum === 'WorkInProgress') {
        if (current.solution) data.solution = '' // активные статусы очищают решение (контракт KAN-57)
      } else if (!current.solution) data.solution = 'Восстановление подтверждено на стенде.'
    } else if (typeof changes.assignedEmployee === 'string') data.assignee = changes.assignedEmployee
    const now = Date.now()
    let response: {d: Desk; incident: Incident} | undefined
    for (const target of targets) {
      const before = target.d.records[target.key]
      const d = structuredClone(target.d)
      execute(d, {type: 'edit', key: target.key, data}, now)
      const incident = d.records[target.key]!
      // Повторная публикация того же состояния не меняет карточку и не плодит историю.
      if (JSON.stringify(incident) === JSON.stringify(before ?? current)) continue
      save(d, true)
      response ??= {d, incident}
    }
    return officialCard(response?.d ?? targets[0].d, response?.incident ?? current, users)
  }
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (url.pathname === '/api/dashboard/users' && req.method === 'GET')
      return send(res, 200, userDirectory(desks))
    const official = req.method === 'PATCH' ? /^\/api\/dashboard\/incidents\/([^/]+)$/.exec(url.pathname) : null
    if (official) {
      try {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
          return send(res, 403, {code: 'FORBIDDEN_ORIGIN', message: 'Источник запроса не совпадает'})
        if (!req.headers['content-type']?.startsWith('application/json'))
          return send(res, 415, {code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Нужен application/json'})
        const parts: Buffer[] = []
        let bytes = 0
        for await (const chunk of req) {
          bytes += chunk.length
          if (bytes > 1024 * 1024) return send(res, 413, {code: 'REQUEST_BODY_TOO_LARGE', message: 'Тело больше 1 МБ'})
          parts.push(Buffer.from(chunk))
        }
        const card = await patchOfficialCard(decodeURIComponent(official[1]), JSON.parse(Buffer.concat(parts).toString('utf8')))
        return send(res, 200, card)
      } catch (e) {
        if (e instanceof Rejection)
          return send(res, e.status, {code: e.code, message: e.message, ...e.extra})
        const message = e instanceof Error ? e.message : 'Ошибка запроса'
        return send(res, /окончателен|изменилась/.test(message) ? 409 : 400, {code: 'INCIDENT_PATCH_INVALID', message})
      }
    }
    return false
  }
}
