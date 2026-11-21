import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {existsSync} from 'node:fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium, expect} from '@playwright/test'
import serve from 'serve-handler'
import {mockService} from '../mock/server.ts'
import {identityFixture} from './support/identity.mjs'

const incidents = {
  'INC-CHILD': {
    title: 'Ошибка кассы самообслуживания',
    stateEnum: 'Assigned',
    priorityId: 4,
  },
  'INC-PARENT': {
    title: 'Сбой оплаты в рознице',
    stateEnum: 'WorkInProgress',
    priorityId: 3,
  },
  'INC-SIBLING': {
    title: 'Ошибка платёжного терминала',
    stateEnum: 'Assigned',
    priorityId: 2,
  },
  'INC-UNRELATED': {
    title: 'Инцидент без связей',
    stateEnum: 'Resolved',
    priorityId: 1,
  },
  'INC-ERROR': {
    title: 'Инцидент с ошибкой связей',
    stateEnum: 'Assigned',
    priorityId: 2,
  },
  'INC-SLOW': {
    title: 'Медленный инцидент',
    stateEnum: 'Assigned',
    priorityId: 1,
  },
}

function node(id) {
  const incident = incidents[id]
  return {
    id,
    title: incident.title,
    stateEnum: incident.stateEnum,
    priorityId: incident.priorityId,
  }
}

const parentEdges = [
  {parentId: 'INC-PARENT', childId: 'INC-CHILD'},
  {parentId: 'INC-PARENT', childId: 'INC-SIBLING'},
]

const relationships = {
  'INC-CHILD': {
    focusId: 'INC-CHILD',
    nodes: [node('INC-CHILD'), node('INC-PARENT')],
    edges: [{parentId: 'INC-PARENT', childId: 'INC-CHILD'}],
  },
  'INC-PARENT': {
    focusId: 'INC-PARENT',
    nodes: [node('INC-PARENT'), node('INC-CHILD'), node('INC-SIBLING')],
    edges: parentEdges,
  },
  'INC-SIBLING': {
    focusId: 'INC-SIBLING',
    nodes: [node('INC-SIBLING'), node('INC-PARENT')],
    edges: [{parentId: 'INC-PARENT', childId: 'INC-SIBLING'}],
  },
  'INC-UNRELATED': {
    focusId: 'INC-UNRELATED',
    nodes: [node('INC-UNRELATED')],
    edges: [],
  },
  'INC-ERROR': {
    focusId: 'INC-ERROR',
    nodes: [node('INC-ERROR'), node('INC-PARENT')],
    edges: [{parentId: 'INC-PARENT', childId: 'INC-ERROR'}],
  },
  'INC-SLOW': {
    focusId: 'INC-SLOW',
    nodes: [node('INC-SLOW'), node('INC-PARENT')],
    edges: [{parentId: 'INC-PARENT', childId: 'INC-SLOW'}],
  },
}

function detail(id) {
  const incident = incidents[id]
  return {
    id,
    revision: 1,
    eventSeq: 1,
    header: incident.title,
    description: null,
    productName: 'МТС Маркет',
    service: null,
    submitDate: '2026-11-21T09:00:00.000Z',
    stateEnum: incident.stateEnum,
    priorityId: incident.priorityId,
    assignedGroupName: null,
    assignedEmployee: null,
    deadline: null,
    remainingSeconds: null,
    overdue: false,
    groupMemberships: [],
    itsmUrl: `https://itsm.example.org/incidents/${id}`,
    itsmDemo: true,
  }
}

async function stand(t) {
  const identity = await identityFixture(t)
  const directory = await mkdtemp(join(tmpdir(), 'mcc-relationships-browser-'))
  const mock = mockService(directory, undefined, {}, identity.settings)
  const server = createServer((request, response) =>
    mock.handle(request, response, () =>
      serve(request, response, {
        public: 'dist',
        rewrites: [{source: '**', destination: '/index.html'}],
      }),
    ),
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const root = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({
    channel:
      process.env.MCC_BROWSER_CHANNEL ||
      (existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined),
  })
  const errors = []
  t.after(async () => {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
    mock.close()
    await rm(directory, {recursive: true, force: true})
    assert.deepEqual(errors, [])
  })

  async function open(id) {
    const context = await browser.newContext({
      viewport: {width: 1280, height: 900},
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    page.setDefaultTimeout(8000)
    let errorAttempts = 0
    await page.route(/\/api\/(?:dashboard\/)?incidents\//, async (route) => {
      assert.equal(await route.request().headerValue('authorization'), 'Bearer ' + identity.getAccessToken())
      const path = new URL(route.request().url()).pathname
      const relationshipMatch = path.match(
        /^\/api\/incidents\/([^/]+)\/relationships$/,
      )
      if (relationshipMatch) {
        const id = decodeURIComponent(relationshipMatch[1])
        if (id === 'INC-SLOW') {
          await new Promise((resolve) => setTimeout(resolve, 700))
        }
        if (id === 'INC-ERROR' && errorAttempts++ === 0) {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              code: 'INTERNAL_ERROR',
              message: 'Сервис связей временно недоступен',
            }),
          })
          return
        }
        const fixture = relationships[id]
        if (!fixture) {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({
              code: 'RESOURCE_NOT_FOUND',
              message: `Resource with id ${id} not found`,
            }),
          })
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(fixture),
        })
        return
      }

      const detailMatch = path.match(/^\/api\/dashboard\/incidents\/([^/]+)$/)
      if (detailMatch) {
        const id = decodeURIComponent(detailMatch[1])
        await route.fulfill({
          status: incidents[id] ? 200 : 404,
          contentType: 'application/json',
          body: JSON.stringify(
            incidents[id]
              ? detail(id)
              : {code: 'RESOURCE_NOT_FOUND', message: `Resource with id ${id} not found`},
          ),
        })
        return
      }

      await route.continue()
    })
    await page.goto(`${root}/incidents/${id}`)
    await expect(page.getByRole('heading', {name: incidents[id].title})).toBeVisible()
    return page
  }

  return {open}
}

