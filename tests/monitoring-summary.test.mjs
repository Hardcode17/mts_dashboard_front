import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseMonitoringSummary} from '../src/monitoring/summary.ts'

test('monitoring summary keeps overlapping categories independent and orders the timeline', () => {
  const summary = parseMonitoringSummary({
    updatedAt: '2026-11-21T09:42:00Z',
    activeCount: 9,
    counts: {critical: 4, high: 3, coordinators: 4, research: 2},
    timeline: [
      {at: '2026-11-21T09:45:00Z', critical: 4, high: 3, coordinators: 4, research: 2},
      {at: '2026-11-21T09:40:00+00:00', critical: 3, high: 2, coordinators: 3, research: 1},
    ],
    priorities: [{priorityId: 4, count: 4}, {priorityId: 3, count: 3}],
    coordinatorLoad: [{name: 'Анна Котова', count: 3}],
  })

  assert.equal(summary.activeCount, 9)
  assert.deepEqual(summary.counts, {critical: 4, high: 3, coordinators: 4, research: 2})
  assert.deepEqual(summary.timeline.map((point) => point.at), [
    '2026-11-21T09:40:00+00:00',
    '2026-11-21T09:45:00Z',
  ])
  assert.equal(summary.timeline[0].critical, 3)
  assert.equal(summary.priorities[1].priorityId, 3)
  assert.equal(summary.coordinatorLoad[0].name, 'Анна Котова')
})

test('monitoring summary treats absent history as empty and drops malformed observations', () => {
  const summary = parseMonitoringSummary({
    updatedAt: 'not-a-date',
    activeCount: 0,
    counts: {critical: 0, high: 0, coordinators: 0, research: 0},
    timeline: [
      {at: 'not-a-date', critical: 8},
      {critical: 8},
      {at: '2026-11-21T09:45:00Z', critical: -2, research: 'n/a'},
    ],
    priorities: [{priorityId: '4', count: 2}, {priorityId: 4, count: 1}],
    coordinatorLoad: [{name: '  ', count: 3}, {name: 'Олег', count: 2}],
  })

  assert.equal(summary.updatedAt, null)
  assert.deepEqual(summary.timeline, [])
  assert.deepEqual(summary.priorities, [{priorityId: 4, count: 1}])
  assert.deepEqual(summary.coordinatorLoad, [{name: 'Олег', count: 2}])
})

test('monitoring summary rejects a response without complete counters', () => {
  assert.throws(() => parseMonitoringSummary({}), /нет счётчиков/)
  assert.throws(() => parseMonitoringSummary({activeCount: 0, counts: {critical: 0}}), /нет счётчиков/)
  assert.throws(() => parseMonitoringSummary(null), /пустой ответ/)
})

test('monitoring summary accepts zero categories without inventing history', () => {
  const summary = parseMonitoringSummary({
    activeCount: 0,
    counts: {critical: 0, high: 0, coordinators: 0, research: 0},
  })
  assert.deepEqual(summary.counts, {critical: 0, high: 0, coordinators: 0, research: 0})
  assert.deepEqual(summary.timeline, [])
  assert.deepEqual(summary.priorities, [])
  assert.deepEqual(summary.coordinatorLoad, [])
})
