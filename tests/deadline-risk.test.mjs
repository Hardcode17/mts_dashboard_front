import assert from 'node:assert/strict'
import test from 'node:test'
import {normalizeDeadlineRisk} from '../src/entities/incident/model/deadlineRisk.ts'
import {toIncident} from '../src/features/incidents/model/toDesk.ts'
import {parseSnapshot} from '../mock/snapshot.ts'

const sample = {
  risk: 'high',
  evaluatedAt: '2026-11-21T10:00:00Z',
  reasons: [
    {code: 'group_median_exceeds', text: 'Медиана группы решения 6.0 ч, до дедлайна 2.1 ч'},
    {code: 'deadline_extended', text: 'Дедлайн уже продлевался 1 раз'},
  ],
  score: 0.83,
}

test('normalizeDeadlineRisk keeps the category, reasons and evaluation time, drops the debug score', () => {
  assert.deepEqual(normalizeDeadlineRisk(sample), {
    risk: 'high',
    evaluatedAt: '2026-11-21T10:00:00Z',
    reasons: sample.reasons,
  })
})

test('normalizeDeadlineRisk treats every documented category as valid', () => {
  for (const risk of ['low', 'medium', 'high', 'unknown'])
    assert.equal(normalizeDeadlineRisk({...sample, risk}).risk, risk)
})

test('normalizeDeadlineRisk maps unusable payloads to undefined so the card shows «Анализ недоступен»', () => {
  assert.equal(normalizeDeadlineRisk(undefined), undefined)
  assert.equal(normalizeDeadlineRisk(null), undefined)
  assert.equal(normalizeDeadlineRisk('high'), undefined)
  assert.equal(normalizeDeadlineRisk({risk: 'critical'}), undefined)
  assert.equal(normalizeDeadlineRisk({reasons: []}), undefined)
})

test('normalizeDeadlineRisk drops broken reasons and keeps the rest', () => {
  const data = normalizeDeadlineRisk({
    ...sample,
    reasons: [...sample.reasons, {code: '', text: 'пустой код'}, {code: 'no-text'}, 'мусор'],
  })
  assert.deepEqual(data.reasons, sample.reasons)
})

test('normalizeDeadlineRisk drops an unparsable evaluation time', () => {
  assert.deepEqual(normalizeDeadlineRisk({...sample, evaluatedAt: 'сейчас'}), {
    risk: 'high',
    evaluatedAt: undefined,
    reasons: sample.reasons,
  })
})

function dto(deadlineRisk) {
  return {
    id: 'INC000021940001',
    header: 'Проверка маппинга риска',
    description: null,
    productName: 'МТС ID',
    service: null,
    serviceType: null,
    submitDate: '2026-11-21T09:00:00Z',
    completionDate: null,
    stateEnum: 'Assigned',
    priorityId: 2,
    assignedGroupName: null,
    assignedEmployee: null,
    deadline: '2026-11-21T12:00:00Z',
    remainingSeconds: 3600,
    overdue: false,
    groups: [],
    deadlineRisk,
  }
}

test('toIncident carries a normalized deadlineRisk into the desk record', () => {
  const record = toIncident(dto(sample))
  assert.equal(record.dueAt, Date.parse('2026-11-21T12:00:00Z'))
  assert.deepEqual(record.deadlineRisk, {
    risk: 'high',
    evaluatedAt: '2026-11-21T10:00:00Z',
    reasons: sample.reasons,
  })
})

test('toIncident leaves deadlineRisk undefined without the field and degrades on broken data', () => {
  assert.equal(toIncident(dto(undefined)).deadlineRisk, undefined)
  assert.equal(toIncident(dto(null)).deadlineRisk, undefined)
  assert.equal(toIncident(dto({risk: 'soon'})).deadlineRisk, undefined)
})

function snapshotRow(overrides = {}) {
  return {
    sysId: '179413934903718013',
    id: 'INC000021940001',
    state: 'Назначен',
    stateEnum: 'Assigned',
    submitDate: '2026-11-21T09:00:00Z',
    deadline: '2026-11-21T12:00:00Z',
    header: 'Проверка парсинга',
    productName: 'МТС ID',
    priorityId: 2,
    ...overrides,
  }
}

test('parseSnapshot carries the deadlineRisk mock field into the incident', () => {
  const [item] = parseSnapshot([snapshotRow({deadlineRisk: sample})])
  assert.equal(item.due, '15:00')
  assert.deepEqual(item.deadlineRisk, {
    risk: 'high',
    evaluatedAt: '2026-11-21T10:00:00Z',
    reasons: sample.reasons,
    score: 0.83,
  })
})

test('parseSnapshot leaves deadlineRisk undefined when the field is absent', () => {
  const [item] = parseSnapshot([snapshotRow()])
  assert.equal(item.due, '15:00')
  assert.equal(item.deadlineRisk, undefined)
})

test('parseSnapshot rejects a malformed deadlineRisk block', () => {
  assert.throws(() => parseSnapshot([snapshotRow({deadlineRisk: {risk: 'soon'}})]), /deadlineRisk/)
  assert.throws(
    () => parseSnapshot([snapshotRow({deadlineRisk: {...sample, reasons: [{code: 'x'}]}})]),
    /deadlineRisk/,
  )
})
