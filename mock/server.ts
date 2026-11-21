import {createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {mkdirSync, readFileSync, statSync} from 'node:fs'
import {join, resolve} from 'node:path'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {shopStand} from './shop.ts'
import {applySnapshot, createDesk, execute, tickDesk} from './engine.ts'
import {initialIncidents} from '../src/demoData.ts'
import type {Desk, Command, Source} from '../src/desk/types.ts'

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
  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = new URL(req.url ?? '/', 'http://stand.local')
    const apiDesk = () => desks.get('case')!
    const stateEnum = (item: Desk['records'][string]) => {
      if (item.research) return 'Research'
      if (item.state === 'Завершён' || item.state === 'Завершен') return 'Resolved'
      if (item.state === 'Закрыт') return 'Closed'
      if (item.state === 'Выполняется' || item.state === 'В работе') return 'WorkInProgress'
      return 'Assigned'
    }
    const apiGroups = (item: Desk['records'][string]) => {
      const state = stateEnum(item)
      const active = state === 'Assigned' || state === 'WorkInProgress'
      const groups: string[] = []
      if (active && item.priority === 4) groups.push('critical')
      if ((active || state === 'Research') && item.team === 'КЦ ИТ Координаторы Массовых Инцидентов') {
        groups.push('coordinators')
      }
      if (active && item.priority === 3) groups.push('high')
      if (state === 'Research') groups.push('research')
      return groups
    }
    const apiIncident = (item: Desk['records'][string], now: number) => {
      const deadline = item.dueAt ?? null
      const isActive = ['Assigned', 'WorkInProgress'].includes(stateEnum(item))
      return {
        id: item.id,
        header: item.title,
        description: item.description ?? null,
        productName: item.product || null,
        service: item.service || null,
        submitDate: new Date(item.registeredAt ?? now).toISOString(),
        updatedAt: new Date(item.updatedAt ?? item.registeredAt ?? now).toISOString(),
        stateEnum: stateEnum(item),
        priorityId: item.priority,
        assignedGroupName: item.team || null,
        assignedEmployee: item.assignee ?? null,
        deadline: deadline === null ? null : new Date(deadline).toISOString(),
        remainingSeconds:
          isActive && deadline !== null
            ? Math.floor((deadline - now) / 1000)
            : null,
        overdue: isActive && deadline !== null && now > deadline,
        groups: apiGroups(item),
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/incidents') {
      const d = apiDesk()
      const now = Date.now()
      const rows = Object.values(d.records).filter((item) => !item.absent)
      const filtered = rows.filter((item) => {
        const state = stateEnum(item)
        const q = url.searchParams.get('q')?.trim().toLocaleLowerCase('ru-RU')
        const deadline = item.dueAt ?? null
        const isActive = state === 'Assigned' || state === 'WorkInProgress'
        const deadlineState = deadline === null
          ? 'unspecified'
          : !isActive
            ? 'inactive'
            : now > deadline
              ? 'overdue'
              : 'withinDeadline'
        return (
          (!q || [item.id, item.title, item.description].join(' ').toLocaleLowerCase('ru-RU').includes(q)) &&
          (!url.searchParams.has('assignedGroupName') || item.team === url.searchParams.get('assignedGroupName')) &&
          (!url.searchParams.has('productName') || item.product === url.searchParams.get('productName')) &&
          (!url.searchParams.has('stateEnum') || state === url.searchParams.get('stateEnum')) &&
          (!url.searchParams.has('priorityId') || item.priority === Number(url.searchParams.get('priorityId'))) &&
          (!url.searchParams.has('deadlineState') || deadlineState === url.searchParams.get('deadlineState'))
        )
      })
      const counts = {critical: 0, coordinators: 0, high: 0, research: 0}
      for (const item of filtered) {
        for (const group of apiGroups(item)) counts[group as keyof typeof counts] += 1
      }
      const group = url.searchParams.get('group')
      const items = filtered
        .filter((item) => !group || apiGroups(item).includes(group))
        .map((item) => apiIncident(item, now))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id))
      return send(res, 200, {
        revision: d.version,
        eventSeq: d.seq,
        counts,
        items,
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
        for (const group of groups) counts[group as keyof typeof counts] += 1
        if (!['Assigned', 'WorkInProgress'].includes(stateEnum(incident))) continue
        activeCount += 1
        priorities.set(incident.priority, (priorities.get(incident.priority) ?? 0) + 1)
        if (groups.includes('coordinators') && incident.assignee) {
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
    const incidentPath = url.pathname.match(/^\/api\/incidents\/([^/]+)$/)
    if (req.method === 'GET' && incidentPath) {
      const number = decodeURIComponent(incidentPath[1])
      const item = Object.values(apiDesk().records).find(
        (record) => record.id === number && !record.absent,
      )
      if (!item) return send(res, 404, {code: 'RESOURCE_NOT_FOUND', message: `Resource with id ${number} not found`})
      return send(res, 200, {
        revision: apiDesk().version,
        incident: apiIncident(item, Date.now()),
        itsmUrl: `https://itsm.example.org/incidents/${encodeURIComponent(item.id)}`,
        itsmDemo: true,
        meetingUrl: null,
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
          desk: url.searchParams.get('since') === String(d.version) ? null : d,
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
          desk: current(),
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
