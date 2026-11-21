import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {createDesk, applySnapshot, execute, dispatchTasks, lookup, items, tickDesk} from '../mock/engine.ts'
import {coordinatorGroup, channels, active, onCoordinators} from '../src/desk/types.ts'
import {correlationIndex, similarIncidents} from '../src/desk/correlation.ts'
import {recoveryTrial, measures} from '../src/desk/recovery.ts'
const time = Date.parse('2026-11-21T09:42:00Z')
const source = JSON.parse(readFileSync(new URL('../mock/fixtures/incidents.json', import.meta.url), 'utf8'))
const baseline = () => {
  const d = createDesk('case', time)
  applySnapshot(d, [], time)
  return d
}
const incoming = (n, extra = {}) => ({
  ...source[0],
  id: 'INC' + n,
  priorityId: 4,
  assignedGroupName: coordinatorGroup,
  ...extra,
})
test('official fixture is 44 unique INC and gives required 0/2/1/5; an absent INC is retained', () => {
  const d = baseline()
  applySnapshot(d, source, time + 1)
  const rows = items(d)
  assert.equal(rows.length, 44)
  assert.deepEqual(
    [
      rows.filter((i) => active(i) && i.priority === 4).length,
      rows.filter(onCoordinators).length,
      rows.filter((i) => active(i) && i.priority === 3).length,
      rows.filter((i) => i.research).length,
    ],
    [0, 2, 1, 5],
  )
  applySnapshot(d, source.slice(1), time + 2)
  assert.equal(lookup(d, source[0].id).absent, true)
  assert.equal(lookup(d, source[0].id).state, 'Назначен')
})
test('snapshots deduplicate and preserve field history, resolution and another critical episode', () => {
  const d = baseline(),
    id = 'INC42',
    r = incoming(42)
  applySnapshot(d, [r], time + 1)
  assert.equal(d.signals.length, 1)
  assert.deepEqual(
    d.events.map((e) => e.kind),
    ['assign', 'new'],
  )
  const rev = d.revisions[id].length,
    n = d.notices.length
  applySnapshot(d, [r], time + 2)
  assert.equal(d.revisions[id].length, rev)
  assert.equal(d.notices.length, n)
  execute(d, {type: 'ack', ids: [d.signals[0].id]}, time + 3)
  const resolved = {
    ...r,
    stateEnum: 'Resolved',
    completionDate: new Date(time + 4).toISOString(),
    solution: 'Проверка прошла',
  }
  applySnapshot(d, [resolved], time + 4)
  assert.equal(d.events[0].kind, 'restore')
  assert.equal(d.revisions[id].at(-1).values.solution, 'Проверка прошла')
  applySnapshot(d, [r], time + 5)
  assert.equal(d.signals.length, 2)
  assert(!d.signals[1].acknowledged)
  assert(d.signals[0].acknowledged)
  assert.throws(() => applySnapshot(d, [r, r], time + 6), /id/)
  assert.throws(() => applySnapshot(d, [{...r, priorityId: 'X'}], time + 6), /priorityId/)
})
test('acknowledgement, read receipt and personal acceptance are independent; exact timeout survives restart', () => {
  const d = baseline()
  applySnapshot(d, [incoming(1), incoming(2), incoming(3)], time + 10)
  dispatchTasks(d, time + 10)
  const [one, two, three] = d.tasks
  const a = one.attempts[0],
    b = two.attempts[0]
  assert.notEqual(a.person, b.person)
  assert.equal(three.attempts.length, 0)
  execute(d, {type: 'ack', ids: [d.signals[0].id]}, time + 100)
  const notice = d.notices.find((n) => n.attempt === a.id)
  execute(d, {type: 'read', id: notice.id}, time + 200)
  assert(!a.accepted)
  execute(d, {type: 'accept', id: b.id, person: b.person, key: two.key}, time + 1000)
  const restarted = JSON.parse(JSON.stringify(d))
  assert.equal(restarted.tasks[0].attempts[0].deadline, time + 60010)
  execute(restarted, {type: 'available', person: 'ira', enabled: true}, time + 60010)
  assert.throws(
    () => execute(restarted, {type: 'accept', id: a.id, person: a.person, key: one.key}, time + 60011),
    /устарело/,
  )
  const first = restarted.tasks[0].attempts
  assert.equal(first[0].reason, 'Нет реакции')
  assert.equal(first[1].person, 'ira')
  assert.equal(first[1].deadline, time + 120010)
  execute(restarted, {type: 'accept', key: one.key, id: first[1].id, person: 'ira'}, time + 61000)
  assert.equal(lookup(restarted, one.key).team, coordinatorGroup)
  execute(
    restarted,
    {type: 'handoff', key: one.key, id: first[1].id, person: 'ira', value: 'Платежи'},
    time + 62000,
  )
  assert.equal(lookup(restarted, one.key).team, 'Платежи')
  assert(active(lookup(restarted, one.key)))
})
test('a skipped coordinator cannot cycle through the same task until becoming available again', () => {
  const d = baseline()
  d.people[1].available = false
  applySnapshot(d, [incoming(8)], time + 1)
  dispatchTasks(d, time + 1)
  dispatchTasks(d, time + 60001)
  assert.equal(d.tasks[0].attempts.length, 1)
  dispatchTasks(d, time + 180000)
  assert.equal(d.tasks[0].attempts.length, 1)
  execute(d, {type: 'available', person: 'anna', enabled: false}, time + 180001)
  execute(d, {type: 'available', person: 'anna', enabled: true}, time + 180002)
  assert.equal(d.tasks[0].attempts.length, 2)
})
test('all mock channels record a distinct receipt, failed delivery retries alone', () => {
  const d = baseline()
  applySnapshot(d, [incoming(5)], time + 1)
  d.notices = []
  d.people.forEach((p) => (p.available = false))
  execute(d, {type: 'failChannels', channels: ['SMS']}, time + 2)
  execute(
    d,
    {type: 'send', key: 'INC5', person: 'Дежурный', channels: [...channels], text: 'Проверьте INC5'},
    time + 3,
  )
  assert.equal(d.notices.length, 9)
  assert.equal(new Set(d.notices.map((n) => n.channel)).size, 9)
  const sms = d.notices.find((n) => n.channel === 'SMS')
  assert.equal(sms.status, 'Ошибка')
  execute(d, {type: 'failChannels', channels: []}, time + 4)
  execute(d, {type: 'retry', id: sms.id}, time + 5)
  assert.equal(sms.status, 'Доставлено')
  assert.equal(sms.tries, 2)
  assert(d.notices.filter((n) => n !== sms).every((n) => n.tries === 1))
  execute(d, {type: 'read', id: sms.id}, time + 6)
  assert.equal(sms.status, 'Прочитано')
})
test('matching yields reasons and only confirmed links are stored symmetrically', () => {
  const d = baseline()
  execute(d, {type: 'wifi'}, time + 1)
  const i = lookup(d, 'wifi-rostov')
  const hits = similarIncidents(correlationIndex(items(d)), i)
  assert.equal(hits[0].incident.key, 'wifi-msk')
  assert(hits[0].reasons.some((s) => s.startsWith('Сервис:')))
  assert(!d.work[i.key]?.links.length)
  execute(d, {type: 'link', key: i.key, value: 'wifi-msk'}, time + 2)
  execute(d, {type: 'link', key: i.key, value: 'wifi-msk'}, time + 3)
  assert.deepEqual(d.work['wifi-msk'].links, [i.key])
  execute(d, {type: 'unlink', key: i.key, value: 'wifi-msk'}, time + 4)
  assert.deepEqual(d.work[i.key].links, [])
})
test('critical alert open batch is exact and deadline warning repeats only if its rule or deadline changes', () => {
  const d = baseline()
  const first = incoming(1, {deadline: new Date(time + 600000).toISOString()})
  const second = incoming(2), third = incoming(3)
  applySnapshot(d, [first, second], time + 1)
  const shown = d.signals.map(signal => signal.id)
  assert.equal(shown.length, 2)
  applySnapshot(d, [first, second, third], time + 2)
  execute(d, {type: 'ack', ids: shown}, time + 3)
  assert.deepEqual(d.signals.filter(s => !s.acknowledged).map(s=>s.key), [third.id])
  assert(d.signals.filter(s=>shown.includes(s.id)).every(s=>s.acknowledged===time+3))
  assert.equal(d.quietUntil, time + 30003)
  tickDesk(d, time + 4)
  tickDesk(d, time + 5)
  assert.equal(d.events.filter((e) => e.kind === 'due').length, 1)
})
test('the same symptom produces two distinct measured recovery recommendations', () => {
  for (const profile of ['database', 'workers']) {
    const [base, replica, limited] = measures.map((m) => recoveryTrial(profile, m, 100))
    assert.equal(base.input, 100)
    assert(base.actual <= base.input)
    assert(profile === 'database' ? limited.actual > replica.actual : replica.actual > limited.actual)
    assert.equal(limited.background, 12)
  }
})
test('analysis, transcript and handoff keep their sources; mock outages do not erase earlier reports', () => {
  const d = createDesk('volume', time),
    key = 'incident'
  execute(d, {type: 'analyze', key}, time + 1)
  assert.match(d.work[key].reports[0].analysis.hypothesis, /пула/)
  execute(d, {type: 'diagnostics', key, number: 3, age: 10, value: 'workers'}, time + 2)
  execute(d, {type: 'analyze', key}, time + 3)
  assert.match(d.work[key].reports[0].analysis.hypothesis, /Обработчики/)
  assert.match(d.work[key].reports[0].content, /запаздывает/)
  execute(d, {type: 'diagnostics', key, number: 3, age: 10, enabled: true}, time + 4)
  execute(d, {type: 'analyze', key}, time + 5)
  assert.equal(d.work[key].reports[0].analysis.hypothesis, null)
  execute(d, {type: 'note', key, kind: 'Следующий шаг', owner: 'Сеть', text: 'Проверить маршрут'}, time + 6)
  execute(d, {type: 'meetingEnd', key}, time + 7)
  assert.match(d.work[key].reports[0].content, /Проверить маршрут/)
  execute(d, {type: 'diagnostics', key, number: 3, age: 10, kind: 'offline'}, time + 8)
  assert.throws(() => execute(d, {type: 'analyze', key}, time + 9), /недоступна/)
  assert.equal(d.work[key].reports.filter((x) => x.title === 'Разбор агента').length, 3)
})

