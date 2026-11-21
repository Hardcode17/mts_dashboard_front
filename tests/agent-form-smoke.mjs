import assert from 'node:assert/strict'
import {chromium} from 'playwright-core'

export async function checkExpandedAgentForm(form, width) {
  await form.waitFor({state: 'visible'})
  await form.page().evaluate(() => document.fonts.ready)
  const box = locator => locator.boundingBox()
  const [first, second, save, label, interval, age] = await Promise.all([
    box(form.getByText('Источник телеметрии недоступен', {exact: true})),
    box(form.getByText('Модель недоступна', {exact: true})),
    box(form.getByRole('button', {name: 'Сохранить условия проверки'})),
    box(form.locator('label').filter({hasText: 'Ожидаемый интервал, мин'})),
    box(form.getByRole('spinbutton', {name: 'Ожидаемый интервал, мин'})),
    box(form.getByRole('spinbutton', {name: 'Возраст записи, мин'})),
  ])
  assert([first, second, save, label, interval, age].every(Boolean), 'form controls must be visible')
  const checkboxGap = second.y - first.y - first.height
  const saveGap = save.y - second.y - second.height
  assert(checkboxGap >= 8, 'separate the two outage toggles')
  assert(saveGap >= 12, 'separate the save action from the toggles')
  assert(interval.y > label.y + label.height, 'display the interval label above its value')
  if (width === 320) assert(age.y >= interval.y + interval.height + 8)
  else assert(age.x >= interval.x + interval.width + 8)
  assert(await form.evaluate(el => el.scrollWidth <= el.clientWidth + 1))
  return {checkboxGap, saveGap}
}

if (import.meta.main) {
  const origin = 'http://127.0.0.1:' + process.env.FRONTEND_PORT
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH})
  try {
    for (const [key, width, theme] of [['incident', 1440, 'light'], ['access', 320, 'dark']]) {
      const page = await browser.newPage({viewport: {width, height: 900}, reducedMotion: 'reduce'})
      const url = origin + '/#investigation/' + key + '?dataset=volume'
      await page.goto(url)
      await page.getByRole('heading', {name: 'Разбор причины агентом', exact: true}).waitFor()
      const themeSwitch = page.getByRole('switch', {name: 'Тёмная тема'})
      const checked = String(theme === 'dark')
      if (await themeSwitch.getAttribute('aria-checked') !== checked) await themeSwitch.click()
      assert.equal(await themeSwitch.getAttribute('aria-checked'), checked)
      await page.locator('summary').filter({hasText: 'Источники и проверки стенда'}).click()
      const form = page.locator('.agent-diagnostics form')
      await form.getByRole('heading', {name: 'Свежесть данных'}).waitFor()
      await form.getByRole('heading', {name: 'Состояние стенда'}).waitFor()
      const {checkboxGap, saveGap} = await checkExpandedAgentForm(form, width)
      assert(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth))
      console.log('Opened published agent form:', url, theme, width + 'px;',
        'checkbox gap', checkboxGap + 'px;', 'save gap', saveGap + 'px;', 'no horizontal overflow')
      await page.close()
    }
  } finally {
    await browser.close()
  }
}
