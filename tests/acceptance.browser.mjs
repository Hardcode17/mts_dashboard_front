import {identityFixture} from './support/identity.mjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium, expect} from '@playwright/test'
import serve from 'serve-handler'
import {mockService} from '../mock/server.ts'
import {checkExpandedAgentForm} from './agent-form-smoke.mjs'

const fixture = JSON.parse(
  await readFile(new URL('../mock/fixtures/incidents.json', import.meta.url), 'utf8'),
)
async function stand(t, rows = fixture) {
  const identity = await identityFixture(t)
  const dir = await mkdtemp(join(tmpdir(), 'mcc-browser-')),
    file = join(dir, 'source.json')
  await writeFile(file, JSON.stringify(rows))
  const api = mockService(dir, file, undefined, identity.settings)
  const server = createServer((req, res) =>
    api.handle(req, res, () =>
      serve(req, res, {public: process.env.MCC_BROWSER_DIST || 'dist', rewrites: [{source: '**', destination: '/index.html'}]}),
    ),
  )
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const root = 'http://127.0.0.1:' + server.address().port
  const browser = await chromium.launch({
    channel:
      process.env.MCC_BROWSER_CHANNEL ||
      (existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined),
  })
  const errors = []
  t.after(async () => {
    await browser.close()
    await new Promise((done) => server.close(done))
    api.close()
    await rm(dir, {recursive: true, force: true})
    assert.deepEqual(errors, [])
  })
  async function open(mode = 'volume', person = 'anna', width = 1440) {
    const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: 'reduce'})
    await context.addInitScript(
      ([source, id]) => {
        localStorage.setItem('mcc-source', source)
        localStorage.setItem('mcc-person', id)
      },
      [mode, person],
    )
    const p = await context.newPage()
    p.on('pageerror', (e) => errors.push(e.message))
    p.setDefaultTimeout(6000)
    await p.goto(root)
    await expect(p.getByRole('heading', {name: 'Сводка смены'})).toBeVisible()
    return p
  }
  return {
    open,
    file,
    root,
    request: identity.request,
    read: async (mode) => (await (await identity.request(root + '/api/stand/snapshot?mode=' + mode)).json()).desk,
  }
}
async function setTheme(page, theme) {
  const toggle = page.getByRole('switch', {name: 'Тёмная тема'})
  const checked = String(theme === 'dark')
  if (await toggle.getAttribute('aria-checked') !== checked) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', checked)
}

