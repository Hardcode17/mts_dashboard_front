import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {test} from 'node:test'
import {createIncidentsApi} from '../src/features/incidents/api/client.ts'
import {toApiDesk, toIncident} from '../src/features/incidents/model/toDesk.ts'
import {groupIncidents} from '../src/desk/incidentGroups.ts'
import {ApiError} from '../src/shared/api/http.ts'
import {
  cardNotFound, cardWithoutDeadline, listBeforeFirstSuccess, listDefault, patchCard,
  snapshotStatusPublished, snapshotStatusStale,
} from './fixtures/dashboard-contract.mjs'

const incidentsPath = '/api/dashboard/incidents'
const eventsPath = '/api/dashboard/shift/events'

async function contractServer(t, route) {
  const requests = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()
    const url = new URL(request.url, 'http://test')
    const call = {method: request.method, pathname: url.pathname, query: url.searchParams,
      headers: request.headers, body: body ? JSON.parse(body) : undefined}
    requests.push(call)
    const {json, status = 200, headers} = route(call) ?? {status: 404, json: cardNotFound}
    response.writeHead(status, {'Content-Type': 'application/json', ...headers})
    response.end(json === undefined ? undefined : JSON.stringify(json))
  })
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  return {requests, api: createIncidentsApi({
    baseUrl: `http://127.0.0.1:${server.address().port}`, getAccessToken: () => 'test-bearer',
  })}
}

test('canonical list DTO: server counts and overlapping memberships survive pagination and ETag', async t => {
  const {api, requests} = await contractServer(t, ({pathname, query, headers}) => {
    if (pathname !== incidentsPath) return
    if (headers['if-none-match'] === '"43"') return {status: 304}
    if (query.has('cursor')) return {json: {...listDefault, groups: [], items: listDefault.items.slice(1)}}
    // A first page with one row legitimately has counters greater than its embedded rows.
    const items = listDefault.items.slice(0, 1)
    return {
      headers: {ETag: '"43"'},
      json: {...listDefault, items, nextCursor: 'next/+',
        groups: listDefault.groups.map(group => ({...group, incidents: group.incidents.filter(item => items.includes(item))}))},
    }
  })
  const list = await api.getIncidents()
  assert.deepEqual(list.items.map(item => item.id), listDefault.items.map(item => item.id))
  assert.equal(list.revision, 42)
  assert.equal(list.eventSeq, 43)
  assert.deepEqual(list.counts, {critical: 2, coordinators: 3, high: 1, research: 1})

  const desk = toApiDesk(list, snapshotStatusPublished, 0)
  assert.deepEqual(desk.apiCounts, list.counts)
  const groups = groupIncidents(Object.values(desk.records))
  const ids = rows => rows.map(row => row.id)
  assert.deepEqual(ids(groups.critical), ['INC000021095531', 'INC000021095532'])
  assert.deepEqual(ids(groups.assigned), ['INC000021095531', 'INC000021095532', 'INC000021095539'])
  assert.deepEqual(ids(groups.high), ['INC000021095538'])
  assert.deepEqual(ids(groups.research), ['INC000021095539'])

  // Membership comes from the API, not a fallback to local priority/group rules.
  const p4WithoutMembership = toIncident({...list.items[0], groups: []})
  assert.deepEqual(groupIncidents([p4WithoutMembership]), groupIncidents([]))
  assert.equal(await api.getIncidents(), list)
  assert.deepEqual(requests.map(({method, pathname, query, headers}) => [
    `${method} ${pathname}`, query.get('includeCompleted'), query.get('limit'),
    query.get('cursor'), headers['if-none-match'], headers.authorization,
  ]), [
    ['GET ' + incidentsPath, 'true', '100', null, undefined, 'Bearer test-bearer'],
    ['GET ' + incidentsPath, 'true', '100', 'next/+', undefined, 'Bearer test-bearer'],
    ['GET ' + incidentsPath, 'true', '100', null, '"43"', 'Bearer test-bearer'],
  ])
})

test('canonical query uses repeated server group keys and encodes the page cursor', async t => {
  const {api, requests} = await contractServer(t, () => ({json: listDefault}))
  assert.deepEqual(await api.getPage({
    group: ['coordinator', 'research'], includeCompleted: false, limit: 2, cursor: '/+=',
  }), listDefault)
  assert.deepEqual([...requests[0].query], [
    ['group', 'coordinator'], ['group', 'research'], ['includeCompleted', 'false'],
    ['limit', '2'], ['cursor', '/+='],
  ])
})

test('card GET preserves its real service, nullable deadline and ITSM URL; dates use Moscow time', async t => {
  const path = incidentsPath + '/' + cardWithoutDeadline.id
  const {api, requests} = await contractServer(t, ({pathname}) => {
    if (pathname === path) return {json: cardWithoutDeadline}
  })
  const detail = await api.getIncident(cardWithoutDeadline.id)
  assert.equal(requests[0].pathname, path)
  const {incident} = detail
  assert.equal(incident.id, 'INC000021095532')
  assert.equal(incident.header, 'Часть заказов не оплачивается через СБП')
  assert.equal(incident.description, cardWithoutDeadline.description)
  assert.equal(incident.service, 'checkout-api')
  assert.equal(incident.serviceType, 'Клиентский')
  assert.equal(incident.deadline, null)
  assert.equal(incident.assignedEmployee, null)
  assert.equal(incident.remainingSeconds, null)
  assert.equal(incident.overdue, false)
  assert.deepEqual(incident.groups, ['coordinators', 'critical'])
  assert.equal(detail.itsmUrl, cardWithoutDeadline.itsmUrl)
  assert.equal(detail.itsmDemo, true)
  const item = toIncident(incident)
  assert.equal(item.registered, '12:01')
  assert.equal(item.due, null)
  assert.equal(item.dueAt, null)
  assert.equal(item.remainingSeconds, null)
  assert.equal(item.overdue, false)
})

