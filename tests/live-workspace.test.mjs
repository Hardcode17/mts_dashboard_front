import {strict as assert} from 'node:assert'
import {mkdtemp, rm} from 'node:fs/promises'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {setTimeout as delay} from 'node:timers/promises'
import {liveWorkspaceService} from '../mock/server.ts'
import {belongsToQueue} from '../src/desk/types.ts'

async function listen(handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

test('live workspace shares real ownership and commits only the edits acknowledged by Spring', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'live-mcc-'))
  t.after(() => rm(directory, {recursive: true, force: true}))
  const root = 'INC000000210', child = 'INC000000211'
  const fields = {
    submitDate: new Date().toISOString(), deadline: null, completionDate: null,
    stateEnum: 'Assigned', priorityId: 4, assignedGroupName: 'Официальная группа', assignedEmployeeLogin: null,
    productName: 'Платформа', groupMemberships: [{group: 'high', matchedRule: 'test'}],
  }
  const cards = [root, child].map(id => ({...fields, id, header: 'Сбой ' + id, description: 'Отказ доставки',
    service: 'Доставка', assignedEmployee: null, itsmUrl: 'https://example.test/' + id, itsmDemo: false}))
  let revision = 0, stale = false, rejectEdit = false, sourceDown = true
  const writes = [], events = [], detailReads = []
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
  t.after(spring.close)
  async function start() {
    const service = liveWorkspaceService(spring.url, directory)
    const http = await listen((req, res) => service.handle(req, res, () => res.writeHead(404).end()))
    return {url: http.url, close: async () => { await http.close(); service.close() }}
  }
  let workspace = await start()
  t.after(() => workspace.close())
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
  assert.equal(belongsToQueue(desk.records[root], 'critical'), false)
  assert.equal(belongsToQueue(desk.records[root], 'high'), true)
  assert.equal(desk.apiCounts.high, 2)
  const group = desk.outageGroups.find(g => g.members.length === 2)
  assert.equal(group.method, 'parent')
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
  assert.equal(desk.apiBeforeFirstSuccess, false)
  assert.deepEqual(desk.people.map(p => p.id).sort(), ['alice', 'bob'])
})
