import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createDesk, applySnapshot, tickDesk} from '../mock/engine.ts'
import {queueActivity} from '../src/desk/queueActivity.ts'
import {belongsToQueue, coordinatorGroup} from '../src/desk/types.ts'

test('movement uses membership transitions, including absence and re-entry; baseline and repeats stay quiet', () => {
  const start = Date.now()
  const desk = createDesk('case', start)
  const [fixture] = JSON.parse(readFileSync(new URL('../mock/fixtures/incidents.json', import.meta.url)))
  const row = {
    ...fixture,
    priorityId: 3,
    stateEnum: 'Assigned',
    assignedGroupName: 'A',
    deadline: null,
    completionDate: null,
  }
  applySnapshot(desk, [row], start)
  assert.equal(queueActivity(desk.movements, start).high.entered, 0)
  const critical = {...row, priorityId: 4, assignedGroupName: coordinatorGroup}
  applySnapshot(desk, [critical], start + 10)
  applySnapshot(desk, [critical], start + 11)
  let summary = queueActivity(desk.movements, start + 11)
  assert.equal(summary.high.exited, 1)
  assert.equal(summary.critical.entered, 1)
  assert.equal(summary.assigned.entered, 1)
  applySnapshot(desk, [], start + 20)
  assert(!belongsToQueue(desk.records[row.id], 'critical'))
  assert.equal(queueActivity(desk.movements, start + 20).critical.movements[0].reason, 'Отсутствует в снимке')
  applySnapshot(desk, [critical], start + 30)
  assert.equal(queueActivity(desk.movements, start + 30).critical.entered, 2)
  summary = queueActivity(desk.movements, start + 60010)
  assert.equal(summary.critical.entered, 1)
  assert.equal(summary.high.exited, 0)
  tickDesk(desk, start + 60030)
  assert.equal(desk.movements.length, 0)
})
