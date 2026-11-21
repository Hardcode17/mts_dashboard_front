import {test} from 'node:test'
import assert from 'node:assert/strict'
import {cardTimeline, historyValue} from '../src/desk/timeline.ts'
import {createDesk, execute, workspaceView} from '../mock/engine.ts'
import {initialIncidents} from '../mock/fixtures/shift.ts'
import {standNow} from '../src/desk/types.ts'

test('the incident journal puts the ITSM edit and its detection on the stand clock exactly once', () => {
  const started = Date.parse('2026-11-21T06:00:00Z')
  const desk = createDesk('volume', started)
  const item = initialIncidents.find((i) => i.key === 'incident')
  const when = started + 60000
  execute(desk, {type: 'edit', key: item.key, data: {team: 'Платёжная смена', solution: 'Проверено'}}, when)
  const changes = cardTimeline(desk, item).filter((e) => e.source === 'ITSM')
  for (const value of ['Платёжная смена', 'Проверено']) {
    assert.equal(changes.find((e) => e.text.includes(value))?.at, standNow(desk, when))
  }
  assert.match(historyValue('due', '2026-11-21T13:24:00.000Z'), /16:24:00 МСК/)
  assert.equal(historyValue('priority', '4'), 'Наивысший')
})

test('a shift journal link reaches the matching ITSM change once and still distinguishes observation time', () => {
  const started = Date.parse('2026-11-21T06:00:00Z')
  const desk = createDesk('volume', started)
  const item = initialIncidents.find((i) => i.key === 'incident')
  const rows = cardTimeline(workspaceView(desk), item)
  const routed = rows.filter((row) => row.journalIds?.includes('assign-market'))
  assert.equal(routed.length, 1)
  assert.equal(routed[0].category, 'ITSM')
  assert.equal(routed[0].changes.find((change) => change.field === 'team').after, 'Координаторы МИ')
  assert.equal(rows.filter((row) => row.at === routed[0].at).length, 1)
  const stateChange = rows.find((row) => row.changes?.some((change) => change.field === 'state'))
  assert.equal(stateChange.observedAt - stateChange.at, 60000)
  assert.equal(stateChange.timeBasis, 'source')
})

test('the incident timeline keeps a rule, an acknowledgement, decisions and room events separate', () => {
  const started = Date.parse('2026-11-21T06:00:00Z')
  const desk = createDesk('case', started)
  const item = {...initialIncidents[0], key: 'test', registeredAt: started}
  desk.events = [
    {id: 'deadline', kind: 'due', key: item.key, time: '09:00', at: started, change: 'До срока 30 мин'},
  ]
  desk.signals = [{id: 'first', key: item.key, at: started, acknowledged: started + 1000}]
  desk.work[item.key] = {
    notes: [],
    links: [],
    reports: [
      {
        id: 'decision',
        at: started + 2000,
        title: 'Решение о маршрутизации',
        content: 'Передать в команду платежей',
        revision: 2,
      },
    ],
    room: {
      id: 'ER-1',
      members: [],
      ended: false,
      fragments: [],
      timeline: [{at: started + 3000, who: 'Инженер', text: 'Подключился'}],
    },
  }
  const rows = cardTimeline(desk, item)
  assert.deepEqual(
    rows.map((row) => row.at),
    [...rows.map((row) => row.at)].sort((a, b) => b - a),
  )
  assert.equal(rows.find((row) => row.journalIds?.includes('deadline')).category, 'Смена')
  assert.equal(rows.find((row) => row.text.includes('просмотр')).category, 'Смена')
  assert.match(rows.find((row) => row.text.includes('маршрутизации')).text, /команду платежей/)
  assert.equal(rows.find((row) => row.text.includes('Подключился')).category, 'Комната')
})

test('a delayed ITSM timestamp cannot absorb an older shift observation for a different transition', () => {
  const seen = Date.parse('2026-11-21T06:00:00Z')
  const desk = createDesk('case', seen)
  const item = {...initialIncidents[0], key: 'delayed', registeredAt: seen - 60000}
  const before = new Date(seen).toISOString(),
    later = new Date(seen + 60000).toISOString()
  desk.revisions[item.key] = [
    {observedAt: before, values: {team: 'Команда A'}},
    {observedAt: later, changedAt: before, values: {team: 'Координаторы МИ'}},
  ]
  const event = {key: item.key, kind: 'assign', time: '09:00', change: 'Назначен на координаторов'}
  desk.events = [
    {...event, id: 'earlier', at: seen},
    {...event, id: 'actual', at: seen + 60000},
  ]
  const entries = cardTimeline(desk, item)
  assert.deepEqual(entries.find((e) => e.changes).journalIds, ['actual'])
  assert.equal(entries.find((e) => e.journalIds?.includes('earlier')).changes, undefined)
})

test('a saved agent run in the timeline opens that INC and that version', () => {
  const now = Date.parse('2026-11-21T09:00:00Z')
  const desk = createDesk('volume', now)
  const item = initialIncidents.find((i) => i.key === 'incident')
  execute(desk, {type: 'analyze', key: item.key}, now + 1000)
  const report = desk.work[item.key].reports[0]
  const entry = cardTimeline(desk, item).find((e) => e.id === 'report-' + report.id)
  assert.equal(entry.href, '#investigation/incident?run=' + report.id + '&dataset=volume')
  assert.equal(entry.at, standNow(desk, report.at))
})

test('legacy participant times fill missing room events without duplicating a recorded invitation', () => {
  const t = Date.parse('2026-11-21T06:00:00Z')
  const desk = createDesk('case', t)
  const item = {...initialIncidents[0], key: 'legacy-room', registeredAt: t}
  desk.work[item.key] = {
    notes: [],
    links: [],
    reports: [],
    room: {
      id: 'ER-legacy',
      ended: false,
      fragments: [],
      members: [{role: 'Инженер', team: 'Сеть', invited: '09:00', joined: '09:02', delivery: 'Прочитано'}],
      timeline: [{at: t, who: 'Инженер', text: 'Приглашение доставлено'}],
    },
  }
  const room = cardTimeline(desk, item).filter((e) => e.category === 'Комната')
  assert.equal(room.length, 2)
  assert.equal(room.find((e) => e.text.includes('Подключился')).timeBasis, 'clockOnly')
  assert.equal(room.filter((e) => e.text.includes('Приглашение')).length, 1)
})
