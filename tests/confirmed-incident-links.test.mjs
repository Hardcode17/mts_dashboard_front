import assert from 'node:assert/strict'
import test from 'node:test'
import {createIncidentsApi} from '../src/features/incidents/api/client.ts'
import {confirmedLinkForCard, upsertConfirmedLink} from '../src/features/incidents/model/confirmedLinks.ts'

const first = 'INC0000260001'
const second = 'INC0000260002'
const link = {
  id: 17, sourceIncidentId: first, targetIncidentId: second, kind: 'related_to',
  confirmedByUserId: 7, createdAt: '2026-11-21T10:00:00Z',
}

test('confirm sends the selected pair with coordinator auth and both cards expose the same link', async t => {
  const seen = []
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    assert.equal(init.headers.get('Authorization'), 'Bearer coordinator-fixture')
    seen.push(path)
    if (init.method === 'POST') {
      assert.equal(init.headers.get('Content-Type'), 'application/json')
      assert.deepEqual(JSON.parse(init.body), {targetIncidentId: first, kind: 'related_to'})
      return Response.json(link)
    }
    return Response.json({id: path.split('/').at(-1), groupMemberships: [], confirmedLinks: [link]})
  })
  const api = createIncidentsApi({getAccessToken: () => 'coordinator-fixture'})
  assert.deepEqual(await api.confirmIncidentLink(second, first, 'related_to'), link)
  const [left, right] = await Promise.all([api.getIncident(first), api.getIncident(second)])
  assert.deepEqual(left.confirmedLinks, [link])
  assert.deepEqual(right.confirmedLinks, [link])
  assert.deepEqual(seen, [
    '/api/dashboard/incidents/' + second + '/confirmed-links',
    '/api/dashboard/incidents/' + first,
    '/api/dashboard/incidents/' + second,
  ])
})

test('card links keep direction and a repeated confirmation does not add a row', () => {
  const causes = {...link, kind: 'causes'}
  assert.deepEqual(confirmedLinkForCard(causes, first), {other: second, direction: 'outgoing'})
  assert.deepEqual(confirmedLinkForCard(causes, second), {other: first, direction: 'incoming'})
  assert.equal(confirmedLinkForCard(causes, 'INC0000260003'), undefined)
  assert.deepEqual(upsertConfirmedLink([link], link), [link])
  assert.deepEqual(upsertConfirmedLink([link], {...causes, id: 18}), [link, {...causes, id: 18}])
})
