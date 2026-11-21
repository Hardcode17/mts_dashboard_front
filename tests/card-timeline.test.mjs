import {test} from 'node:test'
import assert from 'node:assert/strict'
import {cardTimeline, historyValue} from '../src/desk/timeline.ts'
import {createDesk, execute} from '../mock/engine.ts'
import {initialIncidents} from '../src/demoData.ts'
import {standNow} from '../src/desk/types.ts'

test('the incident journal puts the ITSM edit and its detection on the stand clock exactly once', () => {
  const started = Date.parse('2026-11-21T06:00:00Z')
  const desk = createDesk('volume', started)
  const item = initialIncidents.find(i => i.key === 'incident')
  const when = started + 60000
  execute(desk, {type: 'edit', key: item.key, data: {team: 'Платёжная смена', solution: 'Проверено'}}, when)
  const changes = cardTimeline(desk, item).filter(e => e.source === 'ITSM')
  for (const value of ['Платёжная смена', 'Проверено']) {
    assert.equal(changes.find(e => e.text.includes(value))?.at, standNow(desk, when))
  }
  assert.match(historyValue('due', '2026-11-21T13:24:00.000Z'), /16:24:00 МСК/)
  assert.equal(historyValue('priority', '4'), 'Наивысший')
})
