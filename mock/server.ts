import {createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {mkdirSync, readFileSync, statSync} from 'node:fs'
import {join, resolve} from 'node:path'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {groupModelWorker} from './groupModel.ts'
import {pendingGroupReviews, applyGroupReview, reconcileGroups} from './incidentGroups.ts'
import {sampleMonitorHistory} from './monitorHistory.ts'
import {shopStand} from './shop.ts'
import {applyCard, applySnapshot, createDesk, dispatchTasks, execute, items, lookup, tickDesk} from './engine.ts'
import {itsmGateway, ItsmError, mergeConfirmation} from './itsm.ts'
import {requireWorkspaceUser, workspaceAuthSettings} from './workspaceAuth.ts'
import type {Desk, Command, Source} from '../src/desk/types.ts'

export function mockService(
  directory = process.env.MCC_STATE_DIR || resolve('.mcc-stand'),
  file = process.env.MCC_SOURCE_FILE || resolve('mock/fixtures/incidents.json'),
  external: Parameters<typeof itsmGateway>[0] = {itsm: process.env.MCC_ITSM_URL, dashboard: process.env.MCC_DASHBOARD_URL},
  auth = workspaceAuthSettings(),
) {
  const gateway = itsmGateway(external)
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
    const withoutGroups = !d.outageGroups
    if (withoutGroups) reconcileGroups(d,items(d),Date.now())
    desks.set(mode, d)
    if (!row || legacy || withoutGroups) save(d)
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
  const groupReviewer = groupModelWorker(
    mode => pendingGroupReviews(desks.get(mode)!),
    (mode, candidate, verdict) => {
      const next = structuredClone(desks.get(mode)!)
      if (applyGroupReview(next, candidate, verdict, Date.now(), items(next))) save(next, false)
    },
  )
  const timer = setInterval(() => {
    const now = Date.now()
    pollFile()
    for (const d of desks.values()) {
      const ticked = tickDesk(d, now)
      if (sampleMonitorHistory(d, () => items(d), now) || ticked) save(d, false)
    }
    void groupReviewer.check()
  }, 1000)
  timer.unref()
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'})
    res.end(JSON.stringify(body))
  }
  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = new URL(req.url ?? '/', 'http://stand.local')
    if (req.method === 'GET' && url.pathname === '/auth/config') {
      return send(res, 200, {url: auth.url, realm: auth.realm, clientId: auth.clientId})
    }
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return next()
    if (!await requireWorkspaceUser(req, res, auth.profileUrl)) return
    if (!url.pathname.startsWith('/api/stand/')) return send(res, 404, {error: 'Неизвестный маршрут API.'})
    const mode = url.searchParams.get('mode') ?? 'volume'
    if (mode !== 'case' && mode !== 'volume') return send(res, 400, {error: 'Неизвестный источник'})
    const current = () => desks.get(mode)!
    try {
      const itsmPath = url.pathname === '/api/stand/itsm'
      function knownCard(key: unknown) {
        const card = typeof key === 'string' ? lookup(current(),key) : undefined
        if (!card) throw new ItsmError(404,'Карточка не найдена в рабочем месте.')
        return card
      }
      async function externalEdit(key: unknown, changes: unknown, expected: unknown, handoff?: Command) {
        if (!gateway) throw new ItsmError(503,'Внешняя ITSM не подключена.')
        const item = knownCard(key)
        return gateway.serial(item.id,async()=>{
          const before=knownCard(key)
          if (typeof expected !== 'number' || expected !== (before.updatedAt ?? 0))
            throw new ItsmError(409,'Карточка уже изменилась. Перечитайте данные перед сохранением.')
          if (handoff) execute(structuredClone(current()),handoff,Date.now())
          const card=await gateway.patch(before,changes,req.headers)
          // An unrelated poll or another INC may have changed while ITSM was answering.
          const d=structuredClone(current()), previous=lookup(d,item.key)!
          const confirmed=mergeConfirmation(before,previous,card,changes)
          const now=Date.now()
          applyCard(d,confirmed,now)
          dispatchTasks(d,now)
          save(d)
          return {id:item.id,team:confirmed.team,assignee:confirmed.assignee??null,state:confirmed.state}
        })
      }
      if (req.method === 'GET' && itsmPath) {
        if (!gateway) return send(res,200,{external:false})
        const item = knownCard(url.searchParams.get('key'))
        return send(res,200,{...await gateway.editor(item,req.headers),expected:item.updatedAt??0})
      }
      if (req.method === 'GET' && url.pathname === '/api/stand/snapshot') {
        const d = current()
        return send(res, 200, {
          version: d.version,
          itsmExternal: Boolean(gateway),
          checked: mode === 'case' && d.input === 'file' ? lastChecked : Date.now(),
          now: Date.now(),
          desk: url.searchParams.get('since') === String(d.version) ? null : d,
        })
      }
      if (
        (req.method === 'POST' && (url.pathname === '/api/stand/action' || url.pathname === '/api/stand/shop')) ||
        (req.method === 'PATCH' && itsmPath)
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
        if (itsmPath) return send(res,200,await externalEdit(url.searchParams.get('key'),body?.changes,body?.expected))
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
        if (gateway && cmd.type === 'edit') throw new ItsmError(400,'Сохраните изменение через форму «Изменить в ITSM».')
        if (gateway && cmd.type === 'handoff') {
          await externalEdit(cmd.key,{assignedGroupName:cmd.value},cmd.expected,cmd)
        } else {
          const d = structuredClone(current())
          execute(d, cmd, now)
          if (cmd.type === 'watchFile') delete d.fileDigest
          save(d, ['edit', 'upload', 'handoff', 'wifi', 'demo'].includes(cmd.type))
        }
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
      send(res, e instanceof ItsmError ? e.status : /устарело|изменилась|другому дежурному/.test(message) ? 409 : 400, {error: message})
    }
  }
  return {
    handle,
    close() {
      clearInterval(timer)
      groupReviewer.close()
      db.close()
    },
  }
}