test('acceptance: file polling, critical burst, resolution, external card, revisions and stale input', async (t) => {
  const {open, file, root, read} = await stand(t),
    p = await open('case')
  const counts = p.locator('.overview-stat')
  await expect(counts).toHaveCount(4)
  await expect(counts.first()).toBeVisible()
  const digits = async () =>
    counts.locator('.queue-total').evaluateAll((list) => list.map((e) => Number(e.textContent.replace(/[^\d]/g, ''))))
  assert.deepEqual(await digits(), [0, 2, 1, 5])
  const row = fixture.find(
    (i) =>
      i.stateEnum === 'WorkInProgress' && i.assignedGroupName !== 'КЦ ИТ Координаторы Массовых Инцидентов',
  )
  const updates = structuredClone(fixture),
    change = updates.find((i) => i.id === row.id)
  Object.assign(change, {
    priorityId: 4,
    assignedGroupName: 'КЦ ИТ Координаторы Массовых Инцидентов',
    deadline: new Date(Date.now() + 3600000).toISOString(),
  })
  const start = Date.now()
  await writeFile(file, JSON.stringify(updates))
  const dlg = p.getByRole('dialog')
  await expect(dlg.getByText(row.id, {exact: true})).toBeVisible({timeout: 5000})
  assert(Date.now() - start <= 5000)
  await p.setViewportSize({width: 320, height: 740})
  const screen = p.locator('.signal-screen')
  await expect(screen).toBeVisible()
  assert(await screen.evaluate(el => el.scrollWidth <= el.clientWidth + 1))
  const frozen = (await read('case')).signals[0].id
  const presenter = await open('case')
  await presenter.goto(root + '/#stand')
  await presenter.getByRole('button', {name: 'Демо: новый крит'}).click()
  await expect(dlg.getByText(/Поступило ещё/)).toBeVisible()
  await dlg.getByRole('button', {name: 'Увидел', exact: true}).click()
  await expect(dlg).toBeHidden()
  const current = await read('case')
  assert(current.signals.find((s) => s.id === frozen).acknowledged)
  assert.equal(current.signals.filter((s) => !s.acknowledged).length, 1)
  await p.getByRole('button', {name: 'Посмотреть', exact: true}).click()
  await p.getByRole('dialog').getByRole('button', {name: 'Увидел', exact: true}).click()
  await expect(dlg).toBeHidden()
  await p.goto(root + '/incidents/' + row.id + '?source=case')
  await p.getByRole('tab', {name: 'Хронология'}).click()
  await p.getByText('Сравнить версии карточки').click()
  await expect(p.locator('.chronology-compare .chronology-values')).toContainText('Группа назначения')
  await expect(p.locator('.chronology-compare .chronology-values')).toContainText('Стало')
  await p.getByRole('link', {name: 'Изменить в ITSM'}).click()
  await expect(p.getByRole('heading', {name: 'ITSM · карточка ' + row.id})).toBeVisible()
  Object.assign(change, {stateEnum: 'Research', completionDate: new Date().toISOString()})
  await writeFile(file, JSON.stringify(updates))
  await expect.poll(async () => (await read('case')).records[row.id].research).toBe(true)
  await p.goto(root + '/#overview')
  await expect(p.locator('.change-strip')).toContainText('Сбой устранён')
  const before = (await read('case')).signals.length
  await writeFile(file, '[')
  await expect(p.getByText('Устаревшие данные', {exact: true})).toBeVisible()
  await writeFile(file, JSON.stringify(updates))
  await expect(p.getByText('Устаревшие данные', {exact: true})).toBeHidden()
  await expect(p.getByRole('group', {name: 'Состояние данных'})).toContainText('Снимок ITSM')
  assert.equal((await read('case')).signals.length, before)
})
test(
  'acceptance: personal timer runs with browser closed, an old notification cannot take a reassigned task',
  {timeout: 90000},
  async (t) => {
    const {open, file, root, read} = await stand(t, [])
    let p = await open('case')
    const row = {
      ...fixture[0],
      id: 'INC777',
      priorityId: 4,
      deadline: new Date(Date.now() + 7200000).toISOString(),
    }
    await writeFile(file, JSON.stringify([row]))
    const dlg = p.getByRole('dialog')
    await expect(dlg).toBeVisible()
    await dlg.getByRole('button', {name: 'Увидел', exact: true}).click()
    const original = (await read('case')).tasks[0].attempts[0]
    assert.equal(original.person, 'anna')
    assert(!original.accepted)
    await p.context().close()
    await expect
      .poll(async () => (await read('case')).tasks[0].attempts.length, {timeout: 66000, intervals: [1500]})
      .toBe(2)
    p = await open('case', 'anna')
    await p.goto(root + '/#desk/notifications')
    await expect(p.getByText('Назначение устарело', {exact: true}).first()).toBeVisible()
    await expect(p.getByRole('button', {name: 'Принять назначение'})).toHaveCount(0)
    const o = await open('case', 'oleg')
    await o.goto(root + '/#desk/tasks')
    await o.getByRole('button', {name: 'Принять в работу'}).click()
    await o.getByRole('link',{name:'INC777',exact:true}).first().click()
    await o.getByRole('link',{name:'Кому передать',exact:true}).click()
    await o.getByLabel('Предлагаемая команда').fill('Платежи L1 · Москва')
    await o.getByLabel('Комментарий координатора').fill('Проверить входящий запрос')
    await o.getByRole('button',{name:'Согласовать рекомендацию'}).click()
    await expect.poll(async () => (await read('case')).work.INC777.recommendedTeam).toBe('Платежи L1 · Москва')
    await o.goto(root + '/#desk/tasks')
    await expect(o.getByLabel('Команда решения INC777')).toHaveValue('Платежи L1 · Москва')
    await o.getByLabel('Команда решения INC777').fill('Платежи L2')
    await o.getByRole('button', {name: 'Передать исполнителю'}).click()
    await expect.poll(async () => (await read('case')).records.INC777.team).toBe('Платежи L2')
    await expect(o.getByRole('status').filter({hasText:'Назначение на стенде'})).toContainText('Платежи L2')
    const task = (await read('case')).tasks[0]
    assert(task.finished)
    assert.equal(task.attempts[0].reason, 'Нет реакции')
    assert(task.attempts[1].accepted)
  },
)
test('acceptance: similar incidents, staffing estimate, operator decision, notes, room, dispatch and retry', async (t) => {
  const {root, open, read} = await stand(t)
  const p = await open()
  await p.goto(root + '/#desk/source')
  await p.getByRole('button', {name: /Сценарий Wi-Fi/}).click()
  const dlg = p.getByRole('dialog')
  await expect(dlg).toBeVisible()
  await dlg.getByRole('button', {name: 'Увидел'}).click()
  await expect(dlg).toBeHidden()
  await p.goto(root + '/#incident/wifi-rostov?section=related')
  await p.getByRole('button', {name: 'Подтвердить связь'}).first().click()
  await expect.poll(async () => (await read('volume')).work['wifi-msk'].links).toContain('wifi-rostov')
  await p.goto(root + '/#stand?incident=wifi-rostov')
  await p.getByText('Доступность команды решения',{exact:true}).click()
  await p.getByLabel('Доступность по графику стенда').click()
  await p.getByRole('option', {name: 'Двое свободны, третий через час'}).click()
  await expect.poll(async () => (await read('volume')).work['wifi-rostov'].availability).toBe('wait')
  await p.goto(root + '/#incident/wifi-rostov?section=routing')
  await expect(p.getByText(/240 мин до восстановления/)).toBeVisible()
  await p.getByRole('button', {name: 'Согласовать рекомендацию'}).click()
  await expect.poll(async () => (await read('volume')).work['wifi-rostov'].recommendation).toContain('Ростов')
  await p.getByRole('link',{name:'Заметки и действия',exact:true}).click()
  await p.getByLabel('Текст записи').fill('Проверить маршрут контроллера')
  await p.getByRole('button', {name: 'Добавить запись'}).click()
  await p.getByRole('link',{name:'Передача смены',exact:true}).click()
  await p.getByRole('button', {name: 'Сохранить сводку смены'}).click()
  await p.getByRole('button', {name: 'Подготовить черновик разбора'}).click()
  await p.goto(root + '/#stand/room/wifi-rostov')
  await p.getByRole('button', {name: 'Создать демовстречу'}).click()
  await p.getByRole('button', {name: 'Завершить демовстречу'}).click()
  await expect(p.getByRole('heading', {name: 'Сводка по транскрипту'})).toBeVisible()
  await p
    .getByRole('button', {name: /К фрагменту/})
    .first()
    .click()
  await p.goto(root + '/#meeting/wifi-rostov')
  await expect(p.getByRole('heading',{name:'Сводка по транскрипту'})).toBeVisible()
  await expect(p.getByRole('button',{name:'Завершить демовстречу'})).toHaveCount(0)
  await p.goto(root + '/#stand')
  await p.getByText('Имитировать ошибку доставки').click()
  await p.locator('details').getByRole('checkbox', {name: 'SMS', exact: true}).click()
  await expect(p.locator('details').getByRole('checkbox', {name: 'SMS', exact: true})).toBeChecked()
  await p.goto(root + '/#incident/wifi-rostov?section=notify')
  await p.getByLabel('Текст сообщения').fill('Проверка каналов стенда')
  await p.getByRole('button', {name: 'Отправить на стенде'}).click()
  await expect
    .poll(
      async () => (await read('volume')).notices.filter((n) => n.text === 'Проверка каналов стенда').length,
    )
    .toBe(9)
  await p.getByRole('link', {name: 'Проверить доставку'}).click()
  const bad = p
    .locator('.desk-list li')
    .filter({hasText: 'Проверка каналов стенда'})
    .filter({hasText: 'Ошибка'})
  await expect(bad).toHaveCount(1)
  const noticesUrl = p.url()
  await p.goto(root + '/#stand')
  await p.getByText('Имитировать ошибку доставки').click()
  await p.locator('details').getByRole('checkbox', {name: 'SMS', exact: true}).click()
  await expect(p.locator('details').getByRole('checkbox', {name: 'SMS', exact: true})).not.toBeChecked()
  await p.goto(noticesUrl)
  await bad.getByRole('button', {name: 'Повторить доставку'}).click()
  await expect(bad).toHaveCount(0)
  const messages = (await read('volume')).notices.filter((n) => n.text === 'Проверка каналов стенда')
  assert.equal(messages.find((n) => n.channel === 'SMS').tries, 2)
  assert(messages.filter((n) => n.channel !== 'SMS').every((n) => n.tries === 1))
})
test('acceptance: queue filters, responsive layouts, analysis sources, telemetry loss and recovery experiment', async (t) => {
  const {open, root, read} = await stand(t),
    p = await open('volume', 'anna', 390)
  await setTheme(p, 'dark')
  await p.goto(root + '/#queue/all')
  await p.getByLabel('Поиск по всем инцидентам').fill('INC000021940112')
  await p.locator('.overview-table-scroll a').first().click()
  await expect(p.getByRole('region', {name: 'Быстрый просмотр инцидента'})).toBeVisible()
  await p.getByRole('link', {name: 'Полная карточка'}).click()
  await p.getByRole('button', {name: 'Запустить разбор ИИ'}).or(p.getByRole('link',{name:'Открыть разбор ИИ'})).click()
  await expect(p.getByText(/Фоновая сверка занимает большую часть пула/)).toBeVisible()
  await p.goto(root + '/#stand/agent/incident')
  await p.getByText('Ожидание БД', {exact: true}).click()
  await p.getByRole('option', {name: 'Насыщение обработчиков'}).click()
  await p.getByRole('button', {name: 'Сохранить условия проверки'}).click()
  await p.getByRole('link',{name:'К разбору ИИ'}).click()
  await p.getByRole('button', {name: 'Повторить разбор'}).click()
  await expect(p.getByText(/Обработчики платежей насыщены/).first()).toBeVisible()
  await p.getByText('Проверить на стенде',{exact:true}).click()
  await p.getByLabel('Уникальных заказов в минуту').fill('30')
  await p.getByRole('button', {name: 'Запустить демопрогон'}).click()
  await expect
    .poll(async () => (await read('volume')).work.incident.reports[0].title)
    .toBe('Эксперимент восстановления')
  await p.goto(root + '/#stand/agent/incident')
  await p.getByRole('checkbox', {name: 'Источник телеметрии недоступен'}).check()
  await p.getByRole('button', {name: 'Сохранить условия проверки'}).click()
  await p.getByRole('link',{name:'К разбору ИИ'}).click()
  await p.getByRole('button', {name: 'Повторить разбор'}).click()
  await expect(p.locator('.agent-run-decision').getByText('Свежие наблюдения недоступны', {exact: true})).toBeVisible()
  for (const width of [390, 1024, 1280, 1440, 1920]) {
    await p.setViewportSize({width, height: 900})
    await p.goto(root + '/#overview')
    await expect(p.getByRole('heading', {name: 'Сводка смены'})).toBeVisible()
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
})

test('saved queue, failed import and pinned agent evidence survive navigation and reload', async (t) => {
  const {open, root, read} = await stand(t)
  const p = await open()
  await p.goto(root + '/#queue/all?q=МТС')
  await p.getByText('Фильтры и сохранённые представления').click()
  await p.getByRole('textbox', {name: 'Название представления'}).fill('Мои продукты')
  await p.getByRole('button', {name: 'Сохранить представление'}).click()
  await expect(p.getByRole('link', {name: 'Мои продукты'})).toBeVisible()
  await p.reload()
  await p.getByText('Фильтры и сохранённые представления').click()
  await p.getByRole('link', {name: 'Мои продукты'}).click()
  await expect(p.getByLabel('Поиск по всем инцидентам')).toHaveValue('МТС')
  await p.goto(root + '/incidents/INC000021940112?source=volume')
  await p.getByRole('button', {name: 'Запустить разбор ИИ'}).or(p.getByRole('link',{name:'Открыть разбор ИИ'})).click()
  await p.getByText('Основание и исходные записи',{exact:true}).click()
  await p.getByRole('link', {name: 'Открыть наблюдение'}).first().click()
  await p.reload()
  await expect(p.getByRole('heading', {name: 'ITSM', exact: true})).toBeVisible()
  await expect(p.getByText(/запуск №/)).toBeVisible()
  const pinned = p.url()
  const c = await open('case')
  await c.goto(pinned)
  await expect(c.getByRole('heading', {name: 'ITSM', exact: true})).toBeVisible()
  await expect(c.getByRole('group', {name: 'Состояние данных'})).toContainText('Данные демосмены')
  await c.getByRole('link', {name: /К сохранённому разбору/}).click()
  await expect(c).toHaveURL(/#investigation\/incident\?run=/)
  await c.goto(root + '/incidents/' + fixture[0].id + '?source=case')
  await c.goto(root + '/#desk/source')
  await c.getByLabel('JSON снимка').fill('[{"id":"INC1"}]')
  await c.getByRole('button', {name: 'Применить снимок'}).click()
  await expect(c.getByRole('alert')).toContainText('Строка 1')
  assert.equal(Object.keys((await read('case')).records).length, 44)
})

test('shift panels keep their spacing on a direct visit and fit a narrow screen in both themes', async t => {
  const {open, root} = await stand(t)
  const page = await open()
  await page.goto(root + '/#desk/tasks')
  await page.reload()
  const panel = page.locator('.shift-queue')
  await expect(panel).toBeVisible()
  const layout = () => panel.evaluate(el => {
    const style = getComputedStyle(el)
    return {padding: parseFloat(style.paddingLeft), display: style.display, fill: style.backgroundImage}
  })
  const direct = await layout()
  assert(direct.padding > 0)
  assert.equal(direct.display, 'flex')
  assert.equal(direct.fill, 'none')
  await page.goto(root + '/#incident/incident')
  await expect(page.getByRole('button',{name:'Запустить разбор ИИ'}).or(page.getByRole('link',{name:'Открыть разбор ИИ'}))).toBeVisible()
  await page.goto(root + '/#desk/tasks')
  assert.deepEqual(await layout(), direct)

  await page.getByRole('radio', {name:/В очереди/}).check()
  await expect(page.locator('.shift-task-list > li').first()).toBeVisible()
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme)
    await page.setViewportSize({width:320, height:850})
    for (const [route, selector] of [['desk/tasks','.shift-queue'], ['desk/notifications','.shift-notifications'], ['desk/source','.desk-grid'], ['queue/all','.overview-table-panel'], ['overview','.overview-summary']]) {
      await page.goto(root + '/#' + route)
      await expect(page.locator(selector).first()).toBeVisible()
      const actual = await page.evaluate(() => ({
        overflows: document.documentElement.scrollWidth > innerWidth,
        gradients: [...document.querySelectorAll('.mcc-glass')].some(el => getComputedStyle(el).backgroundImage.includes('gradient')),
      }))
      assert.deepEqual(actual, {overflows:false, gradients:false}, theme+' '+route)
    }
  }
})

