import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import {chromium, expect as playwrightExpect} from '@playwright/test'

const variables = [
  'MCC_E2E_ISOLATED', 'MCC_E2E_FRONTEND_URL', 'MCC_E2E_OIDC_AUTHORITY',
  'MCC_E2E_ITSM_URL', 'MCC_E2E_USERNAME', 'MCC_E2E_PASSWORD',
]
const missing = variables.filter(name => !process.env[name])
const sourceId = 'kan73-frontend-e2e'
const listPath = '/api/dashboard/incidents'
const directoryPath = '/api/dashboard/users'
const eventsPath = '/api/dashboard/shift/events'
const eventsQuery = eventsPath + '?sinceEventSeq=0&limit=500'
const expect = playwrightExpect.configure({timeout: 12_000})

function loopbackUrl(name, path = '/') {
  const url = new URL(process.env[name])
  assert(['http:', 'https:'].includes(url.protocol) &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
    !url.username && !url.password && !url.search && !url.hash && url.pathname === path,
  `${name} must be a loopback URL with the exact path ${path}`)
  return url
}

async function json(response, label, expectedStatus = 200) {
  const status = typeof response.status === 'function' ? response.status() : response.status
  assert.equal(status, expectedStatus, label)
  return response.json()
}

function matches(origin, path, method = 'GET') {
  return response => {
    const url = new URL(response.url())
    return url.origin === origin && url.pathname === path && response.request().method() === method
  }
}

