import assert from 'node:assert/strict'
import test from 'node:test'
import {presetFromQueue, presetHref, createIncidentPresetsApi} from '../src/features/incident-presets/api.ts'

test('presets keep queue filters and reconstruct a safe route without page state', () => {
  const draft = presetFromQueue('Мои платежи', 'assigned', new URLSearchParams({
    q: 'платежи', product: 'Шлюз', priority: '3', page: '7', state: 'Выполняется', size: '25',
  }))
  assert.deepEqual(draft, {name: 'Мои платежи', queue: 'coordinator', filters: {
    q: 'платежи', product: 'Шлюз', priority: '3', state: 'WorkInProgress', size: '25',
  }})
  const href = new URL(presetHref(draft), 'http://localhost')
  assert.match(href.hash, /^#queue\/assigned\?/)
  const query = new URLSearchParams(href.hash.split('?')[1])
  assert.equal(query.get('state'), 'Выполняется')
  assert.equal(query.has('page'), false)
})

test('the API writes only preset data and keeps confirmed records', async () => {
  const calls = []
  const preset = {id: 3, name: 'Просрочка', queue: 'all', filters: {deadline: 'late'}}
  const api = createIncidentPresetsApi(async (url, init) => {
    calls.push([url, init.method ?? 'GET', init.body && JSON.parse(init.body)])
    if (init.method === 'DELETE') return new Response(null, {status: 204})
    return Response.json(init.method ? preset : [preset])
  })
  assert.deepEqual(await api.list(), [preset])
  assert.deepEqual(await api.save({...preset, ownerId: 9}), preset)
  await api.save(preset, preset.id)
  await api.remove(preset.id)
  const {id, ...body} = preset
  const url = '/api/dashboard/incident-presets'
  assert.deepEqual(calls, [
    [url, 'GET', undefined], [url, 'POST', body], [url + '/3', 'PUT', body], [url + '/3', 'DELETE', undefined],
  ])
})