test('acknowledging a second incident preserves the first incident and its unsaved work', async t => {
  const {open, root} = await stand(t)
  const page = await open()
  const peer = await open('volume', 'oleg')
  await page.goto(root + '/#incident/incident?tab=work')
  const draft = page.getByLabel('Текст записи')
  await draft.fill('Проверить задержку в пуле БД')
  await peer.goto(root + '/#stand')
  await peer.getByRole('button', {name: 'Демо: новый крит'}).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const interruptedId = await dialog.locator('.signal-item').first().locator('h3').textContent()
  await peer.getByRole('button', {name: 'Демо: новый крит'}).click()
  await expect(dialog.getByText(/Поступило ещё/)).toBeVisible()
  await dialog.getByRole('button', {name: 'Увидел', exact: true}).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/#incident\/incident\?tab=work$/)
  await expect(draft).toHaveValue('Проверить задержку в пуле БД')
  const goToNew = page.getByRole('link', {name: interruptedId, exact: false}).first()
  const [nextIncident] = await Promise.all([page.context().waitForEvent('page'), goToNew.click()])
  await expect(nextIncident.getByRole('heading', {name: interruptedId, exact: true})).toBeVisible()
  await nextIncident.close()
  await expect(draft).toHaveValue('Проверить задержку в пуле БД')
  await page.getByRole('button', {name: 'Посмотреть', exact: true}).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', {name: 'Увидел', exact: true}).click()
  await expect(draft).toHaveValue('Проверить задержку в пуле БД')
})

