import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {applySnapshot, applyCard, createDesk, execute, items} from '../mock/engine.ts'
import {applyGroupReview, pendingGroupReviews} from '../mock/incidentGroups.ts'

const [base] = JSON.parse(readFileSync(new URL('../mock/fixtures/incidents.json', import.meta.url)))
const t = Date.parse('2026-11-21T12:30:00+03:00')
const row = (n, changes = {}) => ({
  ...base,
  id: 'INC' + n,
  header: 'Тайм-аут подтверждения запроса ' + n,
  productName: 'Продукт ' + (n % 11),
  service: 'Сервис ' + (n % 11),
  stateEnum: 'WorkInProgress',
  priorityId: 4,
  assignedGroupName: 'Команда приложения',
  completionDate: null,
  deadline: null,
  upstreamService: 'МТС ID',
  errorCode: 'AUTH_TIMEOUT',
  submitDate: new Date(t + n).toISOString(),
  ...changes,
})
const group = (d) => d.outageGroups.find((g) => g.method !== 'single')
const single = (d, num) => d.outageGroups.find((g) => g.id === 'inc:INC' + num)
function command(d, g, type, ids, person = 'anna') {
  execute(d, {type, id: g.id, ids, expected: g.revision, person}, t + 2)
}
const yes = {agree: true, reason: 'Совпали окно, отказ общей зависимости и код.', model: 'test-model'}
const no = {...yes, agree: false, reason: 'Наблюдения не подтверждают одну неисправность.'}

test('100 INC from 11 services form one outage; unrelated fault remains separate; overrides and owner survive recalculation', () => {
  const d = createDesk('case', t)
  const records = Array.from({length: 100}, (_, i) => row(i + 1))
  records.push(row(101, {upstreamService: 'Видео', errorCode: 'MEDIA_IO'}))
  applySnapshot(d, records, t + 1)
  let g = group(d)
  assert.equal(d.outageGroups.length, 2)
  assert.equal(g.members.length, 100)
  assert.equal(g.method, 'evidence')
  const [proposal] = pendingGroupReviews(d)
  assert(proposal)
  assert.equal(proposal.services.length, 11)
  assert(applyGroupReview(d, proposal, yes, t + 2, items(d)))
  assert.equal(group(d).method, 'model')
  assert.equal(pendingGroupReviews(d).length, 0)
  const stableId = g.id
  g = group(d)
  command(d, g, 'groupClaim', [], 'oleg')
  assert.throws(() => command(d, g, 'groupClaim', [], 'anna'), /изменилась|другому/)
  assert.equal(group(d).owner, 'oleg')
  command(d, group(d), 'groupExclude', ['INC1', 'INC2'])
  assert(!group(d).members.includes('INC1'))
  assert(single(d, 1))
  assert(single(d, 2))
  command(d, group(d), 'groupAdd', ['INC1', 'INC101'])
  assert(group(d).members.includes('INC101'))
  assert(!single(d, 101))
  const revision = group(d).revision
  const restarted = JSON.parse(JSON.stringify(d))
  applySnapshot(restarted, [...records].reverse(), t + 4)
  assert.equal(group(restarted).id, stableId)
  assert.equal(group(restarted).revision, revision)
  assert.equal(group(restarted).owner, 'oleg')
  const edited = {...restarted.records.INC8, team: 'Новая команда'}
  applyCard(restarted, edited, t + 5)
  assert.equal(group(restarted).revision, revision)
  assert(!group(restarted).members.includes('INC2'))
  assert.equal(new Set(restarted.outageGroups.flatMap((g) => g.members)).size, 101)
  assert.equal(restarted.records.INC1.team, 'Команда приложения')
})

