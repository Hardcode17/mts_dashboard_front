import {identityFixture} from './support/identity.mjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, writeFile, rm} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {mockService} from '../mock/server.ts'

test('a real file edit is polled; SQLite survives service restart; partial writes and stale commands are rejected', async (t) => {
  const identity = await identityFixture(t)
  const dir = await mkdtemp(join(tmpdir(), 'mcc-api-test-')),
    file = join(dir, 'source.json')
  const source = JSON.parse(readFileSync(new URL('../mock/fixtures/incidents.json', import.meta.url)))
  const key = source[0].id,
    original = JSON.stringify(source)
  await writeFile(file, original)
  let api, server, root
  async function start() {
    api = mockService(dir, file, undefined, identity.settings)
    server = createServer((q, r) => api.handle(q, r, () => r.end()))
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    root = 'http://127.0.0.1:' + server.address().port + '/api/stand/'
  }
  async function close() {
    await new Promise((done) => server.close(done))
    api.close()
  }
  const read = async () => (await (await identity.request(root + 'snapshot?mode=case')).json()).desk
  const action = (c) =>
    identity.request(root + 'action?mode=case', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(c),
    })
  async function until(predicate) {
    const end = Date.now() + 4500
    while (Date.now() < end) {
      const d = await read()
      if (predicate(d)) return d
      await delay(80)
    }
    throw Error('Snapshot did not update within 4.5 seconds')
  }
  try {
    await start()
    let desk = await read()
    assert.equal(Object.keys(desk.records).length, 44)
    assert.equal(desk.signals.length, 0)
    source[0].priorityId = 4
    await writeFile(file, JSON.stringify(source))
    desk = await until((d) => d.signals.length === 1 && d.records[key].priority === 4)
    const signal = desk.signals[0].id
    const before = desk.records[key].updatedAt
    assert.equal((await action({type: 'ack', ids: [signal]})).status, 200)
    const commands = await Promise.all(
      ['А', 'Б'].map((team) => action({type: 'edit', key, expected: before, data: {team}})),
    )
    assert.deepEqual(commands.map((r) => r.status).sort(), [200, 409])
    const revisionCount = (await read()).revisions[key].length
    const officialTeam = (await read()).records[key].team
    await close()
    await start()
    assert.equal((await read()).records[key].team, officialTeam)
    await writeFile(file, '[')
    desk = await until((d) => Boolean(d.sourceError))
    assert.equal(desk.records[key].priority, 4)
    assert.equal(desk.revisions[key].length, revisionCount)
    assert.equal(desk.signals.length, 1)
    await close()
    await start()
    desk = await read()
    assert(desk.signals[0].acknowledged)
    assert.equal(desk.revisions[key].length, revisionCount)
    await writeFile(file, original)
    desk = await until((d) => !d.sourceError && d.records[key].priority === 1)
    assert(!desk.sourceError)
    assert.equal(desk.records[key].priority, 1)
  } finally {
    if (server?.listening) await close()
    await rm(dir, {recursive: true, force: true})
  }
})
