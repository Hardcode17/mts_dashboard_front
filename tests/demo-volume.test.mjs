import assert from 'node:assert/strict'
import {test} from 'node:test'
import {initialIncidents, initialEvents, additionalIncidents} from '../mock/fixtures/shift.ts'
import {createDesk, workspaceView} from '../mock/engine.ts'
import {standNow} from '../src/desk/types.ts'

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

test('fixture cards, revisions, and events stay in the local volume response, not in stored records or live case', () => {
  const now = Date.parse('2026-12-22T09:30:00Z')
  const volume = createDesk('volume', now)
  const snapshot = workspaceView(volume)
  assert.equal(Object.keys(snapshot.records).length, 3600)
  assert.ok(snapshot.revisions.incident.length > 0)
  assert.equal(snapshot.events.length, 14400)
  assert.deepEqual(volume.records, {})
  assert.deepEqual(volume.revisions, {})
  assert.deepEqual(volume.events, [])

  const live = workspaceView(createDesk('case', now))
  assert.deepEqual(live.records, {})
  assert.deepEqual(live.revisions, {})
  assert.deepEqual(live.events, [])
  assert.equal(standNow(live, now + 60_000), now + 60_000)
})
