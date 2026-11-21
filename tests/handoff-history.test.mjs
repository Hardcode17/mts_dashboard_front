import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {applySnapshot, createDesk, execute} from '../mock/engine.ts'
import {coordinatorGroup} from '../src/desk/types.ts'

test('the completed assignment keeps who accepted, when, and which team received the handoff', () => {
  const now = Date.now()
  const desk = createDesk('case', now)
  const [source] = JSON.parse(readFileSync(new URL('../mock/fixtures/incidents.json', import.meta.url)))
  const incident = {...source, priorityId:4, stateEnum:'WorkInProgress', assignedGroupName:coordinatorGroup}
  applySnapshot(desk, [], now)
  execute(desk, {type:'upload', data:[incident]}, now + 1)
  const [task] = desk.tasks
  const [attempt] = task.attempts
  const assignee = {key:task.key, person:attempt.person, id:attempt.id}
  execute(desk,{...assignee, type:'accept'},now+2)
  execute(desk,{...assignee, type:'handoff', value:'Сеть L2'},now+3)
  assert.equal(attempt.accepted, now+2)
  assert.equal(attempt.ended, now+3)
  assert.equal(task.finished, now+3)
  assert.equal(attempt.reason,'Передано: Сеть L2')
  assert.equal(desk.records[task.key].team,'Сеть L2')
})