test('refreshing a full card preserves the route back to its filtered queue', async t => {
  const {open, root} = await stand(t)
  const page = await open()
  const listing = '#queue/all?q=INC000021940112'
  await page.goto(root + '/' + listing)
  await page.getByRole('link', {name: 'INC000021940112', exact: true}).click()
  await page.getByRole('link', {name: 'Полная карточка'}).click()
  await page.reload()
  await expect(page.locator('main a').filter({hasText: /←/}).first()).toHaveAttribute('href', listing)
})

test('acceptance: official reassignment uses the directory, confirms the overwrite and rolls back on rejection', async (t) => {
  const {open, root, read, request} = await stand(t)
  const p = await open('volume', 'anna')
  const id = 'INC000021940087'
  await p.goto(root + '/#incident/access')
  await expect(p.getByRole('heading', {name: /Ошибка входа в профиль/})).toBeVisible()
  await p.getByRole('link', {name: /Изменить в ITSM/}).click()
  // Исполнитель выбирается из справочника бэкенда, группа и статус меняются вместе.
  await p.getByLabel('Исполнитель').click()
  await p.getByRole('option', {name: /Марат Ветров/}).click()
  await p.getByLabel('Группа назначения').fill('Сеть L2')
  await p.getByLabel('Статус').click()
  await p.getByRole('option', {name: 'Выполняется'}).click()
  // Перезапись существующего назначения требует явного подтверждения.
  await p.getByRole('button', {name: 'Сохранить в ITSM'}).click()
  const confirm = p.getByRole('dialog', {name: 'Перезаписать назначение?'})
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', {name: 'Перезаписать'}).click()
  await expect(p.getByText('Применено', {exact: true})).toBeVisible()
  // Карточка и группы отражают подтверждённый ответ сервера.
  await expect
    .poll(async () => {
      const record = (await read('volume')).records.access
      return record.team + '|' + record.assignee + '|' + record.state
    })
    .toBe('Сеть L2|Марат Ветров|Выполняется')
  await expect(p.getByRole('region', {name: 'Официальное назначение'})).toContainText('Марат Ветров')
  // Повторная публикация того же состояния не дублирует запись истории.
  const history = (await read('volume')).revisions.access.length
  const repeat = await request(root + '/api/dashboard/incidents/' + id, {
    method: 'PATCH',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      assignedGroupName: 'Сеть L2',
      assignedEmployeeLogin: 'auth1',
      stateEnum: 'WorkInProgress',
    }),
  })
  assert.equal(repeat.status, 200)
  assert.equal((await read('volume')).revisions.access.length, history)
  // Завершающий статус требует текст решения и фиксирует его в карточке.
  await p.getByLabel('Статус').click()
  await p.getByRole('option', {name: 'Закрыт'}).click()
  await p.getByLabel('Описание решения').fill('Работа над INC завершена на стенде.')
  await p.getByRole('button', {name: 'Сохранить в ITSM'}).click()
  await expect
    .poll(async () => (await read('volume')).records.access.state)
    .toBe('Закрыт')
  // Отказ сервера виден с причиной, показ откатывается к подтверждённому состоянию,
  // а введённые значения остаются в форме для исправления.
  await p.getByLabel('Статус').click()
  await p.getByRole('option', {name: 'Выполняется'}).click()
  await p.getByRole('button', {name: 'Сохранить в ITSM'}).click()
  await expect(p.getByRole('alert')).toContainText('INCIDENT_CONFLICT')
  await expect(p.getByRole('alert')).toContainText('исправьте значения')
  await expect
    .poll(async () => (await read('volume')).records.access.state)
    .toBe('Закрыт')
  await expect(p.getByText('Закрыт', {exact: true}).first()).toBeVisible()
  await expect(p.getByLabel('Статус')).toContainText('Выполняется')
})

