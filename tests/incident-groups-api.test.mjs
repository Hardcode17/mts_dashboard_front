import {identityFixture} from './support/identity.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {mockService} from '../mock/server.ts'

test('SQLite persists corrections and the single winner of concurrent group claims across a server restart', async (t) => {
  const identity = await identityFixture(t)
  const dir = await mkdtemp(join(tmpdir(), 'mcc-group-claims-')),
    source = join(dir, 'source.json')
  const [base] = JSON.parse(await readFile(new URL('../mock/fixtures/incidents.json', import.meta.url)))
  // Use the authoritative parent so this persistence check is independent of the inference worker.
  const rows = Array.from({length: 4}, (_, i) => ({
    ...base,
    id: 'INC' + i,
    priorityId: 4,
    stateEnum: 'WorkInProgress',
    assignedGroupName: 'Команда продукта',
    completionDate: null,
    deadline: null,
    parentId: i === 1 || i === 2 ? 'INC0' : null,
    productName: 'Сервис ' + i,
  }))
  await writeFile(source, JSON.stringify(rows))
  let service, server, root
  const start = async () => {
    service = mockService(dir, source, undefined, identity.settings)
    server = createServer((q, r) => service.handle(q, r, () => r.end()))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    root = 'http://127.0.0.1:' + server.address().port + '/api/stand'
  }
  const stop = async () => {
    await new Promise((done) => server.close(done))
    service.close()
  }
  t.after(async () => {
    await stop()
    await rm(dir, {recursive: true, force: true})
  })
  const read = async () => (await (await identity.request(root + '/snapshot?mode=case')).json()).desk
  const send = (g, type, person, ids) =>
    identity.request(root + '/action?mode=case', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({type, person, id: g.id, expected: g.revision, ids}),
    })
  await start()
  let parent = (await read()).outageGroups.find((g) => g.method === 'parent')
  const attempts = await Promise.all(['anna', 'oleg'].map((person) => send(parent, 'groupClaim', person)))
  assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 409])
  const winner = attempts[0].ok ? 'anna' : 'oleg'
  const id = parent.id
  parent = (await read()).outageGroups.find((g) => g.id === id)
  assert.equal(parent.owner, winner)
  assert.equal((await send(parent, 'groupExclude', winner, ['INC2'])).status, 200)
  parent = (await read()).outageGroups.find((g) => g.id === id)
  assert.equal((await send(parent, 'groupAdd', winner, ['INC3'])).status, 200)
  const saved = (await read()).outageGroups.find((g) => g.id === id)
  assert.deepEqual(saved.members, ['INC0', 'INC1', 'INC3'])
  await stop()
  await start()
  const restored = (await read()).outageGroups.find((g) => g.id === id)
  assert.deepEqual(restored, saved)
  assert.equal((await read()).records.INC0.team, 'Команда продукта')
})
