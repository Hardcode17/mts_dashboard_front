import assert from 'node:assert/strict'
import test from 'node:test'
import {createIncidentsApi} from '../src/features/incidents/api/client.ts'
import {queueFilterKey, queueFilterQuery} from '../src/features/incidents/model/queueFilters.ts'

test('the coordinator queue sends all KAN-26 filters on every cursor page', async t => {
  const filters = new URLSearchParams({
    q: '  Сбой оплаты ', priority: '3', product: 'Платёжный шлюз', team: 'Команда A',
    state: 'Выполняется', serviceType: 'Клиентский', deadline: 'none', sort: 'registered',
    page: '2', size: '25',
  })
  const key = queueFilterKey(filters)
  filters.set('page', '3')
  assert.equal(queueFilterKey(filters), key)
  assert.equal(queueFilterKey(new URLSearchParams('page=2')), '')
  const requests = []
  t.mock.method(globalThis, 'fetch', async path => {
    const url = new URL(path, 'http://localhost')
    assert.equal(url.pathname, '/api/dashboard/incidents')
    requests.push(Object.fromEntries(url.searchParams))
    const cursor = url.searchParams.has('cursor')
    return Response.json({
      eventSeq: 12, revision: 3, groups: [], beforeFirstSuccess: false,
      items: [{id: cursor ? 'INC000002' : 'INC000001', stateEnum: 'WorkInProgress', groupMemberships: []}],
      nextCursor: cursor ? null : 'cursor+1',
    })
  })

  const result = await createIncidentsApi().getIncidents(queueFilterQuery(key, 'assigned'))
  assert.deepEqual(result.items.map(item => item.id), ['INC000001', 'INC000002'])
  const expected = {
    group: 'coordinator', q: 'Сбой оплаты', priority: '3', product: 'Платёжный шлюз',
    team: 'Команда A', state: 'WorkInProgress', serviceType: 'Клиентский',
    deadline: 'none', sort: 'registered', includeCompleted: 'true', limit: '100',
  }
  assert.deepEqual(requests, [expected, {...expected, cursor: 'cursor+1'}])
})

test('all incidents use the dashboard default order without restricting the queue', () => {
  assert.deepEqual(queueFilterQuery('q=INC0000260001', 'all'), {
    group: undefined, q: 'INC0000260001', priority: undefined, product: undefined,
    team: undefined, state: undefined, serviceType: undefined, deadline: undefined, sort: 'deadline',
  })
})