test('relationships load separately and a local error can be retried without hiding the incident card', async (t) => {
  const {open} = await stand(t)
  const slow = await open('INC-SLOW')
  await expect(slow.getByRole('heading', {name: 'Медленный инцидент'})).toBeVisible()
  await expect(slow.getByText('Загружаем связанные инциденты…')).toBeVisible()
  await expect(slow.getByRole('link', {name: /INC-PARENT/})).toBeVisible()

  const broken = await open('INC-ERROR')
  await expect(broken.getByRole('heading', {name: 'Инцидент с ошибкой связей'})).toBeVisible()
  await expect(broken.getByRole('alert')).toContainText('Сервис связей временно недоступен')
  await broken.getByRole('button', {name: 'Повторить'}).click()
  await expect(broken.getByRole('link', {name: /INC-PARENT/})).toBeVisible()
})

test('a known unrelated incident shows the empty state', async (t) => {
  const {open} = await stand(t)
  const page = await open('INC-UNRELATED')
  await expect(page.getByText('Нет связанных инцидентов')).toBeVisible()
  await expect(page.locator('.relationship-node_link')).toHaveCount(0)
})

test('the graph labels direction and selection, then keyboard navigation refocuses parent and siblings', async (t) => {
  const {open} = await stand(t)
  const page = await open('INC-CHILD')

  await expect(page.getByRole('heading', {name: 'Связанные инциденты'})).toBeVisible()
  await expect(page.getByText('родитель → дочерний')).toBeVisible()
  await expect(page.getByText('Выбранный INC')).toBeVisible()
  await expect(page.locator('.relationship-node_selected')).toHaveAttribute(
    'aria-current',
    'true',
  )

  const parentLink = page.getByRole('link', {name: /INC-PARENT/})
  await expect(parentLink).toHaveAttribute('href', '/incidents/INC-PARENT')
  await parentLink.focus()
  await expect(parentLink).toBeFocused()
  await page.keyboard.press('Enter')

  await page.waitForURL('**/incidents/INC-PARENT')
  await expect(page.getByRole('heading', {name: 'Сбой оплаты в рознице'})).toBeVisible()
  await expect(page.getByText('Выбранный INC')).toBeVisible()
  await expect(page.getByRole('link', {name: /INC-CHILD/})).toBeVisible()
  await expect(page.getByRole('link', {name: /INC-SIBLING/})).toBeVisible()
})

test('the dashboard hash detail shows the graph and keeps navigation on the canonical route', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mcc-relationships-browser-'))
  const identity = await identityFixture(t)
  const mock = mockService(directory, undefined, {}, identity.settings)
  const server = createServer((request, response) =>
    mock.handle(request, response, () =>
      serve(request, response, {
        public: 'dist',
        rewrites: [{source: '**', destination: '/index.html'}],
      }),
    ),
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const root = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({
    channel:
      process.env.MCC_BROWSER_CHANNEL ||
      (existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined),
  })
  const errors = []
  t.after(async () => {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
    mock.close()
    await rm(directory, {recursive: true, force: true})
    assert.deepEqual(errors, [])
  })

  const context = await browser.newContext({
    viewport: {width: 1280, height: 900},
    reducedMotion: 'reduce',
  })
  await context.addInitScript(() => localStorage.setItem('mcc-source', 'case'))
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(10000)

  await page.goto(`${root}/#incident/INC000021938167`)
  await expect(page.getByRole('heading', {name: 'Проблема с Прокладка'})).toBeVisible()
  await expect(page.getByRole('heading', {name: 'Связанные инциденты'})).toBeVisible()
  await expect(page.getByText('Выбранный INC')).toBeVisible()

  const parentLink = page.getByRole('link', {name: /INC000021940033/})
  await expect(parentLink).toHaveAttribute(
    'href',
    '/incidents/INC000021940033?source=case',
  )
  await parentLink.focus()
  await page.keyboard.press('Enter')

  await page.waitForURL(/(?:\/incidents\/INC000021940033\?source=case|\/#incident\/INC000021940033)$/)
  await expect(page.getByRole('heading', {name: 'Аномалия в Магнит'})).toBeVisible()
  await expect(page.getByRole('link', {name: /INC000021938167/})).toBeVisible()
  await expect(page.getByRole('link', {name: /INC000021940779/})).toBeVisible()
})
