import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp, rm} from 'node:fs/promises'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {mockService} from '../mock/server.ts'
import {createIncidentsApi} from '../src/features/incidents/api/client.ts'
import {toApiDesk} from '../src/features/incidents/model/toDesk.ts'
import {ApiError} from '../src/shared/api/http.ts'

test('the MCC client reads list, detail, and snapshot status from the mock contract', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcc-contract-api-'))
  const mock = mockService(directory)
  const server = createServer((request, response) =>
    mock.handle(request, response, () => {
      response.writeHead(404)
      response.end()
    }),
  )

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const api = createIncidentsApi({baseUrl: origin})

  try {
    const [page, status] = await Promise.all([
      api.getIncidents(),
      api.getSnapshotStatus(),
    ])

    assert.equal(page.items.length, 44)
    assert.deepEqual(page.counts, {
      critical: 0,
      coordinators: 2,
      high: 1,
      research: 5,
    })
    assert.equal(status.stale, false)
    assert.equal(status.revision, page.revision)
    const desk = toApiDesk(page, status, Date.now())
    assert.equal(Object.keys(desk.records).length, page.items.length)
    assert.deepEqual(desk.apiCounts, page.counts)

    const criticalPage = await api.getIncidents({group: 'critical'})
    assert.deepEqual(criticalPage.counts, page.counts)
    assert(criticalPage.items.every((incident) => incident.groups.includes('critical')))

    const detail = await api.getIncident(page.items[0].id)
    assert.equal(detail.incident.id, page.items[0].id)
    assert.equal(typeof detail.itsmUrl, 'string')
    assert.equal(detail.itsmDemo, true)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    mock.close()
    await rm(directory, {recursive: true, force: true})
  }
})

test('the MCC client exposes stable HTTP error metadata', async () => {
  const api = createIncidentsApi({
    baseUrl: 'http://127.0.0.1:1',
  })

  await assert.rejects(api.getIncident('INC000001'), (error) => {
    assert(error instanceof Error)
    assert.equal(error.name, 'TypeError')
    return true
  })

  const server = createServer((request, response) => {
    response.writeHead(404, {'Content-Type': 'application/json'})
    response.end(
      JSON.stringify({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Incident not found',
      }),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const apiWithError = createIncidentsApi({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  })

  try {
    await assert.rejects(apiWithError.getIncident('INC000001'), (error) => {
      assert(error instanceof ApiError)
      assert.equal(error.status, 404)
      assert.equal(error.code, 'RESOURCE_NOT_FOUND')
      return true
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
