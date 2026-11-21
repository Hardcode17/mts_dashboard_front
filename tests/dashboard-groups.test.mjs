import {test} from 'node:test'
import assert from 'node:assert/strict'
import {groupIncidents, recentlyUpdated} from '../src/desk/incidentGroups.ts'
import {initialIncidents} from '../src/demoData.ts'

test('a critical P4 assigned to the coordinators appears in both groups', () => {
  const items = initialIncidents.filter(item => ['incident', 'delivery', 'premium'].includes(item.key))
  const groups = groupIncidents(items)
  assert.deepEqual(groups.critical.map(item => item.key), ['incident'])
  assert.deepEqual(groups.assigned.map(item => item.key), ['incident'])
  assert.deepEqual(groups.high.map(item => item.key), ['premium'])
  assert.deepEqual(groups.research.map(item => item.key), ['delivery'])
  assert.deepEqual(groupIncidents([]), {critical: [], assigned: [], high: [], research: []})
})

test('newest update comes first without changing incident membership', () => {
  const first = {...initialIncidents[0], updatedAt: 100}
  const last = {...initialIncidents[1], updatedAt: 500}
  assert.deepEqual([first, last].sort(recentlyUpdated), [last, first])
})