test('coincident time, generic symptoms and a single word cannot join unrelated incidents', () => {
  const d = createDesk('case', t)
  const a = row(1, {
    header: 'Ошибка',
    upstreamService: undefined,
    errorCode: undefined,
    description: 'HTTP 503',
  })
  applySnapshot(d, [a, {...a, id: 'INC2', productName: 'Другой продукт', service: 'Реестр'}], t)
  assert(d.outageGroups.every((g) => g.method === 'single'))
  assert.equal(pendingGroupReviews(d).length, 0)
  const same = row(3)
  const late = row(4, {submitDate: new Date(t + 2 * 3600000).toISOString()})
  applySnapshot(d, [same, late], t + 1)
  assert(d.outageGroups.every((g) => g.method === 'single'))
  applySnapshot(d, [same, row(4, {upstreamService: 'Автоплатёж'})], t + 2)
  assert(d.outageGroups.every((g) => g.method === 'single'))
  const text = row(1, {
    upstreamService: undefined,
    errorCode: undefined,
    description: 'upstream=МТС ID; error=AUTH_TIMEOUT',
  })
  applySnapshot(d, [text, row(2)], t + 3)
  assert.deepEqual(group(d).members, ['INC1', 'INC2'])
})

test('parent hierarchy is authoritative across tiers, preserves omitted links and accepts explicit null', () => {
  const d = createDesk('case', t),
    root = row(10, {priorityId: 2})
  const child = row(11, {parentId: root.id}),
    leaf = row(12, {parentId: 'INC11'})
  const elsewhere = row(13, {upstreamService: undefined, errorCode: undefined})
  applySnapshot(d, [child, leaf, root, elsewhere], t)
  assert.equal(group(d).method, 'parent')
  assert.deepEqual(group(d).members, ['INC10', 'INC11', 'INC12'])
  assert.equal(pendingGroupReviews(d).length, 0)
  const omitted = {...leaf}
  delete omitted.parentId
  applySnapshot(d, [root, child, omitted, elsewhere], t + 1)
  assert.deepEqual(group(d).members, ['INC10', 'INC11', 'INC12'])
  applySnapshot(
    d,
    [root, child, {...leaf, parentId: null, upstreamService: undefined, errorCode: undefined}, elsewhere],
    t + 2,
  )
  assert.deepEqual(group(d).members, ['INC10', 'INC11'])
  assert(single(d, 12))
})

test('a negative model verdict dissolves an unclaimed cluster; stale verdict and repeated snapshots cannot resurrect it', () => {
  const d = createDesk('case', t),
    records = [row(1), row(2), row(3)]
  applySnapshot(d, records, t)
  const [first] = pendingGroupReviews(d)
  applySnapshot(d, [...records, row(4)], t + 1)
  assert.equal(applyGroupReview(d, first, no, t + 2, items(d)), false)
  const [updated] = pendingGroupReviews(d)
  assert(applyGroupReview(d, updated, no, t + 3, items(d)))
  assert.equal(group(d), undefined)
  assert.equal(d.outageGroups.length, 4)
  applySnapshot(d, [...records, row(4)], t + 4)
  assert.equal(group(d), undefined)
  assert.equal(pendingGroupReviews(d).length, 0)
  assert.equal(applyGroupReview(d, updated, yes, t + 4, items(d)), false)
})

test('claim and manual membership take precedence over an in-flight model result', () => {
  const d = createDesk('case', t)
  applySnapshot(d, [row(1), row(2), row(3), row(9, {upstreamService: 'Другая сеть'})], t)
  const [pending] = pendingGroupReviews(d)
  command(d, group(d), 'groupClaim', [], 'oleg')
  command(d, group(d), 'groupExclude', ['INC2'])
  command(d, group(d), 'groupAdd', ['INC9'])
  assert(applyGroupReview(d, pending, no, t + 2, items(d)))
  const g = group(d)
  assert.deepEqual(g.members, ['INC1', 'INC3', 'INC9'])
  assert.equal(g.owner, 'oleg')
  assert.equal(g.method, 'manual')
  assert.match(g.evidence[0], /Состав сохранён/)
  assert(single(d, 2))
  assert.equal(pendingGroupReviews(d).length, 0)
})

test('manually joining independent incidents preserves all active INC and the visible owner', () => {
  const d = createDesk('case', t)
  const a = row(1, {upstreamService: 'A'}),
    b = row(2, {upstreamService: 'B'})
  applySnapshot(d, [a, b], t)
  const first = single(d, 1)
  assert.throws(() => command(d, first, 'groupExclude', ['INC1']), /открывает группу/)
  command(d, first, 'groupClaim', [], 'oleg')
  command(d, single(d, 1), 'groupAdd', ['INC2'], 'oleg')
  const pair = group(d)
  assert.equal(pair.method, 'manual')
  assert.deepEqual(pair.members, ['INC1', 'INC2'])
  assert.equal(pair.owner, 'oleg')
  assert.equal(d.outageGroups.length, 1)
  command(d, pair, 'groupExclude', ['INC2'], 'oleg')
  assert(single(d, 2))
  assert.equal(single(d, 1).owner, 'oleg')
})

