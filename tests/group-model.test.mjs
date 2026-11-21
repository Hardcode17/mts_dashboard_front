import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import test from 'node:test'
import {groupModelWorker} from '../mock/groupModel.ts'

test('a malformed verdict for one group leaves both sources and the other groups available', async (t) => {
  const asked = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const request = JSON.parse(Buffer.concat(chunks).toString())
    const evidence = JSON.parse(request.messages[1].content)
    asked.push(evidence.upstream)
    const content = evidence.upstream === 'A' ? '{}' : JSON.stringify({agree: true, reason: 'Общий сервис'})
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({message: {content}}))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  t.mock.method(console, 'warn', () => {})
  t.mock.property(process, 'env', {
    ...process.env,
    MCC_GROUP_MODEL: 'test-model',
    MCC_OLLAMA_URL: 'http://127.0.0.1:' + server.address().port,
  })
  const candidate = (groupId) => ({
    groupId,
    fingerprint: 'f',
    dependency: groupId,
    errorCode: 'TIMEOUT',
    incidents: 2,
    services: ['one', 'two'],
    samples: [],
    firstAt: 0,
    lastAt: 1000,
  })
  const pending = {case: ['A', 'B'].map(candidate), volume: [candidate('C')]}
  const published = []
  const worker = groupModelWorker(
    (mode) => pending[mode],
    (mode, review, verdict) => {
      published.push([mode, review.groupId, verdict.model])
      pending[mode] = pending[mode].filter((p) => p.groupId !== review.groupId)
    },
  )
  t.after(() => worker.close())
  for (let i = 0; i < 4; i++) await worker.check()
  assert.deepEqual(asked, ['A', 'C', 'B'])
  assert.deepEqual(published, [
    ['volume', 'C', 'test-model'],
    ['case', 'B', 'test-model'],
  ])
})
