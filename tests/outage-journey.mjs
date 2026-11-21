import {enterWorkspace} from './support/browser-login.mjs'
import assert from 'node:assert/strict'
import {expect} from '@playwright/test'
import {writeFile, readFile} from 'node:fs/promises'

export async function outageJourney({
  browser,
  root,
  upstream,
  publish,
  modelRequired = false,
  capture,
  checkpoint = () => {},
}) {
  const contexts = await Promise.all(
    [1440, 1920].map((width) =>
      browser.newContext({viewport: {width, height: width === 1440 ? 900 : 1080}, reducedMotion: 'reduce'}),
    ),
  )
  const [work, wall] = await Promise.all(contexts.map((c) => c.newPage()))
  const errors = [],
    writes = []
  for (const page of [work, wall]) page.on('pageerror', (e) => errors.push(e.message))
  wall.on('request', (r) => {
    if (r.method() !== 'GET' && new URL(r.url()).origin === new URL(root).origin && new URL(r.url()).pathname.startsWith('/api/stand/')) writes.push(r.method() + ' ' + new URL(r.url()).pathname)
  })
  const target = 'INC980000000000',
    sysId = '1980000000000000',
    expectedGroup = 'Дежурные платёжных сервисов'
  let authorization
  const readDesk = async () => {
    const r=await fetch(root + '/api/stand/snapshot?mode=case', {headers:{Authorization:authorization}})
    assert.equal(r.status,200)
    return (await r.json()).desk
  }
  const readOfficial = async () => {
    const r = await fetch(upstream + '/itsm_incident/' + sysId)
    assert.equal(r.status, 200)
    const card = await r.json()
    assert.equal(card.id, target)
    return card
  }
  try {
    const login={username:process.env.MCC_SMOKE_USERNAME, password:process.env.MCC_SMOKE_PASSWORD, provider:process.env.MCC_KEYCLOAK_URL}
    if (!login.username || !login.password) throw Error('Нужна тестовая учетная запись Keycloak для стенда.')
    ;[authorization] = await Promise.all([
      enterWorkspace(work,root + '/?dataset=case#desk/tasks',login),
      enterWorkspace(wall,root + '/?mode=monitor&dataset=case',login),
    ])
    assert.equal(
      Object.keys((await readDesk()).records).length,
      0,
      'Use a new empty coordinator state for this test.',
    )
    assert.notEqual(
      (await readOfficial()).assignedEmployeeLogin,
      'engineer1',
      'Use a fresh ITSM fixture for this test.',
    )
    await expect(wall.getByRole('heading', {name: 'Монитор смены'})).toBeVisible()
    await expect(wall.locator('.ow-count.q-critical strong')).toHaveText('0')
    await work.getByLabel('Дежурный', {exact: true}).click()
    await work.getByRole('option', {name: 'Олег Соколов'}).click()
    await work
      .getByRole('navigation', {name: 'Разделы дашборда'})
      .getByRole('link', {name: 'Сводка', exact: true})
      .click()
    await publish()
    const dialog = work.getByRole('dialog')
    await expect(dialog.locator('.signal-item')).toHaveCount(2, {timeout: 15000})
    await expect(dialog.getByText(/Критических сигналов: 100/)).toBeVisible()
    await expect(wall.locator('.ow-rows article')).toHaveCount(2)
    const groupOnWall = wall.locator('.ow-row').filter({hasText: '100 INC'})
    await expect(groupOnWall).toContainText('11 сервисов')
    await expect(groupOnWall).toContainText('Никто не взял')
    await expect(wall.getByRole('dialog')).toHaveCount(0)
    await dialog.getByRole('button', {name: 'Увидел (101)', exact: true}).click()
    await expect(dialog).toBeHidden()
    await expect(groupOnWall).toContainText('Никто не взял')
    checkpoint('101 new INC → two situations; read-only wall still shows no owner after acknowledgement')
    if (modelRequired) {
      await expect
        .poll(async () => (await readDesk()).outageGroups.find((g) => g.members.length === 100)?.method, {
          timeout: 115000,
          intervals: [1000],
        })
        .toBe('model')
      checkpoint('Ollama confirmed the 100-INC group across eleven services')
    }
    const list = work.getByRole('region', {name: 'Ситуации смены'})
    const row = list.locator('.ag-list > li').filter({hasText: '100 INC'})
    await row.locator('.ag-title').click()
    const details = work.getByRole('region', {name: 'Карточка группы'})
    const members = work.getByRole('region', {name: 'Управление составом'})
    await details.getByRole('button', {name: 'Взять в работу'}).click()
    await expect(groupOnWall).toContainText('Ведёт Олег Соколов', {timeout: 6000})
    const outage = (await readDesk()).outageGroups.find((g) => g.members.length === 100)
    assert.equal(outage.owner, 'oleg')
    if (capture) await wall.screenshot({path: capture, animations: 'disabled'})
    const other = 'INC980000000001'
    await members.getByRole('checkbox', {name: 'Выбрать ' + other, exact: true}).check()
    await members.getByRole('button', {name: /Исключить выбранные/}).click()
    await expect(members.getByRole('heading')).toContainText('99 INC')
    await expect(wall.locator('.ow-rows article')).toHaveCount(3)
    await members.getByRole('button', {name: 'Добавить INC', exact: true}).click()
    await members.getByLabel('Найти активный INC вне группы').fill(other)
    await members.getByRole('checkbox', {name: 'Выбрать ' + other, exact: true}).check()
    await members.getByRole('button', {name: /Добавить выбранные/}).click()
    await expect(members.getByRole('heading')).toContainText('100 INC')
    await expect(groupOnWall).toContainText('Ведёт Олег Соколов')
    await work.reload()
    await expect(members.getByRole('heading')).toContainText('100 INC')
    await members.getByLabel('Найти в составе').fill(target)
    await members.getByRole('link', {name: 'Изменить в ITSM'}).click()
    await work.getByLabel('Группа назначения', {exact: true}).fill(expectedGroup)
    await work.getByLabel('Исполнитель ITSM', {exact: true}).click()
    await work.getByRole('option', {name: /Инженер 2/}).click()
    await work.getByRole('button', {name: 'Сохранить в ITSM', exact: true}).click()
    await expect(work.getByText(/ITSM подтвердила изменение/)).toBeVisible()
    const official = await readOfficial()
    assert.equal(official.assignedEmployeeLogin, 'engineer1')
    assert.equal(official.assignedGroupName, expectedGroup)
    const result = await readDesk()
    assert.equal(result.records[target].team, official.assignedGroupName)
    assert.equal(result.records[target].assignee, official.assignedEmployee)
    assert.equal(result.outageGroups.find((g) => g.id === outage.id).owner, 'oleg')
    await expect(groupOnWall).toContainText('Ведёт Олег Соколов')
    await wall.reload()
    await expect(groupOnWall).toContainText('Ведёт Олег Соколов')
    assert(
      await wall.evaluate(
        () =>
          document.documentElement.scrollHeight <= innerHeight + 1 &&
          document.documentElement.scrollWidth <= innerWidth,
      ),
    )
    assert.deepEqual(writes, [])
    assert.deepEqual(errors, [])
    return {
      group: outage.id,
      method: outage.method,
      evidence: outage.evidence,
      member: target,
      officialLogin: official.assignedEmployeeLogin,
      officialGroup: official.assignedGroupName,
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
}

if (import.meta.main) {
  const {chromium} = await import('@playwright/test')
  const {
    MCC_VERIFY_FRONT: root,
    MCC_ITSM_URL: upstream,
    MCC_VERIFY_FIXTURE: fixture,
    MCC_SOURCE_FILE: source,
  } = process.env
  if (
    ![root, upstream].every(
      (url) => url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
    ) ||
    !fixture ||
    !source ||
    source === fixture
  )
    throw Error('Укажите два изолированных локальных сервиса, демофикстуру и отдельный пустой входной файл.')
  const raw = await readFile(fixture, 'utf8')
  assert.equal(JSON.parse(raw).length, 101)
  assert.deepEqual(JSON.parse(await readFile(source, 'utf8')), [])
  const browser = await chromium.launch(
    process.env.MCC_BROWSER_CHANNEL ? {channel: process.env.MCC_BROWSER_CHANNEL} : {},
  )
  try {
    console.log(
      await outageJourney({
        browser,
        root,
        upstream,
        modelRequired: true,
        publish: () => writeFile(source, raw),
        capture: process.env.MCC_MONITOR_SCREENSHOT,
        checkpoint: console.log,
      }),
    )
  } finally {
    await browser.close()
  }
}
