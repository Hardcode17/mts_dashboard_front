import assert from 'node:assert/strict'
import {test} from 'node:test'
import {additionalIncidents, initialIncidents, incidentRevisions} from '../mock/fixtures/shift.ts'
import {cardChanges} from '../src/incidentHistory.ts'

test('partial revisions retain known fields and repeated snapshots produce no changes', () => {
  const changes = cardChanges([
    {observedAt: '10:00', values: {team: 'A', due: null}},
    {observedAt: '10:01', values: {team: 'A'}},
    {observedAt: '10:02', values: {assignee: 'Ирина', due: '12:00'}},
    {changedAt: '10:03', observedAt: '10:04', values: {team: 'B', assignee: null}},
    {observedAt: '10:05', values: {team: 'B', assignee: null}},
  ])
  assert.deepEqual(changes.map(item => item.observedAt), ['10:04', '10:02'])
  assert.deepEqual(changes[0].changes, [
    {field: 'team', before: 'A', after: 'B'}, {field: 'assignee', before: 'Ирина', after: null},
  ])
  assert.deepEqual(changes[1].changes, [
    {field: 'assignee', before: undefined, after: 'Ирина'}, {field: 'due', before: null, after: '12:00'},
  ])
  assert.equal(changes[1].changedAt, undefined)
})

test('the latest known value for each field agrees with its incident in the shift snapshot', () => {
  for (const item of initialIncidents) {
    const versions = incidentRevisions.get(item.key)
    assert.ok(versions, item.id)
    const latest = Object.assign({}, ...versions.map(version => version.values))
    for (const [field, value] of Object.entries(latest)) {
      assert.equal(value, field === 'priority' ? String(item.priority) : item[field], item.id + ' ' + field)
    }
  }
  for (const item of additionalIncidents) assert.deepEqual(cardChanges(incidentRevisions.get(item.key) ?? []), [])
})
