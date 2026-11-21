import assert from 'node:assert/strict'
import {chromium} from 'playwright-core'

const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH})
try {
  const page = await browser.newPage()
  const origin = 'http://127.0.0.1:' + process.env.FRONTEND_PORT
  const response = await page.goto(origin)
  assert(response?.ok(), 'The frontend must return a successful response')
  await page.getByRole('button', {name: /^(Войти|Sign in)$/i}).waitFor()
} finally {
  await browser.close()
}
