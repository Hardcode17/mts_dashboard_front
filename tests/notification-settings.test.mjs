import assert from 'node:assert/strict'
import test from 'node:test'
import {ApiError} from '../src/shared/api/http.ts'
import {createNotificationSettingsApi} from '../src/features/notification-settings/api.ts'

test('notification settings read and save separate connections without credential fields', async () => {
  const calls = []
  const connection = {id: 7, channel: 'email', address: 'duty@example.test', active: true, priorityIds: [3, 4]}
  const api = createNotificationSettingsApi(async (path, init) => {
    calls.push({path, method: init.method ?? 'GET', body: init.body && JSON.parse(init.body)})
    if (!init.method) return Response.json([connection])
    return Response.json({...connection, ...JSON.parse(init.body)})
  })
  assert.deepEqual(await api.list(), [connection])
  assert.deepEqual(await api.save({...connection, secretRef: 'DO_NOT_SEND'}), connection)
  const updated = await api.save({...connection, active: false}, connection.id)
  assert.equal(updated.active, false)
  const path = '/api/dashboard/notification-connections'
  const {id, ...payload} = connection
  assert.deepEqual(calls, [
    {path, method: 'GET', body: undefined},
    {path, method: 'POST', body: payload},
    {path: path + '/' + id, method: 'PUT', body: {...payload, active: false}},
  ])
})

test('a rejected update surfaces the backend error instead of confirming the change', async () => {
  const api = createNotificationSettingsApi(async () => Response.json({
    code: 'INVALID_NOTIFICATION_CONNECTION', message: 'Invalid notification connection settings',
  }, {status: 400}))
  await assert.rejects(api.save({channel: 'sms', address: 'demo', active: true, priorityIds: [4]}, 7),
    error => error instanceof ApiError && error.status === 400 && error.code === 'INVALID_NOTIFICATION_CONNECTION')
})
