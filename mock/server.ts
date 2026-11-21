import {createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {mkdirSync, readFileSync, statSync} from 'node:fs'
import {join, resolve} from 'node:path'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {shopStand} from './shop.ts'
import {applySnapshot, createDesk, execute, items, standDesk, tickDesk} from './engine.ts'
import {directoryLogin, userDirectory} from './directory.ts'
import {initialIncidents} from './demoData.ts'
import {itsmEnumForState, itsmStateLabels, type Command, type Desk, type DirectoryUser, type Incident, type ItsmState, type Source} from '../src/desk/types.ts'

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

export function mockService(
  directory = process.env.MCC_STATE_DIR || resolve('.mcc-stand'),
  file = process.env.MCC_SOURCE_FILE || resolve('mock/fixtures/incidents.json'),
) {
  const relationshipEdges = JSON.parse(
    readFileSync(
      process.env.MCC_RELATIONSHIPS_FILE || resolve('mock/fixtures/incident-relationships.json'),
      'utf8',
    ),
  ) as {parentId: string; childId: string}[]
  mkdirSync(directory, {recursive: true})
  const db = new DatabaseSync(join(directory, 'workspace.sqlite'))
  db.exec(
    'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS workspace (mode TEXT PRIMARY KEY, body TEXT NOT NULL)',
  )
  const write = db.prepare(
    'INSERT INTO workspace VALUES (?,?) ON CONFLICT(mode) DO UPDATE SET body=excluded.body',
  )
  const desks = new Map<Source, Desk>()
  db.exec(
    'CREATE TABLE IF NOT EXISTS incident (mode TEXT, key TEXT, body TEXT NOT NULL, PRIMARY KEY(mode,key)); CREATE TABLE IF NOT EXISTS revisions (mode TEXT, key TEXT, body TEXT NOT NULL, PRIMARY KEY(mode,key));',
  )
  const cardWrite = db.prepare(
    'INSERT INTO incident VALUES (?,?,?) ON CONFLICT(mode,key) DO UPDATE SET body=excluded.body WHERE incident.body!=excluded.body',
  )
  const revisionWrite = db.prepare(
    'INSERT INTO revisions VALUES (?,?,?) ON CONFLICT(mode,key) DO UPDATE SET body=excluded.body WHERE revisions.body!=excluded.body',
  )
  let seenFile = '',
    lastChecked = 0
  function save(d: Desk, writeCards = true) {
    const {records, revisions, ...meta} = d
    const version = d.version + 1
    db.exec('BEGIN IMMEDIATE')
    try {
      if (writeCards) {
        for (const [key, row] of Object.entries(records)) cardWrite.run(d.mode, key, JSON.stringify(row))
        for (const [key, history] of Object.entries(revisions))
          revisionWrite.run(d.mode, key, JSON.stringify(history))
      }
      write.run(d.mode, JSON.stringify({...meta, version}))
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    d.version = version
    desks.set(d.mode, d)
  }
  for (const mode of ['case', 'volume'] as const) {
    const row = db.prepare('SELECT body FROM workspace WHERE mode=?').get(mode)
    const d: Desk = row ? JSON.parse(String(row.body)) : createDesk(mode, Date.now())
    const readRows = (table: 'incident' | 'revisions') =>
      Object.fromEntries(
        db
          .prepare('SELECT key,body FROM ' + table + ' WHERE mode=?')
          .all(mode)
          .map((r) => [String(r.key), JSON.parse(String(r.body))]),
      )
    const legacy = row && d.records !== undefined
    d.records ??= readRows('incident')
    d.revisions ??= readRows('revisions')
    desks.set(mode, d)
    if (!row || legacy) save(d)
  }
  function pollFile() {
    const d = desks.get('case')!
    if (d.input !== 'file') return
    const now = Date.now()
    try {
      const info = statSync(file),
        tag = info.mtimeMs + ':' + info.size
      if (tag === seenFile && !d.sourceError) {
        lastChecked = now
        return
      }
      const raw = readFileSync(file, 'utf8'),
        digest = createHash('sha256').update(raw).digest('hex')
      if (digest !== d.fileDigest) {
        const next = structuredClone(d)
        applySnapshot(next, JSON.parse(raw), now)
        next.fileDigest = digest
        save(next)
      } else if (d.sourceError) {
        d.sourceError = ''
        save(d, false)
      }
      seenFile = tag
      lastChecked = now
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось прочитать JSON'
      if (d.sourceError !== msg) {
        d.sourceError = msg
        save(d)
      }
    }
  }
  const shop = shopStand()
  pollFile()
  const timer = setInterval(() => {
    const now = Date.now()
    pollFile()
    for (const d of desks.values()) if (tickDesk(d, now)) save(d, false)
  }, 1000)
  timer.unref()
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'})
    res.end(JSON.stringify(body))
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
  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = new URL(req.url ?? '/', 'http://stand.local')
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
    const apiDesk = () => desks.get('case')!
    const stateEnum = (item: Desk['records'][string]) => {
      if (item.research) return 'Research'
      if (item.state === 'Завершён' || item.state === 'Завершен') return 'Resolved'
      if (item.state === 'Закрыт') return 'Closed'
      if (item.state === 'Выполняется' || item.state === 'В работе') return 'WorkInProgress'
      return 'Assigned'
    }
    const groupRules = {
      critical: ['Критические', 'Активный инцидент с приоритетом 4'],
      coordinator: ['На координаторах', 'Назначен координаторам'],
      high: ['Высокий приоритет', 'Активный инцидент с приоритетом 3'],
      research: ['Исследование ситуации', 'Сбой устранён, причины исследуются'],
    } as const
    type Group = keyof typeof groupRules
    const apiGroups = (item: Desk['records'][string]) => {
      const state = stateEnum(item)
      const active = state === 'Assigned' || state === 'WorkInProgress'
      const groups: Group[] = []
      if (active && item.priority === 4) groups.push('critical')
      if ((active || state === 'Research') && item.team === 'КЦ ИТ Координаторы Массовых Инцидентов') {
        groups.push('coordinator')
      }
      if (active && item.priority === 3) groups.push('high')
      if (state === 'Research') groups.push('research')
      return groups
    }
    const isoDate = (value?: number | null) => value == null ? null : new Date(value).toISOString()
    const apiIncident = (item: Desk['records'][string]) => ({
      id: item.id,
      productName: item.product || null,
      assignedGroupName: item.team || null,
      stateEnum: stateEnum(item),
      priorityId: item.priority,
      submitDate: new Date(item.registeredAt ?? apiDesk().started).toISOString(),
      deadline: isoDate(item.dueAt),
      completionDate: isoDate(item.restoredEpoch),
      groupMemberships: apiGroups(item).map(group => ({group, matchedRule: groupRules[group][1]})),
    })

    if (req.method === 'GET' && url.pathname === '/api/dashboard/incidents') {
      const d = apiDesk()
      const groupKeys = Object.keys(groupRules) as Group[]
      const selected = url.searchParams.getAll('group')
      if (selected.some(group => !Object.hasOwn(groupRules, group))) {
        return send(res, 400, {code: 'INVALID_GROUP', message: 'Неизвестная группа'})
      }
      const includeCompleted = url.searchParams.get('includeCompleted') === 'true'
      const revision = d.lastImport ? d.version : 0
      const requestedCursor = url.searchParams.get('cursor')
      const limit = Number(url.searchParams.get('limit') ?? 50)
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return send(res, 400, {code: 'INVALID_LIMIT', message: 'Недопустимый размер страницы'})
      }
      const signature = JSON.stringify([revision, selected, includeCompleted, limit])
      const cursorPrefix = Buffer.from(signature).toString('base64url') + '.'
      const start = requestedCursor ? Number(requestedCursor.slice(cursorPrefix.length)) : 0
      if (requestedCursor && (!requestedCursor.startsWith(cursorPrefix) || !Number.isSafeInteger(start) || start < 1)) {
        return send(res, 400, {code: 'INVALID_CURSOR', message: 'Снимок или параметры изменились'})
      }
      const etag = '"' + createHash('sha256').update(signature + ':' + start).digest('hex') + '"'
      res.setHeader('ETag', etag)
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304)
        res.end()
        return
      }
      const rows = Object.values(d.records)
        .filter(item => !item.absent && (includeCompleted || !['Resolved', 'Closed'].includes(stateEnum(item))))
        .sort((first, second) =>
          (second.updatedAt ?? second.registeredAt ?? 0) - (first.updatedAt ?? first.registeredAt ?? 0) ||
          first.id.localeCompare(second.id))
        .map(apiIncident)
        .filter(item => !selected.length || item.groupMemberships.some(({group}) => selected.includes(group)))
      const items = rows.slice(start, start + limit)
      const groups = start || !d.lastImport ? [] : groupKeys.map(key => {
        const included = selected.length === 0 || selected.includes(key)
        const inGroup = (item: ReturnType<typeof apiIncident>) => item.groupMemberships.some(membership => membership.group === key)
        return {
          key,
          title: groupRules[key][0],
          rule: groupRules[key][1],
          active: key !== 'research',
          incidentCount: included ? rows.filter(inGroup).length : 0,
          incidents: included ? items.filter(inGroup) : [],
          fixed: null,
        }
      })
      return send(res, 200, {
        revision,
        eventSeq: revision,
        beforeFirstSuccess: !d.lastImport,
        groups,
        items,
        nextCursor: start + limit < rows.length ? cursorPrefix + String(start + limit) : null,
      })
    }
    if (req.method === 'GET' && url.pathname === '/api/dashboard/monitoring/summary') {
      const desk = apiDesk()
      const counts = {critical: 0, high: 0, coordinators: 0, research: 0}
      const priorities = new Map<number, number>()
      const loads = new Map<string, number>()
      let activeCount = 0
      for (const incident of Object.values(desk.records)) {
        if (incident.absent) continue
        const groups = apiGroups(incident)
        for (const group of groups) counts[group === 'coordinator' ? 'coordinators' : group] += 1
        if (!['Assigned', 'WorkInProgress'].includes(stateEnum(incident))) continue
        activeCount += 1
        priorities.set(incident.priority, (priorities.get(incident.priority) ?? 0) + 1)
        if (groups.includes('coordinator') && incident.assignee) {
          loads.set(incident.assignee, (loads.get(incident.assignee) ?? 0) + 1)
        }
      }
      return send(res, 200, {
        updatedAt: desk.lastImport ? new Date(desk.lastImport).toISOString() : null,
        activeCount,
        counts,
        timeline: [],
        priorities: [...priorities].map(([priorityId, count]) => ({priorityId, count})),
        coordinatorLoad: [...loads].map(([name, count]) => ({name, count})),
      })
    }
    if (req.method === 'GET' && url.pathname === '/api/snapshot/status') {
      const d = apiDesk()
      const lastSuccessAt = d.lastImport ? new Date(d.lastImport).toISOString() : null
      const lastReceivedAt = lastChecked
        ? new Date(lastChecked).toISOString()
        : lastSuccessAt
      return send(res, 200, {
        lastReceivedAt,
        lastSuccessAt,
        revision: lastSuccessAt ? d.version : null,
        stale: Boolean(d.sourceError || !lastSuccessAt),
      })
    }
    const relationshipPath = url.pathname.match(
      /^\/api\/incidents\/([^/]+)\/relationships$/,
    )
    if (req.method === 'GET' && relationshipPath) {
      const number = decodeURIComponent(relationshipPath[1])
      // The API source reads the case snapshot, while the dashboard can open a
      // generated volume card. Resolve both so the read-only graph stays local
      // and shows the empty state instead of a misleading 404.
      const records = [
        ...Object.values(apiDesk().records),
        ...Object.values(desks.get('volume')!.records),
        ...initialIncidents,
      ]
      const findRecord = (id: string) =>
        records.find((record) => record.id === id && !record.absent)
      const item = findRecord(number)
      if (!item) {
        return send(res, 404, {
          code: 'RESOURCE_NOT_FOUND',
          message: `Resource with id ${number} not found`,
        })
      }
      const edges = relationshipEdges.filter(
        (edge) => edge.parentId === number || edge.childId === number,
      )
      const ids = [...new Set([number, ...edges.flatMap((edge) => [edge.parentId, edge.childId])])]
      const nodes = ids.map((id) => {
        const record = findRecord(id)
        return record
          ? {id, title: record.title, stateEnum: stateEnum(record), priorityId: record.priority}
          : {id, title: null, stateEnum: null, priorityId: null}
      })
      return send(res, 200, {focusId: number, nodes, edges})
    }
    const incidentPath = url.pathname.match(/^\/api\/dashboard\/incidents\/([^/]+)$/)
    if (req.method === 'GET' && incidentPath) {
      const number = decodeURIComponent(incidentPath[1])
      const item = Object.values(apiDesk().records).find(record => record.id === number && !record.absent)
      if (!item) return send(res, 404, {code: 'RESOURCE_NOT_FOUND', message: `Resource with id ${number} not found`})
      const summary = apiIncident(item)
      const isActive = summary.stateEnum === 'Assigned' || summary.stateEnum === 'WorkInProgress'
      const due = isActive ? item.dueAt : null
      const now = Date.now()
      return send(res, 200, {
        ...summary,
        eventSeq: apiDesk().version,
        revision: apiDesk().version,
        header: item.title,
        description: item.description ?? null,
        service: item.service || null,
        serviceType: item.serviceType || null,
        assignedEmployee: item.assignee ?? null,
        remainingSeconds: due == null ? null : Math.floor((due - now) / 1000),
        overdue: due != null && now > due,
        itsmUrl: new URL('/#itsm/' + encodeURIComponent(item.key), 'http://' + req.headers.host).href,
        itsmDemo: true,
      })
    }

    if (!url.pathname.startsWith('/api/stand/')) return next()
    const mode = url.searchParams.get('mode') ?? 'volume'
    if (mode !== 'case' && mode !== 'volume') return send(res, 400, {error: 'Неизвестный источник'})
    const current = () => desks.get(mode)!
    try {
      if (req.method === 'GET' && url.pathname === '/api/stand/snapshot') {
        const d = current()
        return send(res, 200, {
          version: d.version,
          checked: mode === 'case' && d.input === 'file' ? lastChecked : Date.now(),
          now: Date.now(),
          desk: url.searchParams.get('since') === String(d.version) ? null : standDesk(d),
        })
      }
      if (
        req.method === 'POST' &&
        (url.pathname === '/api/stand/action' || url.pathname === '/api/stand/shop')
      ) {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
          return send(res, 403, {error: 'Источник запроса не совпадает'})
        if (!req.headers['content-type']?.startsWith('application/json'))
          return send(res, 415, {error: 'Нужен application/json'})
        const parts: Buffer[] = []
        let bytes = 0
        for await (const chunk of req) {
          bytes += chunk.length
          if (bytes > 8 * 1024 * 1024) return send(res, 413, {error: 'Файл больше 8 МБ'})
          parts.push(Buffer.from(chunk))
        }
        const body = JSON.parse(Buffer.concat(parts).toString('utf8'))
        if (url.pathname === '/api/stand/shop') {
          if (mode !== 'volume') throw Error('Демомагазин работает на наборе большой смены.')
          if (body.type === 'start') {
            const w = current().work.incident
            if (w?.telemetryOffline) throw Error('Нет свежих измерений.')
            return send(res, 200, {id: shop.start(w?.profile ?? 'database', body.input, Date.now())})
          }
          if (body.type === 'order') return send(res, 200, shop.order(body.id, body.leg, body.order))
          if (body.type === 'finish') {
            const result = shop.finish(body.id),
              d = structuredClone(current())
            execute(
              d,
              {type: 'report', key: 'incident', title: 'Эксперимент восстановления', text: result.text},
              Date.now(),
            )
            save(d, false)
            result.release()
            return send(res, 200, {ok: true})
          }
          throw Error('Неизвестная операция магазина.')
        }
        const cmd = body as Command
        if (!cmd || typeof cmd.type !== 'string') throw Error('Нет действия')
        const now = Date.now()
        if ((cmd.type === 'upload' || cmd.type === 'watchFile') && mode !== 'case')
          throw Error('Выберите источник «Кейс МТС».')
        const d = structuredClone(current())
        execute(d, cmd, now)
        if (cmd.type === 'watchFile') delete d.fileDigest
        save(d, ['edit', 'upload', 'handoff', 'wifi', 'demo'].includes(cmd.type))
        if (cmd.type === 'watchFile') {
          seenFile = ''
          pollFile()
        }
        return send(res, 200, {
          desk: standDesk(current()),
          version: current().version,
          now,
          checked: mode === 'case' && current().input === 'file' ? lastChecked : now,
        })
      }
      send(res, 404, {error: 'Метод стенда не найден'})
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Ошибка запроса'
      send(res, /устарело|изменилась|другому дежурному/.test(message) ? 409 : 400, {error: message})
    }
  }
  return {
    handle,
    close() {
      clearInterval(timer)
      db.close()
    },
  }
}
