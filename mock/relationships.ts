import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {initialIncidents} from './fixtures/shift.ts'
import type {Desk, Source} from '../src/desk/types.ts'

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'})
  res.end(JSON.stringify(data))
  return true
}

// Read-only equivalents of the Spring routes for an authenticated local workspace.
export function handleFixtureRelationships(
  req: IncomingMessage, res: ServerResponse, desks: Map<Source, Desk>, lastChecked = 0,
): boolean {
  if (req.method !== 'GET') return false
  const url = new URL(req.url ?? '/', 'http://stand.local')
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

  if (url.pathname === '/api/dashboard/incidents') {
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
      return true
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
  if (url.pathname === '/api/dashboard/monitoring/summary') {
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
  if (url.pathname === '/api/snapshot/status') {
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
  if (relationshipPath) {
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
    const fixtureEdges = JSON.parse(readFileSync(
      process.env.MCC_RELATIONSHIPS_FILE || 'mock/fixtures/incident-relationships.json', 'utf8',
    )) as {parentId: string; childId: string}[]
    const relationshipEdges = [...fixtureEdges, ...records.flatMap(record =>
      record.parentId ? [{parentId: record.parentId, childId: record.id}] : [])]
    const edges = [...new Map(relationshipEdges
      .filter(edge => edge.parentId === number || edge.childId === number)
      .map(edge => [JSON.stringify([edge.parentId, edge.childId]), edge])).values()]
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
  if (incidentPath) {
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
      solution: item.solution ?? null,
      assignedEmployeeLogin: item.assigneeLogin ?? null,
      service: item.service || null,
      serviceType: item.serviceType || null,
      assignedEmployee: item.assignee ?? null,
      remainingSeconds: due == null ? null : Math.floor((due - now) / 1000),
      overdue: due != null && now > due,
      itsmUrl: new URL('/#itsm/' + encodeURIComponent(item.key), 'http://' + req.headers.host).href,
      itsmDemo: true,
    })
  }

  return false
}
