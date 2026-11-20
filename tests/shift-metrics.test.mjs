import assert from 'node:assert/strict'
import {test} from 'node:test'
import {deadlineDistribution, incidentTrend} from '../src/shiftMetrics.ts'

test('trend counts each dated registration and recovery once within the selected window', () => {
  const rows = [
    {registered: '11:42', restoredAt: '11:43'},
    {registered: '11:43', restoredAt: '12:43'},
    {registered: '12:42'},
  ]
  const hour = incidentTrend(rows, '12:42', 'hour')
  assert.equal(hour.length, 6)
  assert.deepEqual(hour[0], {label: '11:43', registered: 1, restored: 1})
  assert.deepEqual(hour.at(-1), {label: '12:33', registered: 1, restored: 0})
  const shift = incidentTrend(rows, '12:42', 'shift')
  assert.equal(shift.reduce((a, b) => a + b.registered, 0), 3)
  assert.equal(shift.reduce((a, b) => a + b.restored, 0), 1)
})

test('deadline bands handle absent and expired deadlines and count boundaries exactly once', () => {
  const deadlines = [null, '12:41', '12:42', '13:12', '13:13', '13:42', '13:43', '15:42', '15:43']
  assert.deepEqual(deadlineDistribution(deadlines.map(due => ({due})), '12:42').map(bin => bin.value), [1, 2, 2, 2, 1, 1])
})