test('expanded agent diagnostics keep labels, checkboxes and the submit action visibly separated', async t => {
  const {open, root} = await stand(t)
  const p = await open()
  for (const [key, width, theme] of [['incident', 1440, 'light'], ['access', 320, 'dark']]) {
    await p.setViewportSize({width, height: 900})
    await p.goto(root + '/#stand/agent/' + key)
    await setTheme(p, theme)
    const form = p.locator('.agent-diagnostics form')
    await expect(form).toBeVisible()
    const interval = form.getByRole('spinbutton', {name: 'Ожидаемый интервал, мин'})
    const age = form.getByRole('spinbutton', {name: 'Возраст записи, мин'})
    const save = form.getByRole('button', {name: 'Сохранить условия проверки'})
    await checkExpandedAgentForm(form, width)
    await form.getByLabel('Таблица или индекс продукта').fill('analytics_' + 'trace'.repeat(30))
    await interval.fill('7')
    await age.fill('12')
    await save.click()
    await expect(form.getByRole('status')).toContainText('Последнее сохранение')
    await p.getByRole('link',{name:'К разбору ИИ'}).click()
    await expect(form).toHaveCount(0)
    await p.getByRole('button',{name:/Запустить разбор ИИ|Повторить разбор/}).click()
    await expect(p.locator('.agent-run-decision')).toBeVisible()
    assert(await p.evaluate(() => document.documentElement.scrollWidth === innerWidth))
  }
})