test('unpublished and stale published snapshots have different desk states', async t => {
  const {api} = await contractServer(t, ({pathname}) => {
    if (pathname === incidentsPath) return {json: listBeforeFirstSuccess}
    if (pathname === '/api/snapshot/status') return {json: snapshotStatusStale}
  })
  const [before, status] = await Promise.all([api.getIncidents(), api.getSnapshotStatus()])
  assert.deepEqual(status, snapshotStatusStale)
  const empty = toApiDesk(before, status, 0)
  assert.equal(empty.apiBeforeFirstSuccess, true)
  assert.equal(empty.lastImport, 0)
  assert.equal(empty.sourceError, '')
  const stale = toApiDesk({...before, beforeFirstSuccess: false, revision: 42}, {...snapshotStatusPublished, stale: true}, 0)
  assert.equal(stale.apiBeforeFirstSuccess, false)
  assert.equal(stale.lastImport, Date.parse(snapshotStatusPublished.lastSuccessAt))
  assert.match(stale.sourceError, /последний успешно опубликованный снимок/)
})

test('getUsers maps the ITSM displayName and optional group, with name only as a legacy fallback', async t => {
  const path = '/api/dashboard/users'
  const {api, requests} = await contractServer(t, ({method, pathname}) => {
    if (method === 'GET' && pathname === path) return {json: [
      {sysId: 'demo2', login: 'demo2', displayName: 'Дежурный 3 (demo2)', groupName: 'Support', name: 'Не использовать'},
      {sysId: 'no-group', login: 'no-group', displayName: 'Дежурный без группы'},
      {sysId: 'legacy', login: 'legacy', name: 'Дежурный dev-стенда', groupName: null},
    ]}
  })
  assert.deepEqual(await api.getUsers(), [
    {sysId: 'demo2', login: 'demo2', name: 'Дежурный 3 (demo2)', groupName: 'Support'},
    {sysId: 'no-group', login: 'no-group', name: 'Дежурный без группы', groupName: ''},
    {sysId: 'legacy', login: 'legacy', name: 'Дежурный dev-стенда', groupName: ''},
  ])
  assert.equal(requests[0].headers.authorization, 'Bearer test-bearer')
})

test('PATCH sends only official fields and uses the confirmed card and server SLA', async t => {
  const body = {assignedEmployeeLogin: 'demo2', assignedGroupName: 'Support', stateEnum: 'WorkInProgress'}
  const path = incidentsPath + '/' + patchCard.id
  const {api, requests} = await contractServer(t, ({method, pathname}) => {
    if (method === 'PATCH' && pathname === path) return {json: patchCard}
  })
  const {detail, eventSeq} = await api.patchIncident(patchCard.id, body)
  assert.deepEqual(requests[0].body, body)
  assert.equal(requests[0].headers.authorization, 'Bearer test-bearer')
  assert.equal(requests[0].headers['content-type'], 'application/json')
  assert.equal(detail.revision, 1)
  assert.equal(eventSeq, 2)
  const record = toIncident(detail.incident)
  assert.equal(record.team, 'Support')
  assert.equal(record.assignedEmployeeLogin, 'demo2')
  assert.equal(record.assignee, 'Дежурный 3 (demo2)')
  assert.equal(record.remainingSeconds, 86400)
  assert.equal(record.overdue, false)
})

test('real shift queue DTO filters non-alarm events and sends the exact IDs for «Увидел»', async t => {
  // docs/shift-events.md and ShiftEventController (not the general OpenAPI poll examples).
  const time = '2026-11-21T09:05:01.000000Z'
  const event = {incidentId: cardWithoutDeadline.id, changeRevision: 42, sourceId: 'itcs-prod',
    occurredAt: time, incident: cardWithoutDeadline}
  const alarm = {...event, eventId: 'evt-0002', eventSeq: 2, ackRequired: true, reasons: ['became_critical']}
  const informational = {...event, eventId: 'evt-0003', eventSeq: 3, ackRequired: false,
    reasons: ['assigned_to_coordinators']}
  const reply = {status: 'acknowledged', confirmedEventIds: [alarm.eventId], events: [informational], nextEventSeq: 3}
  const {api, requests} = await contractServer(t, ({method, pathname}) => {
    if (pathname === eventsPath && method === 'GET') {
      return {json: {events: [alarm, informational], nextEventSeq: 3}}
    }
    if (pathname === eventsPath + '/ack' && method === 'POST') return {json: reply}
  })
  const pending = await api.getPendingShiftEvents()
  assert.deepEqual(pending, [alarm])
  assert.deepEqual(await api.acknowledgeShiftEvents(pending.map(item => item.eventId)), reply)
  assert.deepEqual([...requests[0].query], [['sinceEventSeq', '0'], ['limit', '500']])
  assert.deepEqual(requests[1].body, {eventIds: ['evt-0002']})
  assert.equal(requests[1].headers.authorization, 'Bearer test-bearer')
})

test('the client exposes canonical not-found HTTP metadata', async t => {
  const {api} = await contractServer(t, () => ({status: 404, json: cardNotFound}))
  await assert.rejects(api.getIncident('INC000021095599'), error => {
    assert(error instanceof ApiError)
    assert.equal(error.status, 404)
    assert.equal(error.code, 'INCIDENT_NOT_FOUND')
    assert.equal(error.message, cardNotFound.message)
    return true
  })
})
