import {test} from 'node:test'
import assert from 'node:assert/strict'
import {itsmLink} from '../src/desk/itsmLink.ts'

test('external ITSM opens the official incident number in a separate tab', () => {
  assert.deepEqual(itsmLink('INC123', 'demo', 'https://itsm.example/incidents/'), {
    href: 'https://itsm.example/incidents/INC123',
    target: '_blank',
    rel: 'noopener noreferrer',
  })
})

test('a missing or invalid configuration keeps the demo card reachable', () => {
  for (const base of [undefined, 'bad', 'javascript:alert(1)', 'https://itsm.example/incidents?q=x']) {
    assert.deepEqual(itsmLink('INC123', 'demo', base), {href: '#itsm/demo'})
  }
})