test('one board keeps four pages independent and shows 479 with 300 entries and 300 exits', async t => {
  const row = (number, priorityId, assignedGroupName = 'Платежи') => ({
    ...fixture[0], id: 'INC' + number, productName: 'МТС Маркет', header: 'Проверка оплаты ' + number, stateEnum: 'WorkInProgress',
    completionDate: null, deadline: null, priorityId, assignedGroupName,
  })
  const critical = Array.from({length:479}, (_,i) => row(10000+i,4))
  const high = Array.from({length:24}, (_,i) => row(20000+i,3))
  const assigned = Array.from({length:15}, (_,i) => row(30000+i,2,'КЦ ИТ Координаторы Массовых Инцидентов'))
  const baseline = [...critical,...high,...assigned]
  const {open,root,file,read} = await stand(t, baseline)
  const p = await open('case')
  const queueMenu = p.getByRole('navigation', {name:'Разделы дашборда'}).getByRole('link',{name:'Очереди'})
  const originalSection = await p.locator('#section-critical').elementHandle()
  await queueMenu.click()
  await expect(p).toHaveURL(/#overview\?section=critical(?:&|$)/)
  assert(await originalSection.evaluate(el => el === document.getElementById('section-critical')))
  await expect(p.locator('#section-critical')).toBeFocused()
  await expect(p.getByRole('heading',{name:'Сводка смены'})).toBeVisible()
  const nav = p.getByRole('navigation',{name:'Очереди смены'})
  const criticalSection = p.locator('#section-critical')
  const highSection = p.locator('#section-high')
  await expect(p.locator('.overview-section-stack > section')).toHaveCount(4)
  await expect(criticalSection.getByText('479',{exact:true})).toBeVisible()
  await expect(criticalSection.getByText('Добавилось 0',{exact:true})).toBeVisible()
  await criticalSection.getByTitle('Следующая').click()
  await nav.getByRole('link',{name:/Высокий приоритет/}).click()
  await expect.poll(() => highSection.evaluate(e=>Math.abs(e.getBoundingClientRect().top - document.querySelector('.cr-top').getBoundingClientRect().bottom))).toBeLessThan(40)
  await highSection.getByTitle('Следующая').click()
  await highSection.getByTitle('Следующая').click()
  await expect(highSection.locator('.overview-table-footer')).toContainText('11–15')
  const fromTable = highSection.locator('.incident-number').first()
  await fromTable.scrollIntoViewIfNeeded()
  const readingY = await p.evaluate(()=>scrollY)
  await fromTable.click()
  await p.getByRole('link',{name:'Полная карточка'}).click()
  await p.getByRole('link',{name:'← К очереди'}).click()
  await expect.poll(()=>p.evaluate(y=>Math.abs(scrollY-y),readingY)).toBeLessThan(5)
  await expect(highSection.locator('.overview-table-footer')).toContainText('11–15')
  await nav.getByRole('link',{name:/Критические/}).click()
  await expect(criticalSection.locator('.overview-table-footer')).toContainText('6–10')
  await expect(highSection.locator('.overview-table-footer')).toContainText('11–15')
  const pinned = await criticalSection.locator('.incident-number').allTextContents()
  const wallPage = await open('case')
  await wallPage.goto(root+'/#wall')
  const wallTile=wallPage.locator('.ow-count.q-critical')
  await expect(wallTile.locator('strong')).toHaveText('479')
  await expect(wallPage.locator('.ops-rail')).toHaveCount(0)
  const additions = Array.from({length:300}, (_,i)=>row(40000+i,4))
  const dialog = p.getByRole('dialog')
  const started = Date.now()
  for (let replaced = 50; replaced <= 300; replaced += 50) {
    const updates = [
      ...baseline.map((item, i) => i < replaced ? {...item, stateEnum:'Resolved', completionDate:new Date(started).toISOString()} : item),
      ...additions.slice(0, replaced),
    ]
    await writeFile(file, JSON.stringify(updates))
    await expect(dialog.getByText('Критические сейчас: 479')).toBeVisible({timeout:8000})
    await expect(dialog.getByText('Добавилось ' + replaced, {exact:true})).toBeVisible()
    await expect(dialog.getByText('Выбыло ' + replaced, {exact:true})).toBeVisible()
  }
  assert(Date.now() - started < 60000)
  await expect(dialog.getByText('Выбыло 300',{exact:true})).toBeVisible()
  await dialog.getByRole('button',{name:'Увидел (5)'}).click()
  await expect(dialog).toBeHidden()
  const tile = nav.getByRole('link',{name:/Критические/})
  await expect(tile.locator('.overview-nav-count')).toHaveText('479')
  await expect(tile.getByText('Добавилось 300',{exact:true})).toBeVisible()
  await expect(tile.getByText('Выбыло 300',{exact:true})).toBeVisible()
  if (process.env.MCC_QUEUE_SCREENSHOT) {
    await criticalSection.evaluate(el => el.scrollIntoView({block:'start'}))
    await p.screenshot({path:process.env.MCC_QUEUE_SCREENSHOT})
  }
  assert.deepEqual(await criticalSection.locator('.incident-number').allTextContents(),pinned)
  await expect(criticalSection.locator('.queue-latest')).toContainText('Новый INC')
  await expect(criticalSection.locator('.queue-latest')).toContainText('Сбой устранён')
  await criticalSection.getByRole('button',{name:/Обновить таблицу/}).click()
  assert.notDeepEqual(await criticalSection.locator('.incident-number').allTextContents(),pinned)
  await criticalSection.getByRole('link',{name:'Все изменения за минуту →'}).click()
  await expect(p.getByRole('region',{name:'Изменения очереди'}).locator('li')).toHaveCount(25)
  await expect(wallPage.getByRole('dialog')).toBeHidden()
  await expect(wallTile.locator('strong')).toHaveText('479')
  await expect(wallTile).toContainText('+300')
  await expect(wallTile).toContainText('−300')
  assert(await wallPage.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1))
  if (process.env.MCC_CONSOLE_SCREENSHOT) {
    await wallPage.evaluate(() => {window.scrollTo(0,0); return document.fonts.ready})
    await wallPage.screenshot({path: process.env.MCC_CONSOLE_SCREENSHOT, animations:'disabled'})
  }
  const d=await read('case')
  assert.equal(d.movements.filter(m=>m.queue==='critical').length,600)
})

test('Cerebro layout prototype replays the minute and opens incidents without changing the working desk', async t => {
  const {root, open} = await stand(t)
  const p = await open()
  await p.goto(root+'/prototype/cerebro/')
  await expect(p.locator('.cr-score strong')).toHaveText('479')
  await expect(p.locator('.cr-moves')).toContainText('+300')
  await expect(p.locator('.cr-moves')).toContainText('−300')
  await expect(p.locator('.cr-flow-total')).toContainText('600')
  await p.getByRole('link',{name:'События продукта KION'}).click()
  await p.getByRole('button',{name:'Устранены',exact:true}).click()
  await p.getByRole('textbox',{name:'Поиск по ленте'}).fill('несуществующий-товар')
  await expect(p.getByText('Совпадений нет.')).toBeVisible()
  await p.getByRole('textbox',{name:'Поиск по ленте'}).fill('')
  await expect(p.locator('.cr-events li').first()).toContainText('KION')
  await p.locator('.cr-event').first().click()
  await expect(p.getByRole('region',{name:'Карточка прототипа'})).toContainText('Завершён')
  await p.getByRole('region',{name:'Карточка прототипа'}).getByRole('button',{name:'Закрыть',exact:true}).click()
  await p.getByRole('link',{name:'Проверить гипотезу'}).click()
  await expect(p.getByRole('heading',{name:'Свидетельства'})).toBeVisible()
  await expect(p.locator('.cr-report')).toContainText('18 из 24')
  await p.keyboard.press('Escape')
  await expect(p.getByRole('region',{name:'Карточка прототипа'})).toBeHidden()
  await p.locator('.cr-nav a[href="#q-high"]').click()
  await p.getByRole('button',{name:'Далее · Высокий приоритет'}).click()
  await expect(p.locator('#q-high .cr-pages')).toContainText('6–10')
  await expect(p.locator('#q-critical .cr-pages')).toContainText('1–5')
  await p.getByRole('link',{name:'Обзор смены'}).click()
  await p.getByRole('button',{name:/Повторить минуту/}).click()
  await p.getByRole('button',{name:/Приостановить/}).click()
  await expect(p.getByRole('button',{name:/Продолжить/})).toBeVisible()
  assert(Number((await p.locator('.cr-moves b').first().textContent()).slice(1)) < 300)
  await p.getByRole('button',{name:/Продолжить/}).click()
  await expect(p.locator('.cr-flow-total')).toContainText('600',{timeout:20000})
  await expect(p.locator('.cr-score strong')).toHaveText('479')
  await p.getByRole('button',{name:'Включить светлую тему'}).click()
  for (const width of [320,375,768,1024,1440]) {
    await p.setViewportSize({width,height:850})
    await expect.poll(()=>p.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0)
  }
})

