import assert from 'node:assert/strict'
import test from 'node:test'
import {assignmentCycle} from '../src/desk/assignmentCycle.ts'
import {buildAttentionRows, cardCoordination} from '../src/control-room/attention.ts'

const base = {
  state: 'В работе',
  priority: 4,
  product: 'Маркет',
  due: null,
  research: false,
  registered: '12:00',
}
const revisions = (teams) => teams.map((team, i) => ({observedAt: '12:0' + i, values: {team}}))
const item = {...base, key: 'one', id: 'INC1', team: 'Сеть', service: 'Заказы'}
const second = {...item, key: 'two', id: 'INC2', team: 'Ядро', service: 'Чеки'}
const one = {
  id: 'g1',
  title: 'Отдельная авария',
  method: 'single',
  evidence: [],
  members: ['one'],
  included: [],
  excluded: [],
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
}
const person = {id: 'oleg', name: 'Олег Соколов'}
test('attention shows only observed consecutive assignment transitions returning to a current team', () => {
  assert.deepEqual(assignmentCycle(item, revisions(['Сеть', 'Сеть', 'БД', 'Платежи', 'Сеть'])), [
    'Сеть',
    'БД',
    'Платежи',
    'Сеть',
  ])
  assert.equal(assignmentCycle(item, revisions(['Сеть', 'Сеть', 'Сеть'])), undefined)
  assert.equal(assignmentCycle(item, revisions(['Сеть', 'БД', 'Мониторинг'])), undefined)
  assert.equal(assignmentCycle(item, revisions(['Сеть', 'БД', null, 'Сеть'])), undefined)
  assert.equal(assignmentCycle({...item, state: 'Завершён'}, revisions(['Сеть', 'БД', 'Сеть'])), undefined)
  const previousEpisode = [
    ...revisions(['Сеть', 'БД']),
    {observedAt: '12:03', values: {state: 'Завершён'}},
    {observedAt: '12:04', values: {state: 'В работе', team: 'Сеть'}},
  ]
  assert.equal(assignmentCycle(item, previousEpisode), undefined)
})

test('a shift receipt, a personal attempt, and an outage group claim have distinct ownership', () => {
  const desk = {
    mode: 'case',
    people: [person],
    tasks: [],
    revisions: {one: revisions(['Сеть', 'БД', 'Сеть'])},
    signals: [{key: 'one', acknowledged: 2}],
    outageGroups: [one],
  }
  let [row] = buildAttentionRows(desk, [item])
  assert.equal(row.ownerLabel, 'Никто не взял')
  assert.deepEqual(row.cycle.teams, ['Сеть', 'БД', 'Сеть'])
  desk.tasks = [{key: 'one', attempts: [{person: 'oleg'}]}]
  ;[row] = buildAttentionRows(desk, [item])
  assert.equal(row.ownerLabel, 'Ожидает принятия · Олег Соколов')
  desk.tasks[0].attempts[0].accepted = 3
  ;[row] = buildAttentionRows(desk, [item])
  assert.equal(row.ownerLabel, 'Ведёт Олег Соколов')
  desk.outageGroups = [{...one, method: 'evidence', members: ['one', 'two']}]
  ;[row] = buildAttentionRows(desk, [item, second])
  assert.equal(row.ownerLabel, 'Никто не взял')
  assert.equal(row.serviceCount, 2)
  desk.outageGroups[0].owner = 'oleg'
  ;[row] = buildAttentionRows(desk, [item, second])
  assert.equal(row.ownerLabel, 'Ведёт Олег Соколов')
  assert.equal(row.members.length, 2)
})

test('card ownership uses group claim and still shows accepted or waiting tasks for incidents outside groups', () => {
  const desk = {people: [person], tasks: [], outageGroups: []}
  assert.equal(cardCoordination(desk, item).ownerLabel, 'Активной задачи нет')
  desk.tasks.push({key: item.key, attempts: [{person: 'oleg'}]})
  assert.equal(cardCoordination(desk, item).ownerLabel, 'Ожидает принятия · Олег Соколов')
  desk.tasks[0].attempts[0].accepted = 42
  assert.equal(cardCoordination(desk, item).ownerLabel, 'Ведёт Олег Соколов')
  desk.outageGroups.push({...one, id: 'related', method: 'evidence', members: [item.key, second.key]})
  assert.equal(cardCoordination(desk, item).ownerLabel, 'Никто не взял')
  desk.outageGroups[0].owner = 'oleg'
  assert.equal(cardCoordination(desk, second).ownerLabel, 'Ведёт Олег Соколов')
})

test('historical candidates outside an outage remain reachable when 100 stronger matches are already members', async () => {
  const {correlationIndex, similarIncidents} = await import('../src/desk/correlation.ts')
  const main = {...item, title: 'Ошибка авторизации', service: 'oauth'}
  const members = Array.from({length: 100}, (_, i) => ({...main, id: 'INC' + i, key: 'member-' + i}))
  const past = {...main, key: 'historic', id: 'INC999', service: 'other', research: true, restoredAt: '11:40'}
  const matches = similarIncidents(
    correlationIndex([main, ...members, past]),
    main,
    new Set(members.map((i) => i.key)),
  )
  assert.deepEqual(
    matches.map((c) => c.incident.key),
    ['historic'],
  )
})

test('wall keeps the urgent, newly-signalled and last claimed situations in view during a busy shift', async () => {
  const {wallHighlights} = await import('../src/control-room/attention.ts')
  const cases = Array.from({length:7}, (_,i) => ({
    id:String(i), members:[{key:'inc-'+i}], group:{createdAt:10},
    ownerState:i===6?'owned':'unclaimed', acceptedAt:i===6?90:undefined,
  }))
  const signals = [{key:'inc-2',at:20}, {key:'inc-4',at:60,acknowledged:85}, {key:'inc-6',at:70}]
  const result = wallHighlights(cases, signals)
  assert.deepEqual(result.visible.map(r=>r.id),['0','4','6'])
  assert.equal(result.newest.id,'4')
  assert.equal(wallHighlights(cases,[{key:'inc-1',at:1}]).newest,undefined)
})
