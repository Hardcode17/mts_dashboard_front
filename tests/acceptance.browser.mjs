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
  const dir = await mkdtemp(join(tmpdir(), 'mcc-browser-')),
    file = join(dir, 'source.json')
  await writeFile(file, JSON.stringify(rows))
  const api = mockService(dir, file)
  const server = createServer((req, res) =>
    api.handle(req, res, () =>
      serve(req, res, {public: 'dist', rewrites: [{source: '**', destination: '/index.html'}]}),
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
    read: async (mode) => (await (await fetch(root + '/api/stand/snapshot?mode=' + mode)).json()).desk,
  }
}
test('acceptance: file polling, critical burst, resolution, external card, revisions and stale input', async (t) => {
  const {open, file, root, read} = await stand(t),
    p = await open('case')
  const counts = p.locator('.overview-stat')
  await expect(counts).toHaveCount(4)
  await expect(counts.first()).toBeVisible()
  const digits = async () =>
    counts.evaluateAll((list) => list.map((e) => Number(e.textContent.replace(/[^\d]/g, ''))))
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
  await dlg.getByRole('button', {name: 'Демо: ещё один крит'}).click()
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
  await p.getByRole('tab', {name: 'История изменений'}).click()
  await expect(p.getByRole('tabpanel', {name: 'История изменений'})).toContainText('Группа назначения')
  await p.getByText('Сравнить версии карточки').click()
  await expect(p.getByRole('tabpanel', {name: 'История изменений'})).toContainText('→')
  await p.getByRole('link', {name: 'Открыть в ITSM'}).click()
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
    await o.getByLabel('Команда решения INC777').fill('Платежи L2')
    await o.getByRole('button', {name: 'Передать исполнителю'}).click()
    await expect.poll(async () => (await read('case')).records.INC777.team).toBe('Платежи L2')
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
  await p.goto(root + '/#incident/wifi-rostov?tab=work')
  await p.getByRole('button', {name: 'Подтвердить связь'}).first().click()
  await expect.poll(async () => (await read('volume')).work['wifi-msk'].links).toContain('wifi-rostov')
  await p.getByText('Нет ответа о доступности', {exact: true}).click()
  await p.getByRole('option', {name: 'Двое свободны, третий через час'}).click()
  await expect(p.getByText(/240 мин до восстановления/)).toBeVisible()
  await p.getByRole('button', {name: 'Согласовать рекомендацию'}).click()
  await expect.poll(async () => (await read('volume')).work['wifi-rostov'].recommendation).toContain('Ростов')
  await p.getByLabel('Текст записи').fill('Проверить маршрут контроллера')
  await p.getByRole('button', {name: 'Добавить запись'}).click()
  await p.getByRole('button', {name: 'Сохранить сводку смены'}).click()
  await p.getByRole('button', {name: 'Подготовить черновик разбора'}).click()
  await p.getByRole('tab', {name: 'Аварийная комната'}).click()
  await p.getByRole('button', {name: 'Открыть демовстречу'}).click()
  await p.getByRole('button', {name: 'Завершить демовстречу'}).click()
  await expect(p.getByRole('heading', {name: 'Сводка по транскрипту'})).toBeVisible()
  await p
    .getByRole('button', {name: /К фрагменту/})
    .first()
    .click()
  await p.goto(root + '/#desk/notifications')
  await p.getByText('Имитировать ошибку доставки').click()
  await p.locator('details').getByRole('checkbox', {name: 'SMS', exact: true}).click()
  await expect(p.locator('details').getByRole('checkbox', {name: 'SMS', exact: true})).toBeChecked()
  await p.goto(root + '/#incident/wifi-rostov?tab=work')
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
  await p.getByText('Имитировать ошибку доставки').click()
  await p.locator('details').getByRole('checkbox', {name: 'SMS', exact: true}).click()
  await expect(p.locator('details').getByRole('checkbox', {name: 'SMS', exact: true})).not.toBeChecked()
  await bad.getByRole('button', {name: 'Повторить доставку'}).click()
  await expect(bad).toHaveCount(0)
  const messages = (await read('volume')).notices.filter((n) => n.text === 'Проверка каналов стенда')
  assert.equal(messages.find((n) => n.channel === 'SMS').tries, 2)
  assert(messages.filter((n) => n.channel !== 'SMS').every((n) => n.tries === 1))
})
test('all incident queues stay mounted while sidebar links scroll and pagination stays local', async (t) => {
  const {open, root} = await stand(t)
  const page = await open('volume', 'anna', 1920)
  await page.goto(root + '/#queue/critical')

  const critical = page.getByRole('region', {name: 'Критические', exact: true})
  const high = page.getByRole('region', {name: 'Высокий приоритет', exact: true})
  await expect(critical.getByRole('table')).toBeVisible()
  await expect(page.getByRole('region', {name: 'На координаторах', exact: true})).toBeVisible()
  await expect(high.getByRole('table')).toBeVisible()
  await expect(page.getByRole('region', {name: 'Исследование ситуации', exact: true})).toBeVisible()
  const sidebar = page.getByRole('navigation', {name: 'Очереди смены'})
  await page.evaluate(() => {
    window.queueScrolls = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (options) {
      window.queueScrolls.push(options?.behavior)
      original.call(this, options)
    }
  })
  await page.emulateMedia({reducedMotion: 'no-preference'})
  await sidebar.getByRole('link', {name: /Высокий приоритет/}).click()
  await expect(high.getByRole('heading')).toBeInViewport()
  assert.equal(await page.evaluate(() => window.queueScrolls.at(-1)), 'smooth')
  await expect(sidebar.getByRole('link', {name: /Критические/})).toBeInViewport()

  await high.getByRole('button', {name: 'Следующая'}).click()
  await expect(high.getByText(/^26–50 из /)).toBeVisible()
  await expect(critical.getByText(/^1–25 из /)).toBeVisible()
  await page.emulateMedia({reducedMotion: 'reduce'})
  await sidebar.getByRole('link', {name: /Критические/}).click()
  await expect(critical.getByRole('heading')).toBeInViewport()
  assert.equal(await page.evaluate(() => window.queueScrolls.at(-1)), 'instant')
  await expect(high.getByText(/^26–50 из /)).toBeVisible()
})

