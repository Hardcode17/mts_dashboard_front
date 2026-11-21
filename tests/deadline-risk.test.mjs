import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {normalizeDeadlineRisk} from '../src/deadlineRisk.ts'
import {createIncidentsApi} from '../src/features/incidents/api/client.ts'
import {toIncident} from '../src/features/incidents/model/toDesk.ts'
import {parseSnapshot} from '../mock/snapshot.ts'

const risk = {risk: 'unknown', evaluatedAt: '2026-11-21T10:00:00Z',
  reasons: [{code: 'no_history', text: 'Недостаточно исторических данных'}], score: null}
const card = {id: 'INC000001', header: 'Сбой', productName: 'МТС', assignedGroupName: 'Support',
  stateEnum: 'Assigned', priorityId: 3, submitDate: '2026-11-21T09:00:00Z',
  deadline: '2026-11-21T12:00:00Z', completionDate: null, groupMemberships: [],
  assignedEmployee: null, remainingSeconds: 7200, overdue: false, itsmUrl: 'https://example.test',
  itsmDemo: false, revision: 1, eventSeq: 2}

test('risk normalization preserves all categories and explanations without exposing score', () => {
  for (const level of ['low', 'medium', 'high', 'unknown']) {
    assert.deepEqual(normalizeDeadlineRisk({...risk, risk: level}),
      {risk: level, evaluatedAt: risk.evaluatedAt, reasons: risk.reasons})
  }
  assert.equal(normalizeDeadlineRisk(undefined), undefined)
  assert.equal(normalizeDeadlineRisk(null), undefined)
  assert.equal(normalizeDeadlineRisk({risk: 'critical'}), undefined)
  assert.equal(normalizeDeadlineRisk({risk: ['high']}), undefined)
  assert.deepEqual(normalizeDeadlineRisk({...risk, evaluatedAt: 'bad', reasons: [{code: 'x'}, ...risk.reasons]}),
    {risk: 'unknown', evaluatedAt: undefined, reasons: risk.reasons})
})

test('canonical detail and live snapshot mappings retain unknown risk and tolerate old backends', async t => {
  let payload = {...card, deadlineRisk: risk}
  const server = createServer((_req, res) => res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(payload)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const api = createIncidentsApi({baseUrl: `http://127.0.0.1:${server.address().port}`})
  const detail = await api.getIncident(card.id)
  assert.deepEqual(toIncident(detail.incident).deadlineRisk, normalizeDeadlineRisk(risk))
  assert.deepEqual(parseSnapshot([payload])[0].deadlineRisk, normalizeDeadlineRisk(risk))
  payload = card
  assert.equal(toIncident((await api.getIncident(card.id)).incident).deadlineRisk, undefined)
  assert.equal(parseSnapshot([payload])[0].deadlineRisk, undefined)
})
