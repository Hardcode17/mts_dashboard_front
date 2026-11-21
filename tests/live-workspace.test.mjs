import {strict as assert} from 'node:assert'
import {mkdtemp, rm} from 'node:fs/promises'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {setTimeout as delay} from 'node:timers/promises'
import {liveWorkspaceService} from '../mock/server.ts'
import {belongsToQueue, fullTime} from '../src/desk/types.ts'
import {cardTimeline} from '../src/desk/timeline.ts'

async function listen(handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise(resolve => {
      server.close(resolve)
      server.closeAllConnections()
    }),
  }
}

test('live workspace shares real ownership and commits only the edits acknowledged by Spring', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'live-mcc-'))
  const root = 'INC000000210', child = 'INC000000211'
  const fields = {
    submitDate: new Date().toISOString(), deadline: null, completionDate: null,
    stateEnum: 'Assigned', priorityId: 4, assignedGroupName: 'Официальная группа', assignedEmployeeLogin: null,
    productName: 'Платформа', groupMemberships: [{group: 'high', matchedRule: 'test'}],
  }
  const cards = [root, child].map(id => ({...fields, id, header: 'Сбой ' + id, description: 'Отказ доставки',
    service: 'Доставка', assignedEmployee: null, itsmUrl: 'https://example.test/' + id, itsmDemo: false}))
  cards[0].deadlineRisk = {risk: 'unknown', evaluatedAt: fields.submitDate,
    reasons: [{code: 'no_history', text: 'Недостаточно исторических данных'}], score: null}
  cards[0].deadline = new Date(Date.now() + 600_000).toISOString()
  let revision = 0, stale = false, rejectEdit = false, sourceDown = true
  const writes = [], events = [], detailReads = []
  const acknowledged = []
  let rejectAck = true
  const alarms = [
    {eventId: 'evt-0001', incidentId: root, occurredAt: fields.submitDate, ackRequired: true},
    {eventId: 'evt-0002', incidentId: child, occurredAt: fields.submitDate, ackRequired: true},
    {eventId: 'evt-0003', incidentId: child, occurredAt: fields.submitDate, ackRequired: false},
  ]
  let delayNextDetail = false, finishOlderRead
  const spring = await listen(async (req, res) => {
    const url = new URL(req.url, 'http://spring')
    const person = req.headers.authorization?.split(' ')[1]
    const reply = (value, status = 200) => {
      res.writeHead(status, {'Content-Type': 'application/json'})
      res.end(JSON.stringify(value))
    }
    if (!['alice', 'bob'].includes(person)) return reply({}, 401)
    if (url.pathname === '/api/me') return reply({subject: person, name: person.toUpperCase()})
    if (url.pathname === '/api/snapshot/status') return reply({stale, lastSuccessAt: revision ? fields.submitDate : null})
    if (url.pathname === '/api/dashboard/incidents') {
      if (sourceDown) return reply({}, 503)
      const cursor = url.searchParams.get('cursor')
      assert.equal(url.searchParams.get('includeCompleted'), 'true')
      if (!cursor && req.headers['if-none-match'] === '"' + revision + '"') return res.writeHead(304).end()
      res.setHeader('ETag', '"' + revision + '"')
      return reply({eventSeq: revision, revision, beforeFirstSuccess: !revision, groups: revision && !cursor
        ? [{key: 'high', incidentCount: 2}, {key: 'critical', incidentCount: 0}] : [],
      items: revision ? [cards[cursor ? 1 : 0]] : [], nextCursor: revision && !cursor ? 'next' : null})
    }
    if (url.pathname === '/api/dashboard/incidents/changes') {
      const after = Number(url.searchParams.get('afterEventSeq'))
      const newer = events.filter(e => e.eventSeq > after)
      return reply({events: newer, hasMore: false, lastEventSeq: newer.at(-1)?.eventSeq ?? after})
    }
    if (url.pathname === '/api/dashboard/shift/events') {
      return reply({events: alarms.filter(event => !acknowledged.includes(event.eventId)), nextEventSeq: 3})
    }
    if (url.pathname === '/api/dashboard/shift/events/ack') {
      assert.equal(person, 'alice')
      let body = ''
      for await (const chunk of req) body += chunk
      assert.deepEqual(JSON.parse(body), {eventIds: ['evt-0001']})
      if (rejectAck) return reply({code: 'CONFLICT', message: 'Сигнал уже изменился.'}, 409)
      acknowledged.push('evt-0001')
      return reply({confirmedEventIds: acknowledged})
    }
    if (url.pathname === '/api/dashboard/users')
      return reply([{login: 'duty', displayName: 'Инженер смены', groupName: 'Дежурные'}])
    const key = url.pathname.split('/').at(-1)
    const card = cards.find(i => i.id === key)
    if (url.pathname.endsWith('/relationships')) {
      const focusId = url.pathname.split('/').at(-2)
      return reply({focusId, nodes: [], edges: [{parentId: root, childId: child}]})
    }
    if (!card) return reply({}, 404)
    if (req.method === 'GET') {
      detailReads.push(card.id)
      if (card.id === root && delayNextDetail) {
        delayNextDetail = false
        const older = {...card, revision, eventSeq: revision}
        await new Promise(resolve => { finishOlderRead = resolve })
        return reply(older)
      }
    }
    if (req.method === 'PATCH') {
      if (rejectEdit) return reply({}, 403)
      let body = ''
      for await (const chunk of req) body += chunk
      const changes = JSON.parse(body)
      writes.push([person, changes])
      Object.assign(card, changes, {assignedEmployee: 'Инженер смены'})
      revision++
    }
    return reply({...card, revision, eventSeq: revision})
  })
  async function start() {
    const service = liveWorkspaceService(spring.url, directory)
    const http = await listen((req, res) => service.handle(req, res, () => res.writeHead(404).end()))
    return {url: http.url, close: async () => { await http.close(); service.close() }}
  }
  let workspace = await start()
  t.after(async () => {
    await workspace.close()
    await spring.close()
    await rm(directory, {recursive: true, force: true})
  })
  async function call(path, person = 'alice', method = 'GET', body) {
    return fetch(workspace.url + '/api/workspace/' + path, {method, headers: {
      ...(person ? {authorization: 'Bearer ' + person} : {}), ...(body ? {'content-type': 'application/json'} : {}),
    }, body: body && JSON.stringify(body)})
  }
  const read = async (person) => (await call('snapshot', person)).json()
  assert.equal((await call('snapshot', '')).status, 401)
  assert.equal((await call('itsm?key=' + root, '', 'PATCH', {changes: {assignedEmployeeLogin: 'duty'}})).status, 401)
  const outage = await read()
  assert.equal(outage.desk.apiBeforeFirstSuccess, true)
  assert.match(outage.desk.sourceError, /Spring/)
  assert.deepEqual(outage.desk.records, {})
  assert.equal((await call('action', 'alice', 'POST', {type: 'accept'})).status, 503)
  sourceDown = false
  const first = await read()
  assert.equal(first.person, 'alice')
  assert.equal(first.desk.apiBeforeFirstSuccess, true)
  assert.equal(first.desk.sourceError, '')
  assert.deepEqual(first.desk.records, {})
  assert.deepEqual(first.desk.people.map(p => p.id), ['alice'])
  assert.equal((await call('snapshot?mode=volume')).status, 400)
  revision++
  let desk
  for (let i = 0; i < 80; i++) {
    desk = (await read()).desk
    if (desk?.outageGroups?.some(g => g.members.length === 2)) break
    await delay(50)
  }
  assert.deepEqual(Object.keys(desk.records).sort(), [root, child])
  assert.equal(desk.records[root].title, cards[0].header)
  assert.deepEqual(desk.records[root].deadlineRisk, {risk: 'unknown', evaluatedAt: fields.submitDate,
    reasons: cards[0].deadlineRisk.reasons})
  assert.equal(belongsToQueue(desk.records[root], 'critical'), false)
  assert.equal(belongsToQueue(desk.records[root], 'high'), true)
  assert.equal(desk.apiCounts.high, 2)
  assert.deepEqual(desk.signals.map(signal => signal.id), ['evt-0001', 'evt-0002'])
  const ack = ids => call('action', 'alice', 'POST', {type: 'ack', ids})
  assert.equal((await ack(['1'])).status, 400)
  assert.equal((await ack(['evt-0001'])).status, 409)
  assert.deepEqual(acknowledged, [])
  assert(!(await read()).desk.signals.some(signal => signal.acknowledged))
  rejectAck = false
  const receipt = await ack(['evt-0001'])
  assert.equal(receipt.status, 200)
  const {desk: afterAck} = await receipt.json()
  assert(afterAck.quietUntil > Date.now())
  assert.deepEqual(afterAck.signals.filter(signal => !signal.acknowledged).map(signal => signal.id), ['evt-0002'])
  const group = desk.outageGroups.find(g => g.members.length === 2)
  assert.equal(group.method, 'parent')
  await delay(1100)
  assert.deepEqual((await read()).desk.events.filter(event => event.kind === 'due'), [])

  const observedAt = new Date().toISOString()
  const warning = {
    eventSeq: 46, eventId: 'local-46', incidentId: root, changeRevision: revision,
    changeKind: 'DEADLINE_APPROACHING', observedAt, fields: [],
    details: {deadline: cards[0].deadline, ruleVersion: 1},
  }
  events.push(warning)
  for (let i = 0; i < 80; i++) {
    desk = (await read()).desk
    if (desk.events.some(event => event.id === warning.eventId)) break
    await delay(50)
  }
  const deadlineEntries = desk.events.filter(event => event.kind === 'due')
  assert.equal(deadlineEntries.length, 1)
  assert.equal(deadlineEntries[0].id, warning.eventId)
  assert.equal(deadlineEntries[0].key, root)
  assert.equal(deadlineEntries[0].at, Date.parse(observedAt))
  assert.equal(deadlineEntries[0].change, 'Срок решения ' + fullTime(Date.parse(cards[0].deadline)) + ' МСК')
  assert(cardTimeline(desk, desk.records[root]).some(row => row.journalIds?.includes(warning.eventId)))
  assert.deepEqual(desk.signals.filter(signal => !signal.acknowledged).map(signal => signal.id), ['evt-0002'])
  const detailsBeforeChange = detailReads.length
  cards[1].header = 'Симптом уточнён'
  events.push({eventSeq: 47, changeRevision: ++revision, incidentId: child})
  for (let i = 0; i < 80; i++) {
    desk = (await read()).desk
    if (desk.records[child].title === cards[1].header) break
    await delay(50)
  }
  assert.equal(desk.records[child].title, cards[1].header)
  assert.deepEqual(detailReads.slice(detailsBeforeChange), [child])
  assert.equal((await call('action', 'alice', 'POST', {type: 'demo'})).status, 400)
  assert.equal((await call('shop', 'alice', 'POST', {type: 'start'})).status, 404)
  await read('bob')
  const claim = await call('action', 'alice', 'POST', {type: 'groupClaim', id: group.id, expected: group.revision, person: 'bob'})
  assert.equal(claim.status, 200, JSON.stringify(await claim.json()))
  assert.equal((await read('bob')).desk.outageGroups.find(g => g.id === group.id).owner, 'alice')
  const editor = 'itsm?mode=case&key=' + root
  const settings = await (await call(editor)).json()
  assert.equal(settings.external, true)
  assert.equal(settings.users[0].login, 'duty')
  const changes = {assignedEmployeeLogin: 'duty', assignedGroupName: 'Дежурные'}
  const patch = () => call(editor, 'bob', 'PATCH', {expected: settings.expected, changes})
  delayNextDetail = true
  events.push({eventSeq: 48, changeRevision: ++revision, incidentId: root})
  for (let i = 0; i < 80 && !finishOlderRead; i++) {
    await read()
    await delay(50)
  }
  assert.equal(typeof finishOlderRead, 'function')
  rejectEdit = true
  assert.equal((await patch()).status, 403)
  assert.equal((await read()).desk.records[root].team, fields.assignedGroupName)
  rejectEdit = false
  const applied = await patch()
  finishOlderRead()
  assert.equal(applied.status, 200)
  assert.deepEqual(writes, [['bob', changes]])
  assert.equal(cards[0].assignedEmployeeLogin, 'duty')
  assert.equal((await read()).desk.records[root].team, 'Дежурные')
  await workspace.close()
  workspace = await start()
  stale = true
  desk = (await read('bob')).desk
  assert.equal(desk.outageGroups.find(g => g.id === group.id).owner, 'alice')
  assert.ok(desk.sourceError)
  await delay(1100)
  assert.deepEqual((await read('bob')).desk.events.filter(event => event.kind === 'due'), deadlineEntries)
  assert.equal(desk.apiBeforeFirstSuccess, false)
  assert.deepEqual(desk.people.map(p => p.id).sort(), ['alice', 'bob'])
})