test('the main console uses the selected source through feed, INC, analysis and shift screens', async t => {
  const {open, root} = await stand(t)
  const p = await open()
  const panel = p.locator('.ops-console')
  await expect(panel.locator('.cr-kpis > section')).toHaveCount(3)
  await expect(panel.locator('.ops-queue-nav .overview-stat')).toHaveCount(4)
  const nav = p.getByRole('navigation',{name:'Разделы дашборда'})
  await expect(nav.getByRole('link',{name:'Журнал смены'})).toHaveCount(0)
  await expect(nav.getByRole('link',{name:'Требуют внимания'})).toHaveCount(0)
  const summary = panel.locator('.overview-summary')
  await expect(summary.getByRole('heading',{name:'По продуктам'})).toHaveCount(0)
  await expect(summary.getByRole('heading',{name:'Разбор ИИ'})).toHaveCount(0)
  await expect(summary.locator('.ag-container + .shift-charts h2')).toHaveText(['Динамика инцидентов','Сроки критических инцидентов'])
  const feed = summary.getByRole('region',{name:'Лента событий'})
  await expect(summary.locator(':scope > :last-child')).toHaveAttribute('id','feed')
  const name = await feed.locator('.cr-event-main b').first().innerText()
  await feed.getByRole('textbox',{name:'Поиск по ленте'}).fill(name)
  await expect(feed.locator('.cr-event-main b').first()).toHaveText(name)
  await feed.getByRole('link',{name:'Весь журнал →'}).click()
  await expect(p.getByLabel('Поиск по журналу')).toHaveValue(name)
  await p.getByRole('link',{name:'← К ленте событий'}).click()
  await expect(feed).toBeFocused()
  await feed.locator('.cr-event').first().click()
  await p.getByRole('link',{name:'Полная карточка'}).click()
  await expect(panel.getByRole('tab',{name:'Хронология'})).toBeVisible()
  await p.getByRole('button',{name:'Запустить разбор ИИ'}).or(p.getByRole('link',{name:'Открыть разбор ИИ'})).click()
  await expect(panel.getByRole('heading',{name:'Разбор ИИ'})).toBeVisible()
  await setTheme(p, 'light')
  await p.reload()
  await expect(p.locator('.ops-console.cr-light')).toBeVisible()
  for(const [route,selector] of [['desk/tasks','.shift-queue'],['desk/notifications','.shift-notifications'],['desk/source','.desk-grid'],
    ['incident/incident?tab=room','.ops-assignment'],['incident/incident?tab=work','#work-notes'],['itsm/incident','.official-edit']]){
    await p.setViewportSize({width:320,height:840})
    await p.goto(root+'/#'+route)
    await expect(panel.locator(selector)).toBeVisible()
    await expect.poll(()=>p.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0)
  }
})

test('INC overview keeps the overdue deadline and coordinator visible and reopens a saved investigation', async t => {
  const id = 'INC000023000103'
  const item = {...fixture[0], id, priorityId:4, header:'Не доставляются коды входа',
    productName:'МТС Сообщения', service:'', stateEnum:'Assigned', assignedEmployee:null,
    assignedGroupName:'КЦ ИТ Координаторы Массовых Инцидентов', completionDate:null,
    submitDate:new Date(Date.now() - 9*3600000).toISOString(),
    deadline:new Date(Date.now() - 460*60000 - 10000).toISOString(), meetingUrl:null}
  const {open,root,read} = await stand(t,[item])
  const page = await open('case')
  const card = root + '/?dataset=case#incident/' + id
  await page.goto(card)
  for (const [width,height,theme] of [[1440,900,'dark'],[390,844,'light']]) {
    await page.setViewportSize({width,height})
    await setTheme(page, theme)
    const panel = page.locator('.ops-assignment:visible')
    await expect(panel).toContainText(/Просрочено на\s+7\s+ч\s+40\s+мин/)
    const bounds = await panel.evaluate(el => ({
      due:el.firstElementChild.getBoundingClientRect().bottom,
      owner:el.querySelector('.incident-brief-facts dd').getBoundingClientRect().bottom,
      overflow:document.documentElement.scrollWidth > innerWidth,
    }))
    assert(bounds.due <= height && bounds.owner <= height && !bounds.overflow, JSON.stringify(bounds))
    assert.deepEqual(await page.getByRole('tab').allTextContents(), ['Обзор','Хронология'])
    await expect(panel.getByText('Ссылка пока не получена')).toBeVisible()
    await expect(page.getByRole('button',{name:'Демо: новый крит'})).toHaveCount(0)
  }
  await page.getByRole('button',{name:'Запустить разбор ИИ'}).click()
  await expect(page.getByText('Только карточка ITSM',{exact:true})).toBeVisible()
  const before = (await read('case')).work[id].reports.filter(r=>r.title==='Разбор агента')
  assert.equal(before.length,1)
  await page.goto(card)
  await page.getByRole('link',{name:'Открыть разбор ИИ'}).click()
  await expect(page).toHaveURL(new RegExp('run='+before[0].id+'(?:&|$)'))
  assert.equal((await read('case')).work[id].reports.filter(r=>r.title==='Разбор агента').length,1)
})