test('queue order uses ITSM priority, deadline, registration and INC as stable tie breakers', async () => {
  const {incidentOrder} = await import('../src/desk/order.ts')
  const absolute = value => Date.parse('2026-11-21T' + value + ':00+03:00')
  const common = {state: 'Назначен', priority: 3, registeredAt: absolute('10:00'), dueAt: absolute('13:00')}
  const cases = [
    {...common, id: 'B'},
    {...common, id: 'A'},
    {...common, id: 'C', registeredAt: absolute('09:00')},
    {...common, id: 'D', dueAt: null},
    {...common, id: 'E', priority: 4, dueAt: null},
    {...common, id: 'F', dueAt: absolute('12:00')},
  ]
  assert.deepEqual(
    cases.sort(incidentOrder).map((i) => i.id),
    ['E', 'F', 'C', 'A', 'B', 'D'],
  )
})

test('a shop run counts distinct accepted orders, requires all three measures and releases the completed run', async () => {
  const {shopStand} = await import('../mock/shop.ts')
  const shop = shopStand(),
    id = shop.start('workers', 2, time)
  assert.deepEqual(shop.order(id, 0, 0), shop.order(id, 0, 0))
  assert.throws(() => shop.finish(id), /неполон/)
  assert.throws(() => shop.order(id, 'length', 1), /Неизвестный/)
  for (let leg = 0; leg < 3; leg++) for (let n = 0; n < 2; n++) shop.order(id, leg, n)
  const result = shop.finish(id)
  assert.equal(result.text.match(/из 2 уникальных заказов/g)?.length, 3)
  result.release()
  assert.throws(() => shop.order(id, 0, 0), /Неизвестный/)
})
