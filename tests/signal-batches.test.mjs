import test from 'node:test'
import assert from 'node:assert/strict'
import {signalBatches} from '../src/desk/signalBatches.ts'
import {createDesk, execute} from '../mock/engine.ts'

const signal = (key, id = key) => ({id, key, at: 1000})
const group = (id, members) => ({id, members, title: 'Сбой ' + id})
const ids = (batches) => batches.flatMap((batch) => batch.signals.map((s) => s.id))

test('a five-situation limit retains all events of displayed outages and no event of a sixth situation', () => {
  const critical = Array.from({length: 100}, (_, n) => signal('INC-A' + n))
  const independent = Array.from({length: 5}, (_, n) => signal('INC-X' + n))
  const other = [signal('INC-B1'), signal('INC-B2')]
  const groups = [
    group(
      'A',
      critical.map((s) => s.key),
    ),
    group(
      'B',
      other.map((s) => s.key),
    ),
  ]
  // After A and X0..X3 have filled the screen, another 99 members of A arrive in the same server snapshot.
  const pending = [critical[0], ...independent, ...other, ...critical.slice(1)]
  const frozen = signalBatches(pending, groups)
  assert.equal(frozen.length, 5)
  assert.deepEqual(frozen[0].signals, critical)
  assert.deepEqual(ids(frozen).sort(), [...critical, ...independent.slice(0, 4)].map((s) => s.id).sort())
  const desk = createDesk('case', 1000)
  desk.signals = structuredClone(pending)
  execute(desk, {type: 'ack', ids: ids(frozen)}, 2000)
  const rest = desk.signals.filter((s) => !s.acknowledged)
  assert.deepEqual(
    rest.map((s) => s.id),
    [independent[4].id, ...other.map((s) => s.id)],
  )
  const batches = signalBatches(rest, groups)
  assert.equal(batches.length, 2)
  assert.deepEqual(batches[1].signals, other)
})

test('a delayed wave of the same outage and a reopened INC never extend the frozen acknowledgement', () => {
  const first = [signal('INC1', 'episode-1'), signal('INC2', 'episode-2')]
  const late = [signal('INC3', 'late'), signal('INC1', 'reopened')]
  const d = createDesk('case', 1000)
  d.signals = structuredClone(first)
  const frozen = signalBatches(d.signals, [
    group(
      'A',
      first.map((s) => s.key),
    ),
  ])
  d.signals.push(...late, signal('INC9', 'separate'))
  const groups = [group('A', ['INC1', 'INC2', 'INC3']), group('independent', ['INC9'])]
  assert.deepEqual(ids(frozen), ['episode-1', 'episode-2'])
  execute(d, {type: 'ack', ids: ids(frozen)}, 2000)
  assert.equal(d.quietUntil, 32000)
  const pending = d.signals.filter((s) => !s.acknowledged)
  const next = signalBatches(pending, groups)
  assert.deepEqual(
    next.map((b) => b.signals.map((s) => s.id)),
    [['late', 'reopened'], ['separate']],
  )
  assert.equal(next[0].group.id, 'A')
  assert.equal(next[1].group, undefined)
})
