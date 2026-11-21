import {identityFixture} from './support/identity.mjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {mockService} from '../mock/server.ts'

const [template] = JSON.parse(await readFile(new URL('../mock/fixtures/incidents.json', import.meta.url)))
async function listen(server) {
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return 'http://127.0.0.1:' + server.address().port
}
const close = (server) => new Promise((done) => server.close(done))
test('confirmed remote writes are mirrored, serialized by INC, and never simulated on upstream failure', async (t) => {
  const identity = await identityFixture(t)
  const dir = await mkdtemp(join(tmpdir(), 'mcc-itsm-api-'))
  const file = join(dir, 'source.json')
  let row = {...template, stateEnum: 'Assigned', assignedGroupName: 'Группа А'}
  const users = [{login: 'test-duty', displayName: 'Тестовый дежурный', groupName: 'Группа Б'}]
  let outage = false
  let ignoreWrite = false
  const patches = []
  const blackbox = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://local').pathname
    res.setHeader('content-type', 'application/json')
    if (outage) {
      res.statusCode = 503
      return res.end('{}')
    }
    if (path === '/user') return res.end(JSON.stringify(users))
    if (path !== '/itsm_incident/' + row.sysId) {
      res.statusCode = 404
      return res.end('{}')
    }
    if (req.method === 'PATCH') {
      let body = ''
      for await (const chunk of req) body += chunk
      const changes = JSON.parse(body)
      patches.push(changes)
      if (ignoreWrite) return res.end(JSON.stringify(row))
      row = {...row, ...changes}
      if ('assignedEmployeeLogin' in changes)
        row.assignedEmployee = users.find((u) => u.login === row.assignedEmployeeLogin)?.displayName ?? null
    }
    res.end(JSON.stringify(row))
  })
  const source = await listen(blackbox)
  await writeFile(file, JSON.stringify([row]))
  const service = mockService(dir, file, {itsm: source}, identity.settings)
  const server = createServer((req, res) => service.handle(req, res, () => res.end()))
  const origin = await listen(server)
  t.after(async () => {
    await close(server)
    service.close()
    await close(blackbox)
    await rm(dir, {recursive: true, force: true})
  })
  const url = origin + '/api/stand/itsm?mode=case&key=' + row.id
  const read = async () => (await (await identity.request(origin + '/api/stand/snapshot?mode=case')).json()).desk
  const patch = (changes, expected) =>
    identity.request(url, {
      method: 'PATCH',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({changes, expected}),
    })
  const start = await (await identity.request(url)).json()
  assert.equal(start.external, true)
  assert.equal(start.users[0].login, 'test-duty')
  const first = {assignedEmployeeLogin: 'test-duty', assignedGroupName: 'Группа Б'}
  assert.equal((await patch(first, start.expected)).status, 200)
  assert.equal(
    (await (await fetch(source + '/itsm_incident/' + row.sysId)).json()).assignedEmployeeLogin,
    'test-duty',
  )
  assert.equal((await read()).records[row.id].assignee, 'Тестовый дежурный')
  assert.equal((await patch({assignedGroupName: 'Устаревшее'}, start.expected)).status, 409)
  const expected = (await read()).records[row.id].updatedAt
  const racing = await Promise.all(
    ['Группа В', 'Группа Г'].map((assignedGroupName) => patch({assignedGroupName}, expected)),
  )
  assert.deepEqual(racing.map((r) => r.status).sort(), [200, 409])
  assert.equal(patches.length, 2)
  const before = (await read()).records[row.id]
  ignoreWrite = true
  assert.equal((await patch({assignedGroupName: 'Не подтверждено ответом'}, before.updatedAt)).status, 502)
  assert.equal((await read()).records[row.id].updatedAt, before.updatedAt)
  ignoreWrite = false
  outage = true
  assert.equal((await identity.request(url)).status, 503)
  assert.equal((await patch({assignedGroupName: 'Локальная подмена'}, before.updatedAt)).status, 503)
  const localEdit = await identity.request(origin + '/api/stand/action?mode=case', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      type: 'edit',
      key: row.id,
      expected: before.updatedAt,
      data: {team: 'Локальная подмена'},
    }),
  })
  assert.equal(localEdit.status, 400)
  assert.equal((await read()).records[row.id].team, before.team)
})

test('an in-flight PATCH cannot erase a concurrent official status or retarget another sysId', async (t) => {
  const identity = await identityFixture(t)
  const dir = await mkdtemp(join(tmpdir(), 'mcc-itsm-overlap-'))
  const file = join(dir, 'source.json')
  let upstream = {...template, stateEnum: 'Assigned', assignedGroupName: 'A'}
  await writeFile(file, JSON.stringify([upstream]))
  let release, received
  let waiting
  function holdResponse() {
    const started = new Promise((resolve) => {
      received = resolve
    })
    waiting = new Promise((resolve) => {
      release = resolve
    })
    return started
  }
  const blackbox = createServer(async (req, res) => {
    const old = upstream
    let body = ''
    for await (const c of req) body += c
    if (req.method === 'PATCH') {
      received()
      await waiting
      upstream = {...old, ...JSON.parse(body)}
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(upstream))
  })
  const source = await listen(blackbox)
  const service = mockService(dir, file, {itsm: source}, identity.settings)
  const server = createServer((q, r) => service.handle(q, r, () => r.end()))
  const origin = await listen(server),
    id = template.id
  t.after(async () => {
    release?.()
    await close(server)
    service.close()
    await close(blackbox)
    await rm(dir, {recursive: true, force: true})
  })
  async function current() {
    return (await (await identity.request(origin + '/api/stand/snapshot?mode=case')).json()).desk.records[id]
  }
  async function patch(expected, team) {
    return identity.request(origin + '/api/stand/itsm?mode=case&key=' + id, {
      method: 'PATCH',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({expected, changes: {assignedGroupName: team}}),
    })
  }
  async function publish(row) {
    const response = await identity.request(origin + '/api/stand/action?mode=case', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({type: 'upload', data: [row]}),
    })
    assert.equal(response.status, 200)
  }
  const started = holdResponse(),
    pending = patch((await current()).updatedAt, 'Платежи')
  await started
  const resolved = {
    ...upstream,
    stateEnum: 'Resolved',
    completionDate: new Date().toISOString(),
    solution: 'Подтверждено источником',
  }
  await publish(resolved)
  release()
  const response = await pending
  assert.equal(response.status, 200)
  const receipt = await response.json()
  let confirmed = await current()
  assert.deepEqual(receipt, {
    id,
    team: confirmed.team,
    assignee: confirmed.assignee ?? null,
    state: confirmed.state,
  })
  assert.equal(confirmed.state, 'Завершён')
  assert.equal(confirmed.solution, resolved.solution)
  assert.equal(confirmed.team, 'Платежи')
  const again = holdResponse(),
    second = patch(confirmed.updatedAt, 'Сети')
  await again
  const replacement = {...resolved, sysId: 'replacement', assignedGroupName: 'Новая запись'}
  await publish(replacement)
  release()
  assert.equal((await second).status, 409)
  confirmed = await current()
  assert.equal(confirmed.sysId, 'replacement')
  assert.equal(confirmed.team, replacement.assignedGroupName)
})