test('real browser: Keycloak PKCE, incident queues/card, PATCH to ITSM and exact «Увидел»', {
  skip: missing.length ? `Live e2e not run: missing ${missing.join(', ')}. Use node tests/e2e/run-local.mjs.` : false,
  timeout: 100_000,
}, async t => {
  assert.equal(process.env.MCC_E2E_ISOLATED, '1', 'Mutations require an explicitly isolated, disposable stack')
  const frontend = loopbackUrl('MCC_E2E_FRONTEND_URL').origin
  const authority = loopbackUrl('MCC_E2E_OIDC_AUTHORITY', '/realms/dashboard')
  const itsm = loopbackUrl('MCC_E2E_ITSM_URL').origin
  const username = process.env.MCC_E2E_USERNAME
  const fixture = JSON.parse(await readFile(new URL('itsm-fixture.json', import.meta.url), 'utf8'))
  const [critical, high, research, editable] = fixture
  const mockRequest = (path, options) => fetch(itsm + path, {
    redirect: 'error', signal: AbortSignal.timeout(10_000), ...options,
  })
  const status = await json(await mockRequest('/api/mock/status'), 'ITSM mock status')
  assert.equal(status.sourceId, sourceId, 'Refusing to write outside the dedicated KAN-73 fixture')
  assert.equal(status.deliveredVersion, 0, 'Start with fresh, disposable volumes (no snapshot published)')
  assert.equal(status.pendingVersion, null, 'There must be no pending publication')
  assert.deepEqual(await json(await mockRequest('/itsm_incident'), 'ITSM source rows'), fixture,
    'Refusing to write to an ITSM mock that does not contain exactly the test fixture')

  const browser = await chromium.launch({channel: process.env.MCC_BROWSER_CHANNEL})
  t.after(() => browser.close())
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'})
  page.setDefaultTimeout(12_000)
  const standRequests = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/stand/')) standRequests.push(request.method() + ' ' + url.pathname)
  })
  const unauthenticated = await page.request.get(frontend + '/api/me', {maxRedirects: 0})
  assert.equal(unauthenticated.status(), 401, 'The real backend must require a human bearer token')

  const opening = frontend + '/#queue/critical'
  await page.goto(opening)
  const endpoint = authority.pathname + '/protocol/openid-connect'
  const [authorization] = await Promise.all([
    page.waitForURL(url => url.origin === authority.origin && url.pathname === endpoint + '/auth')
      .then(() => new URL(page.url())),
    page.getByRole('button', {name: 'Войти', exact: true}).click(),
  ])
  const params = authorization.searchParams
  assert.equal(params.get('response_type'), 'code')
  assert.equal(params.get('client_id'), 'dashboard-web')
  assert.equal(params.get('redirect_uri'), frontend + '/auth/callback')
  assert.equal(params.get('code_challenge_method'), 'S256')
  assert.match(params.get('code_challenge') ?? '', /^[A-Za-z0-9_-]{43}$/)
  assert(params.get('state'), 'OIDC authorization must include state')

  await page.locator('#username').fill(username)
  await page.locator('#password').fill(process.env.MCC_E2E_PASSWORD)
  const [tokenResponse, identityResponse] = await Promise.all([
    page.waitForResponse(matches(authority.origin, endpoint + '/token', 'POST')),
    page.waitForResponse(matches(frontend, '/api/me')),
    page.locator('#kc-login').click(),
  ])
  assert.equal(tokenResponse.status(), 200, 'Keycloak must exchange the authorization code')
  const exchange = new URLSearchParams(tokenResponse.request().postData())
  assert.equal(exchange.get('grant_type'), 'authorization_code')
  const verifier = exchange.get('code_verifier')
  assert(verifier && createHash('sha256').update(verifier).digest('base64url') === params.get('code_challenge'),
    'The browser token exchange must present the original PKCE verifier')
  const identity = await json(identityResponse, 'Real backend coordinator identity')
  assert(identity.subject, 'The backend must resolve a coordinator subject')
  assert.equal(identity.username, username)
  const authorizationHeader = await identityResponse.request().headerValue('authorization')
  assert(authorizationHeader?.startsWith('Bearer '), 'The SPA must use its Keycloak access token')
  await expect(page).toHaveURL(opening)

  const readBackend = async path => json(await page.request.get(frontend + path, {
    headers: {Accept: 'application/json', Authorization: authorizationHeader}, maxRedirects: 0,
  }), 'GET ' + path)
  const listQuery = listPath + '?includeCompleted=true&limit=100'
  const before = await readBackend(listQuery)
  assert.equal(before.beforeFirstSuccess, true, 'Refusing to seed an already-published backend')
  assert.deepEqual(before.items, [])
  const emission = await json(await mockRequest('/api/mock/emit', {method: 'POST'}), 'Publish isolated ITSM snapshot')
  assert.equal(emission.deliveredVersion, 1)
  await expect.poll(async () => (await readBackend(listQuery)).beforeFirstSuccess, {
    timeout: 20_000, message: 'Backend must publish the real ITSM snapshot',
  }).toBe(false)

  const queues = [
    ['critical', 'Критические', [critical.id]],
    ['coordinator', 'На координаторах', [critical.id, research.id]],
    ['high', 'Высокий приоритет', [high.id]],
    ['research', 'Исследование ситуации', [research.id]],
  ]
  const snapshot = await readBackend(listQuery)
  assert.deepEqual(snapshot.items.map(item => item.id).sort(), fixture.map(item => item.id).sort())
  assert.deepEqual(Object.fromEntries(snapshot.groups.map(group => [group.key, group.incidentCount])),
    Object.fromEntries(queues.map(([key, , ids]) => [key, ids.length])))
  const sidebar = page.getByRole('navigation', {name: 'Очереди смены'})
  for (const [key, name, ids] of queues) {
    const tile = sidebar.getByRole('link', {name: new RegExp(`\\b${ids.length}\\s*${name}`)})
    await expect(tile).toBeVisible()
    const section = page.getByRole('region', {name, exact: true})
    await expect(section.getByRole('table').getByRole('link', {name: /^INC/})).toHaveCount(ids.length)
    for (const id of ids) {
      assert(snapshot.items.find(item => item.id === id).groupMemberships.some(member => member.group === key))
      await expect(section.getByRole('link', {name: id, exact: true})).toBeVisible()
    }
  }
  for (const [path, method] of [['snapshot', 'GET'], ['action', 'POST']]) {
    const legacy = await page.request.fetch(frontend + '/api/stand/' + path, {
      method, maxRedirects: 0, headers: {Authorization: authorizationHeader},
    })
    assert.equal(legacy.status(), 404, `Legacy /api/stand/${path} must not be published by the gateway`)
  }

  const criticalSection = page.getByRole('region', {name: 'Критические', exact: true})
  const [detailResponse] = await Promise.all([
    page.waitForResponse(matches(frontend, listPath + '/' + critical.id)),
    criticalSection.getByRole('link', {name: critical.id, exact: true}).click(),
  ])
  const detail = await json(detailResponse, 'Browser incident detail')
  assert.equal(detail.id, critical.id)
  assert.equal(detail.service, critical.service)
  assert.equal(detail.serviceType, critical.serviceType)
  assert.equal(detail.deadline, null)
  assert.equal(detail.remainingSeconds, null)
  assert.equal(detail.overdue, false)
  await expect(page.getByRole('heading', {name: critical.header, exact: true})).toBeVisible()
  await expect(page.getByText(critical.service).first()).toBeVisible()
  await expect(page.getByText(/^(?:Срок )?не указан$/i).first()).toBeVisible()
  await expect(page.getByRole('link', {name: /^(Детальнее|Открыть) в ITSM$/}))
    .toHaveAttribute('href', `${itsm}/itsm_incident/${critical.id}/page`)

  const editablePath = listPath + '/' + editable.id
  const [openingResponse, directoryResponse] = await Promise.all([
    page.waitForResponse(matches(frontend, editablePath)),
    page.waitForResponse(matches(frontend, directoryPath)),
    page.goto(frontend + '/#incident/' + editable.id),
  ])
  const editableCard = await json(openingResponse, 'Card to edit')
  assert.equal(editableCard.stateEnum, 'Resolved')
  assert.equal(editableCard.assignedGroupName, editable.assignedGroupName)
  assert((await directoryResponse.request().headerValue('authorization'))?.startsWith('Bearer '),
    'The browser lookup of the ITSM directory must carry bearer auth')
  const directory = await json(directoryResponse, 'Browser GET of the ITSM directory')
  const assignee = directory.find(person => person.login === 'demo2')
  assert.equal(assignee?.displayName, 'Дежурный 3 (demo2)', 'Use demo2 from the real ITSM directory')

  await page.getByRole('link', {name: 'Открыть расследование', exact: true}).click()
  await expect(page).toHaveURL(frontend + '/#investigation/' + editable.id)
  await expect(page.getByRole('heading', {name: 'Разбор инцидента'})).toBeVisible()
  await expect(page.getByText('Данные телеметрии по этому инциденту не получены.', {exact: true})).toBeVisible()
  await page.getByRole('link', {name: /Вернуться в карточку/}).click()
  await expect(page).toHaveURL(frontend + '/#incident/' + editable.id)

  const assignment = page.getByRole('region', {name: 'Официальное назначение'})
  const group = 'KAN-73 · Проверка PATCH'
  await assignment.getByLabel('Исполнитель', {exact: true}).click()
  await page.getByRole('option', {name: assignee.displayName}).click()
  await assignment.getByLabel('Группа назначения').fill(group)
  await assignment.getByLabel('Статус').click()
  await page.getByRole('option', {name: /^(Выполняется|В работе)$/}).click()
  await assignment.getByRole('button', {name: 'Сохранить в ITSM'}).click()
  const confirmation = page.getByRole('dialog', {name: 'Перезаписать назначение?'})
  await expect(confirmation).toContainText(editable.id)
  await expect(confirmation).toContainText(assignee.displayName)
  const [patch] = await Promise.all([
    page.waitForResponse(matches(frontend, editablePath, 'PATCH')),
    confirmation.getByRole('button', {name: 'Перезаписать', exact: true}).click(),
  ])
  assert((await patch.request().headerValue('authorization'))?.startsWith('Bearer '), 'PATCH must carry bearer auth')
  assert.deepEqual(patch.request().postDataJSON(), {
    stateEnum: 'WorkInProgress', assignedGroupName: group, assignedEmployeeLogin: assignee.login,
  })
  const patched = await json(patch, 'PATCH through the real backend')
  assert.equal(patched.id, editable.id)
  assert.equal(patched.stateEnum, 'WorkInProgress')
  assert.equal(patched.assignedGroupName, group)
  assert.equal(patched.assignedEmployeeLogin, assignee.login)
  assert.equal(patched.assignedEmployee, assignee.displayName)
  assert(patched.revision > editableCard.revision)
  await expect(assignment.getByText('Применено', {exact: true})).toBeVisible()

  const [stored, upstream, eventQueue, history] = await Promise.all([
    readBackend(editablePath),
    mockRequest('/itsm_incident/' + editable.sysId).then(response => json(response, 'Persisted ITSM incident')),
    readBackend(eventsQuery),
    readBackend(editablePath + '/history'),
  ])
  for (const row of [stored, upstream]) {
    assert.equal(row.stateEnum, 'WorkInProgress')
    assert.equal(row.assignedGroupName, group)
    assert.equal(row.assignedEmployeeLogin, assignee.login)
    assert.equal(row.assignedEmployee, assignee.displayName)
  }
  assert.equal(history.incidentId, editable.id)
  const record = history.events.find(event => event.changeRevision === patched.revision)
  assert.equal(record?.changeKind, 'UPDATED')
  assert.deepEqual(record.fields.find(field => field.field === 'assignedGroupName'),
    {field: 'assignedGroupName', previous: editable.assignedGroupName, current: group})
  assert.deepEqual(record.fields.find(field => field.field === 'assignedEmployee'),
    {field: 'assignedEmployee', previous: null, current: assignee.displayName})
  const alarms = eventQueue.events.filter(event => event.ackRequired)
  assert.equal(alarms.length, 1, 'Only the test incident should have an unacknowledged alarm')
  const [alarm] = alarms
  assert.equal(alarm.incidentId, editable.id)
  assert(alarm.reasons.includes('critical_reopened'))

  await page.goto(opening)
  const alert = page.getByRole('dialog').filter({hasText: editable.id})
  await expect(alert).toBeVisible()
  const [ack] = await Promise.all([
    page.waitForResponse(matches(frontend, eventsPath + '/ack', 'POST')),
    alert.getByRole('button', {name: 'Увидел', exact: true}).click(),
  ])
  assert.deepEqual(ack.request().postDataJSON(), {eventIds: [alarm.eventId]})
  const acknowledged = await json(ack, 'Backend acknowledgement')
  assert.equal(acknowledged.status, 'acknowledged')
  assert.deepEqual(acknowledged.confirmedEventIds, [alarm.eventId])
  await expect(alert).toBeHidden()
  const remaining = await readBackend(eventsQuery)
  assert(!remaining.events.some(event => event.eventId === alarm.eventId))
  await page.reload()
  await expect(criticalSection.getByRole('link', {name: editable.id, exact: true})).toBeVisible()
  await expect(alert).toBeHidden()
  assert.deepEqual(standRequests, [], 'The real-mode UI must never call /api/stand/*')
})
