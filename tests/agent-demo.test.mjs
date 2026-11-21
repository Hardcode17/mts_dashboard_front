import assert from 'node:assert/strict'
import {test} from 'node:test'
import {initialIncidents, additionalIncidents} from '../mock/fixtures/shift.ts'
import {analyzeDemoIncident} from '../mock/fixtures/analysis.ts'

const payment = initialIncidents.find(item => item.key === 'incident')

test('the payment hypothesis depends on the readings', () => {
  const result = analyzeDemoIncident(payment)
  assert.equal(result.evidence.length, 4)
  assert.match(result.hypothesis, /пула/)
  assert.match(result.recipient, /БД/)
  const alternatives = analyzeDemoIncident(payment, {kind: 'payment', waitMs: 80, cpuPercent: 96, held: 2, pool: 24})
  assert.match(alternatives.hypothesis, /Обработчики/)
  assert.equal(analyzeDemoIncident(payment,{kind:'payment',waitMs:120,cpuPercent:30,held:2,pool:24}).hypothesis,null)
})

test('auth uses its own logs; other cards do not inherit another incident’s diagnostics', () => {
  const result = analyzeDemoIncident(initialIncidents.find(item => item.key === 'auth'))
  assert.equal(result.scenario, 'auth')
  assert.match(result.evidence.at(-1).record, /demo-auth-17/)
  assert.match(result.question, /demo-auth-17/)
  for (const incident of [initialIncidents.find(item => item.key === 'access'), additionalIncidents[0]]) {
    const partial = analyzeDemoIncident(incident)
    assert.equal(partial.hypothesis, null)
    assert.equal(partial.evidence.length, 1)
    assert.ok(partial.evidence[0].record.includes(incident.id))
    assert.equal(partial.recipient, 'Технический адресат не подтверждён')
  }
})