test('a singleton already claimed is supported when the common outage appears', () => {
  const d = createDesk('case', t)
  const a = row(1)
  applySnapshot(d, [a], t)
  command(d, single(d, 1), 'groupClaim', [], 'oleg')
  applySnapshot(d, [a, row(2)], t + 1)
  assert.equal(d.outageGroups.length, 1)
  assert.equal(group(d).owner, 'oleg')
})

test('excluding the anchor from a manually expanded group yields a fresh independent case with no collision', () => {
  const d = createDesk('case', t)
  applySnapshot(d, [row(1, {upstreamService: 'A'}), row(2, {upstreamService: 'B'})], t)
  command(d, single(d, 1), 'groupAdd', ['INC2'])
  const pair = group(d)
  command(d, pair, 'groupExclude', ['INC1'])
  assert.deepEqual(d.outageGroups.find((g) => g.id === pair.id).members, ['INC2'])
  const detached = d.outageGroups.find((g) => g.method === 'single' && g.members.includes('INC1'))
  assert(detached)
  assert.notEqual(pair.id, detached.id)
  assert.deepEqual(d.outageGroups.flatMap((g) => g.members).sort(), ['INC1', 'INC2'])
})

test('additional tickets with the same evidence do not starve the inference already running', () => {
  const d = createDesk('case', t)
  const rows = [row(1), row(2)]
  applySnapshot(d, rows, t)
  const [review] = pendingGroupReviews(d)
  const sameService = row(12)
  applySnapshot(d, [...rows, sameService], t + 2)
  assert.equal(pendingGroupReviews(d)[0].fingerprint, review.fingerprint)
  assert(applyGroupReview(d, review, yes, t + 3, items(d)))
  assert.equal(group(d).method, 'model')
  assert.equal(group(d).members.length, 3)
  applySnapshot(d, [...rows, sameService, row(23)], t + 4)
  assert.equal(group(d).members.length, 4)
  assert.equal(pendingGroupReviews(d).length, 0)
})

test('the anchor and an actively added member stay together when an automatic candidate appears later', () => {
  const d = createDesk('case', t)
  const a = row(1),
    b = row(2, {upstreamService: 'Другой сервис'})
  applySnapshot(d, [a, b], t)
  command(d, single(d, 1), 'groupAdd', ['INC2'])
  const manual = group(d)
  applySnapshot(d, [a, b, row(3), row(4)], t + 2)
  assert.deepEqual(d.outageGroups.find((g) => g.id === manual.id).members, ['INC1', 'INC2'])
  assert.deepEqual(d.outageGroups.find((g) => g.method === 'evidence').members, ['INC3', 'INC4'])
})

test('a coordinator can claim the same live outbreak after inference and new arrivals, but cannot claim a later reopening', () => {
  const d = createDesk('case', t)
  applySnapshot(d, [row(1), row(2)], t)
  const opened = group(d)
  const [review] = pendingGroupReviews(d)
  applyGroupReview(d, review, yes, t + 1, items(d))
  assert.equal(group(d).revision, opened.revision, 'model prose does not invalidate membership edits')
  applySnapshot(d, [row(1), row(2), row(3)], t + 2)
  assert.throws(() => command(d, opened, 'groupExclude', ['INC1']), /изменилась/)
  command(d, opened, 'groupClaim', [], 'oleg')
  assert.equal(group(d).owner, 'oleg')
  assert.throws(() => command(d, opened, 'groupClaim', [], 'anna'), /другому/)
  applySnapshot(d, [], t + 3)
  applySnapshot(d, [row(1), row(2)], t + 4)
  assert.equal(group(d).owner, undefined)
  assert.throws(() => command(d, opened, 'groupClaim', [], 'oleg'), /изменилась/)
})
