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

    const coordinatorPage = await api.getIncidents({group: ['coordinator']})
    assert.equal(coordinatorPage.counts.coordinators, 2)
    assert.equal(coordinatorPage.counts.research, 0)
    assert.equal(coordinatorPage.items.length, 2)
    assert(coordinatorPage.items.every((incident) => incident.groups.includes('coordinators')))

    const first = await api.getPage({limit: 1})
    assert.equal(first?.items.length, 1)
    assert(first?.nextCursor)
    assert.equal(first?.groups.find((group) => group.key === 'coordinator')?.incidentCount, 2)
    const second = await api.getPage({limit: 1, cursor: first.nextCursor})
    assert.notEqual(second?.items[0].id, first.items[0].id)
    assert.deepEqual(second?.groups, [])

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

test('the canonical client follows cursors and revalidates the first page with its ETag', async (t) => {
  const calls = []
  const server = createServer((request, response) => {
    const {pathname, searchParams} = new URL(request.url, 'http://test')
    calls.push([pathname, searchParams.get('cursor'), request.headers['if-none-match']])
    if (request.headers['if-none-match'] === '"43"') {
      response.writeHead(304)
      response.end()
      return
    }
    const cursor = searchParams.get('cursor')
    response.writeHead(200, {'Content-Type': 'application/json', ETag: '"43"'})
    response.end(JSON.stringify({
      revision: 42,
      eventSeq: 43,
      beforeFirstSuccess: false,
      groups: [],
      items: [{
        id: cursor ? 'INC002' : 'INC001',
        productName: 'МТС',
        assignedGroupName: null,
        stateEnum: 'Assigned',
        priorityId: 4,
        submitDate: '2026-11-21T09:00:00Z',
        deadline: null,
        groupMemberships: [{group: 'critical', matchedRule: 'priorityId = 4'}],
      }],
      nextCursor: cursor ? null : 'next/+',
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const api = createIncidentsApi({baseUrl: `http://127.0.0.1:${server.address().port}`})
  const list = await api.getIncidents()
  assert.deepEqual(list.items.map((item) => item.id), ['INC001', 'INC002'])
  assert.equal(await api.getIncidents(), list)
  assert.deepEqual(calls, [
    ['/api/dashboard/incidents', null, undefined],
    ['/api/dashboard/incidents', 'next/+', undefined],
    ['/api/dashboard/incidents', null, '"43"'],
  ])
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