test('overview provides a short action list and opens the full situation list on demand', async t => {
  const source = Array.from({length: 5}, (_, i) => ({
    ...fixture[0], id: 'INC9876000' + i, header: 'Ситуация ' + i, priorityId: 4,
    stateEnum: 'WorkInProgress', assignedGroupName: 'Линия продукта', parentId: null, completionDate: null,
  }))
  const {open} = await stand(t, source)
  const page = await open('case')
  const attention = page.getByRole('region', {name: 'Ситуации смены'})
  await expect(attention.locator('.ag-list > li')).toHaveCount(3)
  const row = attention.locator('.ag-list > li').first()
  const title = await row.locator('.ag-title').innerText()
  await row.getByRole('button', {name:'Взять в работу'}).click()
  await attention.getByRole('link', {name:'Все ситуации (5) →'}).click()
  await expect(attention.locator('.ag-list > li')).toHaveCount(5)
  const accepted = attention.locator('.ag-list > li').filter({has: page.getByRole('link',{name:title,exact:true})})
  await expect(accepted).toContainText('Ведёт Анна Котова')
  await page.getByRole('link', {name:'← К сводке смены'}).click()
  await expect(attention).toBeFocused()
  await expect(page.getByRole('heading',{name:'Требуют внимания'})).toBeVisible()
})

test('a long desktop queue only mounts the visible rows and scrolls to more incidents', async t => {
  const {open, root} = await stand(t)
  const page = await open('volume', 'anna', 1440)
  await page.goto(root + '/#queue/all?size=100')
  const scroll = page.getByRole('region', {name: 'Все инциденты', exact: true})
    .getByRole('region', {name: 'Список инцидентов'})
  const rows = scroll.locator('tbody tr')
  await expect(rows.first()).toBeVisible()
  assert((await rows.count()) < 100)
  const firstRow = await rows.first().textContent()
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect.poll(() => rows.first().textContent()).not.toBe(firstRow)
})

test('coordinator reorders overview blocks with keyboard controls and reset survives a reload', async t => {
  const {open} = await stand(t)
  const p = await open()
  const blocks = () => p.locator('[data-overview-block]').evaluateAll(nodes => nodes.map(node => node.dataset.overviewBlock))
  await expect(p.getByRole('heading', {name: 'Сводка смены'})).toBeVisible()
  assert.deepEqual(await blocks(), ['stats', 'charts', 'critical'])
  await expect(p.getByRole('region', {name: 'Порядок блоков'})).toHaveCount(0)

  await p.getByRole('button', {name: 'Настроить порядок блоков'}).click()
  const settings = p.getByRole('region', {name: 'Порядок блоков'})
  await expect(settings).toBeVisible()
  const chartsUp = settings.getByRole('button', {name: 'Переместить блок «Динамика и сроки» выше'})
  await expect(chartsUp).toBeEnabled()
  await chartsUp.focus()
  await p.keyboard.press('Enter')
  assert.deepEqual(await blocks(), ['charts', 'stats', 'critical'])
  await expect(settings.getByRole('button', {name: 'Переместить блок «Динамика и сроки» выше'})).toBeDisabled()

  const statsDown = settings.getByRole('button', {name: 'Переместить блок «Показатели очередей» ниже'})
  await statsDown.focus()
  await p.keyboard.press('Enter')
  assert.deepEqual(await blocks(), ['charts', 'critical', 'stats'])
  await expect(settings.getByRole('button', {name: 'Переместить блок «Показатели очередей» ниже'})).toBeDisabled()
  await expect(p.locator('#section-critical')).toBeAttached()
  await expect(p.getByRole('heading', {name: 'Динамика инцидентов'})).toBeVisible()
  await settings.getByRole('checkbox', {name: 'Динамика и сроки'}).uncheck()
  assert.deepEqual(await blocks(), ['critical', 'stats'])
  await expect(p.locator('#attention')).toBeAttached()
  await expect(p.locator('#feed')).toBeAttached()

  await p.reload()
  await expect(p.getByRole('heading', {name: 'Сводка смены'})).toBeVisible()
  assert.deepEqual(await blocks(), ['critical', 'stats'])

  await p.getByRole('button', {name: 'Настроить порядок блоков'}).click()
  await p.getByRole('button', {name: 'Сбросить по умолчанию'}).click()
  assert.deepEqual(await blocks(), ['stats', 'charts', 'critical'])
  assert.equal(await p.evaluate(() => localStorage.getItem('mcc-overview-order')), null)
  await p.setViewportSize({width: 390, height: 900})
  await setTheme(p, 'dark')
  await expect(settings).toBeVisible()
  await expect.poll(() => p.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await p.getByRole('button', {name: 'Готово'}).click()
  await expect(settings).toHaveCount(0)
  await p.reload()
  await expect(p.getByRole('heading', {name: 'Сводка смены'})).toBeVisible()
  assert.deepEqual(await blocks(), ['stats', 'charts', 'critical'])
})
