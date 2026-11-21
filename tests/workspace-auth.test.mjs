import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {mockService} from '../mock/server.ts'
import {identityFixture} from './support/identity.mjs'

test('all workspace API reads and writes require a verified human session before dispatch', async (t) => {
  const identity = await identityFixture(t)
  const dir = await mkdtemp(join(tmpdir(), 'mcc-auth-'))
  const file = join(dir, 'incidents.json')
  await writeFile(file, '[]')
  const auth = {...identity.settings}
  const service = mockService(dir, file, {}, auth)
  const server = createServer((req, res) => service.handle(req, res, () => res.writeHead(404).end()))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    service.close()
    await rm(dir, {recursive: true, force: true})
  })
  const root = 'http://127.0.0.1:' + server.address().port
  const config = await (await fetch(root + '/auth/config')).json()
  assert.deepEqual(Object.keys(config).sort(), ['clientId', 'realm', 'url'])
  const snapshot = root + '/api/stand/snapshot?mode=case'
  const initial = await (await identity.request(snapshot)).json()
  for (const [method, path] of [
    ['GET', 'snapshot'],
    ['GET', 'itsm'],
    ['PATCH', 'itsm'],
    ['POST', 'action'],
    ['POST', 'shop'],
  ]) {
    const res = await fetch(root + '/api/stand/' + path + '?mode=case', {
      method,
      ...(method === 'GET'
        ? {}
        : {headers: {'content-type': 'application/json'}, body: JSON.stringify({type: 'demo'})}),
    })
    assert.equal(res.status, 401, method + ' ' + path)
    assert.match(res.headers.get('www-authenticate'), /^Bearer/)
    assert.deepEqual(Object.keys(await res.json()), ['error'])
  }
  assert.equal((await fetch(snapshot, {headers: {Authorization: 'Bearer invalid-test-token'}})).status, 401)
  assert.equal((await (await identity.request(snapshot)).json()).desk.demoCount, initial.desk.demoCount)
  auth.profileUrl = identity.settings.url + '/unavailable'
  assert.equal((await identity.request(snapshot)).status, 503)
})