test('live shift availability is owned by Spring and does not clear an occupied assignment', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'live-availability-'))
  t.after(() => rm(directory, {recursive: true, force: true}))
  const id = 'INC000000230'
  const incident = {
    id, header: 'Сбой', stateEnum: 'Assigned', priorityId: 3, productName: 'Сервис',
    submitDate: new Date().toISOString(), deadline: null, completionDate: null,
    groupMemberships: [{group: 'coordinator', matchedRule: 'test'}], itsmUrl: 'https://example.test/inc',
  }
  let available = false, generation = 0
  const groups = [{id: 3, name: 'Дежурная группа'}]
  const presence = () => ({
    available, generation, groups, availableSince: generation ? '2026-11-21T10:00:00Z' : null,
  })
  const writes = []
  const spring = await listen(async (req, res) => {
    const reply = (value, status = 200) => {
      res.writeHead(status, {'Content-Type': 'application/json'})
      res.end(JSON.stringify(value))
    }
    if (req.headers.authorization !== 'Bearer alice') return reply({}, 401)
    const path = new URL(req.url, 'http://spring').pathname
    if (path === '/api/me') return reply({subject: 'alice', displayName: 'Алиса', availability: presence()})
    if (path === '/api/me/availability' && req.method === 'PUT') {
      let body = ''
      for await (const chunk of req) body += chunk
      const change = JSON.parse(body)
      writes.push(change)
      if (change.available && !available) generation++
      available = change.available
      return reply(presence())
    }
    if (path === '/api/dashboard/incidents') return reply({
      eventSeq: 1, revision: 1, beforeFirstSuccess: false,
      items: [incident], nextCursor: null, groups: [],
    })
    if (path === '/api/snapshot/status') return reply({lastSuccessAt: incident.submitDate})
    if (path === '/api/dashboard/incidents/changes') return reply({events: [], hasMore: false})
    if (path === '/api/dashboard/incidents/' + id) return reply({...incident, revision: 1, eventSeq: 1})
    return reply({}, 404)
  })
  t.after(spring.close)
  const service = liveWorkspaceService(spring.url, directory)
  const workspace = await listen((req, res) => service.handle(req, res, () => res.writeHead(404).end()))
  t.after(async () => {await workspace.close(); service.close()})
  const request = (path, options = {}) => fetch(workspace.url + '/api/workspace/' + path, {
    ...options, headers: {Authorization: 'Bearer alice', 'Content-Type': 'application/json'},
  })
  const toggle = (person, enabled) => request('action', {
    method: 'POST', body: JSON.stringify({type: 'available', person, enabled}),
  })
  const first = await (await request('snapshot')).json()
  assert.equal(first.desk.people[0].available, false)
  assert.deepEqual(first.desk.people[0].shiftGroups, groups)
  assert.equal((await toggle('bob', true)).status, 403)
  assert.deepEqual(writes, [])

  const after = await (await toggle('alice', true)).json()
  assert.equal(after.desk.people[0].available, true)
  const assignment = after.desk.tasks.find(task => task.key === id).attempts[0]
  assert.equal(assignment.person, 'alice')
  const accept = await request('action', {method: 'POST', body: JSON.stringify({
    type: 'accept', key: id, person: 'alice', id: assignment.id,
  })})
  assert.equal(accept.status, 200)

  const off = await (await toggle('alice', false)).json()
  assert.equal(off.desk.people[0].available, false)
  const preserved = off.desk.tasks.find(task => task.key === id).attempts[0]
  assert.equal(preserved.id, assignment.id)
  assert.ok(preserved.accepted)
  assert.equal(preserved.ended, undefined)
  assert.deepEqual(writes, [{available: true}, {available: false}])
  assert.equal((await (await request('snapshot')).json()).desk.people[0].available, false)
})
