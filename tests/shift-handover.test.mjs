import {strict as assert} from 'node:assert'
import test from 'node:test'
import {createShiftHandoverApi} from '../src/features/shift-handover/api.ts'
import {handoverSituations} from '../src/features/shift-handover/situations.ts'

test('shift handover reads the inbox and sends and accepts only through explicit calls', async () => {
  const calls = []
  const api = createShiftHandoverApi(async (path, init) => {
    calls.push({path, method: init.method ?? 'GET', body: init.body && JSON.parse(init.body)})
    return init.method === 'POST' && path.endsWith('/claim')
      ? new Response(null, {status: 200})
      : Response.json({id: 24})
  })
  await api.load()
  assert.deepEqual(calls.map(call => call.method), ['GET'])
  const request = {requestId: '27d345d1-22ec-4e31-8c79-9c5b12f1fa28', recipientId: 4, taskIds: [8], summary: 'Проверить со сменой'}
  await api.send(request)
  await api.take(24, 8)
  assert.deepEqual(calls, [
    {path: '/api/dashboard/shift-handovers', method: 'GET', body: undefined},
    {path: '/api/dashboard/shift-handovers', method: 'POST', body: request},
    {path: '/api/dashboard/shift-handovers/24/tasks/8/claim', method: 'POST', body: undefined},
  ])
})


test('handover keeps the backend priority and deadline order when grouping incidents', () => {
  const first = {taskId: 11, situationKey: 'outage-a'}
  const second = {taskId: 12, situationKey: 'outage-b'}
  const third = {taskId: 13, situationKey: 'outage-a'}
  const fourth = {taskId: 14, situationKey: null}
  assert.deepEqual(
    handoverSituations([first, second, third, fourth], item => item.situationKey ?? String(item.taskId)),
    [
      {key: 'outage-a', incidentTasks: [first, third]},
      {key: 'outage-b', incidentTasks: [second]},
      {key: '14', incidentTasks: [fourth]},
    ],
  )
})
