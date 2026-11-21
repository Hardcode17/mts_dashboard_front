import assert from 'node:assert/strict'
import {test} from 'node:test'
import {initialIncidents, initialEvents, additionalIncidents} from '../mock/demoData.ts'

test('the shift snapshot has unique cards and a linked event history in reverse time order', () => {
  assert.equal(initialIncidents.length, 3600)
  assert.equal(initialEvents.length, 14400)
  const keys = new Set(initialIncidents.map(incident => incident.key))
  assert.equal(keys.size, initialIncidents.length)
  assert.equal(new Set([...initialIncidents, ...additionalIncidents].map(item => item.id)).size,
    initialIncidents.length + additionalIncidents.length)
  assert.equal(new Set(initialEvents.map(event => event.id)).size, initialEvents.length)
  for (const [index, event] of initialEvents.entries()) {
    assert.ok(keys.has(event.key), event.id)
    if (index > 0) assert.ok(initialEvents[index - 1].time >= event.time, event.id)
  }
})
