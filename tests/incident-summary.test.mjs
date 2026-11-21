import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {incidentDeadline} from '../src/desk/deadline.ts'
import {applySnapshot, createDesk} from '../mock/engine.ts'

test('the card states elapsed, remaining and recovered time against the Moscow deadline', () => {
  const dueAt = Date.parse('2026-11-21T13:18:00+03:00')
  const incident = {state: 'Назначен', dueAt}
  assert.equal(incidentDeadline(incident, dueAt + 401 * 60000).label, 'Просрочено на 6 ч 41 мин')
  assert.equal(incidentDeadline(incident, dueAt - 90 * 60000).label, 'До срока 1 ч 30 мин')
  assert.equal(incidentDeadline({...incident, dueAt: null}, dueAt).label, 'Срок не указан')
  assert.equal(
    incidentDeadline({...incident, state: 'Завершён', restoredAt: '13:10'}, dueAt + 60000).label,
    'Восстановлено в 13:10 МСК',
  )
})

test('an incident keeps its own meeting link through an omitted field and clears it on explicit removal', () => {
  const [row] = JSON.parse(readFileSync(new URL('../mock/fixtures/incidents.json', import.meta.url)))
  const desk = createDesk('case', Date.now())
  const url = 'https://meet.example.test/room/42'
  function importRow(patch, step) {
    applySnapshot(desk, [{...row, ...patch}], 1_800_000_000_000 + step)
    return desk.records[row.id].meetingUrl
  }
  assert.equal(importRow({meetingUrl: url}, 1), url)
  assert.equal(importRow({}, 2), url)
  assert.equal(importRow({meetingUrl: null}, 3), null)
  assert.equal(importRow({meetingUrl: url}, 4), url)
  assert.equal(importRow({meetingUrl: 'javascript:alert(1)'}, 5), null)
})

test('the live deadline starts from the server reading and continues counting down', () => {
  const observedAt = Date.parse('2026-11-21T10:00:00Z')
  const incident = {
    state: 'Назначен', dueAt: observedAt - 1000,
    deadlineStatus: {remainingSeconds: 60, overdue: false, observedAt},
  }
  assert.equal(incidentDeadline(incident, observedAt).label, 'До срока 1 мин')
  assert.equal(incidentDeadline(incident, observedAt + 60_000).label, 'Срок наступил')
  assert.equal(incidentDeadline(incident, observedAt + 60_001).overdue, true)
  assert.equal(incidentDeadline({...incident, dueAt: null}, observedAt).label, 'Срок не указан')
})