test('the wall shows arrivals and completions when the active total stays the same', async (t) => {
  const active = fixture.find(row => row.stateEnum === 'WorkInProgress' && row.priorityId < 4)
  const {open, file, root} = await stand(t, [active])
  const page = await open('api', 'anna', 1920)
  await page.goto(root + '/#wall')
  const flow = page.getByRole('region', {name: 'Поток инцидентов'})
  await expect(flow.getByText('1', {exact: true})).toBeVisible()
  await expect(flow.getByText('+0', {exact: true})).toBeVisible()

  const completed = {...active, stateEnum: 'Resolved', completionDate: new Date().toISOString()}
  const incoming = {...active, id: 'INC000099999994'}
  await writeFile(file, JSON.stringify([completed, incoming]))
  await expect(flow.getByText('+1', {exact: true})).toBeVisible({timeout: 9000})
  await expect(flow.getByText('−1', {exact: true})).toBeVisible()
  await expect(flow.getByText('1', {exact: true})).toBeVisible()
})

test('acceptance: queue filters, responsive layouts, analysis sources, telemetry loss and recovery experiment', async (t) => {
  const {open, root, read} = await stand(t),
    p = await open('volume', 'anna', 390)
  await p.locator('input[value="dark"]').check()
  await p.goto(root + '/#queue/all')
  await p.getByLabel('Поиск по всем инцидентам').fill('INC000021940112')
  await p.getByRole('region', {name: 'Все инциденты', exact: true})
    .getByRole('link', {name: /INC000021940112/}).click()
  await expect(p.getByRole('region', {name: 'Быстрый просмотр инцидента'})).toBeVisible()
  await p.getByRole('link', {name: 'Полная карточка'}).click()
  await p.getByRole('button', {name: 'Разобрать причину агентом'}).click()
  await expect(p.getByText(/Фоновая сверка занимает большую часть пула/)).toBeVisible()
  await p.getByText('Источники и проверки стенда').click()
  await p.getByText('Ожидание БД', {exact: true}).click()
  await p.getByRole('option', {name: 'Насыщение обработчиков'}).click()
  await p.getByRole('button', {name: 'Сохранить условия проверки'}).click()
  await p.getByRole('button', {name: 'Повторить анализ'}).click()
  await expect(p.getByText(/Обработчики платежей насыщены/).first()).toBeVisible()
  await p.getByRole('button', {name: 'Запустить демопрогон'}).click()
  await expect
    .poll(async () => (await read('volume')).work.incident.reports[0].title)
    .toBe('Эксперимент восстановления')
  await p.getByRole('checkbox', {name: 'Источник телеметрии недоступен'}).check()
  await p.getByRole('button', {name: 'Сохранить условия проверки'}).click()
  await p.getByRole('button', {name: 'Повторить анализ'}).click()
  await expect(p.getByText('Свежие наблюдения недоступны', {exact: true})).toBeVisible()
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
  const all = p.getByRole('region', {name: 'Все инциденты', exact: true})
  await all.getByText('Фильтры и сохранённые представления').click()
  await all.getByRole('textbox', {name: 'Название представления'}).fill('Мои продукты')
  await all.getByRole('button', {name: 'Сохранить представление'}).click()
  await expect(all.getByRole('link', {name: 'Мои продукты'})).toBeVisible()
  await p.reload()
  await all.getByText('Фильтры и сохранённые представления').click()
  await all.getByRole('link', {name: 'Мои продукты'}).click()
  await expect(p.getByLabel('Поиск по всем инцидентам')).toHaveValue('МТС')
  await p.goto(root + '/incidents/INC000021940112?source=volume')
  await p.getByRole('button', {name: 'Разобрать причину агентом'}).click()
  await p.getByText('Исходная запись', {exact: true}).first().click()
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
  await expect(page.getByRole('button', {name:'Разобрать причину агентом'})).toBeVisible()
  await page.goto(root + '/#desk/tasks')
  assert.deepEqual(await layout(), direct)

  await page.getByRole('radio', {name:/В очереди/}).check()
  await expect(page.locator('.shift-task-list > li').first()).toBeVisible()
  for (const theme of ['light', 'dark']) {
    await page.locator('input[value="'+theme+'"]').check()
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
  await peer.getByRole('button', {name: 'Демо: новый крит'}).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const interruptedId = await dialog.locator('.signal-item').first().locator('h3').textContent()
  await peer.getByRole('button', {name: 'Демо: ещё один крит'}).click()
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
  await page.getByRole('region', {name: 'Все инциденты', exact: true})
    .getByRole('link', {name: 'INC000021940112', exact: true}).click()
  await page.getByRole('link', {name: 'Полная карточка'}).click()
  await page.reload()
  await expect(page.locator('main a').filter({hasText: /←/}).first()).toHaveAttribute('href', listing)
})

test('expanded agent diagnostics keep labels, checkboxes and the submit action visibly separated', async t => {
  const {open, root} = await stand(t)
  const p = await open()
  for (const [key, width, theme] of [['incident', 1440, 'light'], ['access', 320, 'dark']]) {
    await p.setViewportSize({width, height: 900})
    await p.goto(root + '/#investigation/' + key)
    await p.locator('input[value="'+theme+'"]').check()
    const summary = p.locator('summary').filter({hasText: 'Источники и проверки стенда'})
    await summary.focus()
    await p.keyboard.press('Enter')
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
    await summary.click()
    await expect(form).toBeHidden()
    await p.getByRole('button', {name:'Запустить анализ'}).click()
    await expect(p.getByRole('heading', {name:'Вывод агента'})).toBeVisible()
    assert(await p.evaluate(() => document.documentElement.scrollWidth === innerWidth))
  }
})
