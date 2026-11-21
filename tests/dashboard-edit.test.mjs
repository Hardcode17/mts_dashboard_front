import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {mockService} from '../mock/server.ts'

// Контракт официального изменения инцидентов (KAN-58/KAN-12):
// GET /api/dashboard/users и PATCH /api/dashboard/incidents/{incidentId}.

test('the official directory and incident patch follow the dashboard contract', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcc-official-test-'))
  let api, server, root
  async function start() {
    api = mockService(dir)
    server = createServer((q, r) => api.handle(q, r, () => r.end()))
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    root = 'http://127.0.0.1:' + server.address().port
  }
  async function close() {
    await new Promise((done) => server.close(done))
    api.close()
  }
  const users = async () => (await (await fetch(root + '/api/dashboard/users')).json())
  const patch = (id, body) =>
    fetch(root + '/api/dashboard/incidents/' + id, {
      method: 'PATCH',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body),
    })
  const desk = async () => (await (await fetch(root + '/api/stand/snapshot?mode=volume&since=-1')).json()).desk
  const auth = 'INC000021940126'
  try {
    await start()
    const directory = await users()
    assert.equal(directory.length > 10, true)
    for (const user of directory) {
      assert.equal(typeof user.sysId, 'string')
      assert.equal(typeof user.login, 'string')
      assert.equal(typeof user.name, 'string')
      assert.equal(typeof user.groupName, 'string')
    }
    assert.equal(directory.some((u) => u.login === 'auth1' && u.name === 'Марат Ветров'), true)
    assert.equal(directory.some((u) => u.login === 'anna' && u.groupName.includes('Координаторы')), true)

    // Пустое тело и чужие поля отклоняются как на бэкенде.
    assert.equal((await patch(auth, {})).status, 400)
    const foreign = await patch(auth, {priorityId: 4})
    assert.equal(foreign.status, 400)
    assert.equal((await foreign.json()).code, 'INCIDENT_PATCH_INVALID')
    assert.equal((await patch('not-an-inc', {stateEnum: 'Assigned'})).status, 400)
    assert.equal((await patch('INC000000000000', {stateEnum: 'Assigned'})).status, 404)
    const missing = await patch('INC000000000000', {stateEnum: 'Assigned'})
    const notFound = await missing.json()
    assert.equal(notFound.code, 'INCIDENT_NOT_FOUND')
    assert.equal(typeof notFound.eventSeq, 'number')

    assert.equal((await patch(auth, {assignedEmployeeLogin: 'ghost'})).status, 400)
    assert.equal((await patch(auth, {stateEnum: 'Paused'})).status, 400)
    const orphanSolution = await patch(auth, {solution: 'Исправлено.'})
    assert.equal(orphanSolution.status, 400)
    assert.equal((await orphanSolution.json()).code, 'INCIDENT_PATCH_INVALID')

    // Успешное комбинированное изменение возвращает подтверждённую карточку.
    let d = await desk()
    const revisionsBefore = d.revisions.auth?.length ?? 0
    const response = await patch(auth, {
      assignedGroupName: 'Сеть L2',
      assignedEmployeeLogin: 'auth1',
      stateEnum: 'WorkInProgress',
    })
    assert.equal(response.status, 200)
    const card = await response.json()
    assert.equal(card.id, auth)
    assert.equal(card.assignedGroupName, 'Сеть L2')
    assert.equal(card.assignedEmployee, 'Марат Ветров')
    assert.equal(card.assignedEmployeeLogin, 'auth1')
    assert.equal(card.stateEnum, 'WorkInProgress')
    assert.equal(card.state, 'Выполняется')
    await delay(150)
    d = await desk()
    assert.equal(d.records.auth.team, 'Сеть L2')
    assert.equal(d.records.auth.assignee, 'Марат Ветров')
    assert.equal(d.records.auth.state, 'Выполняется')
    assert.ok(d.revisions.auth.length > revisionsBefore, 'история изменений пополнилась')

    // Повторная публикация того же состояния не дублирует историю и не поднимает версию.
    const versionBefore = d.version,
      revisionsAfterFirst = d.revisions.auth.length
    const repeat = await patch(auth, {
      assignedGroupName: 'Сеть L2',
      assignedEmployeeLogin: 'auth1',
      stateEnum: 'WorkInProgress',
    })
    assert.equal(repeat.status, 200)
    d = await desk()
    assert.equal(d.revisions.auth.length, revisionsAfterFirst)
    assert.equal(d.version, versionBefore)

    // Закрытый инцидент окончателен: смена статуса конфликтует, группа всё ещё меняется.
    const closed = await patch(auth, {stateEnum: 'Closed', solution: 'Работа завершена.'})
    assert.equal(closed.status, 200)
    assert.equal((await closed.json()).stateEnum, 'Closed')
    const reopen = await patch(auth, {stateEnum: 'WorkInProgress'})
    assert.equal(reopen.status, 409)
    assert.equal((await reopen.json()).code, 'INCIDENT_CONFLICT')
    const regroup = await patch(auth, {assignedGroupName: 'Сеть L3'})
    assert.equal(regroup.status, 200)

    // Подтверждённая передача внешней команде закрывает внутреннюю задачу координатора (KAN-32).
    d = await desk()
    const task = d.tasks.find((t) => t.key === 'incident' && t.finished === undefined)
    assert.ok(task, 'у инцидента Координаторов МИ есть открытая задача')
    const handoff = await patch('INC000021940112', {
      assignedGroupName: 'Команда платежей',
      assignedEmployeeLogin: 'pay1',
    })
    assert.equal(handoff.status, 200)
    d = await desk()
    const finished = d.tasks.find((t) => t.key === 'incident')
    assert.ok(finished.finished)
    assert.match(finished.attempts.at(-1).reason, /Команда платежей/)
    assert.equal(d.records.incident.assignee, 'Роман Банников')
  } finally {
    if (server?.listening) await close()
    await rm(dir, {recursive: true, force: true})
  }
})
