import test from 'node:test'
import assert from 'node:assert/strict'
import {sceneAt} from '../mock/prototype/minute.ts'

test('prototype derives critical totals and product counters from the incidents shown at the replay cursor', () => {
  for (let second = 0; second <= 60; second++) {
    const s = sceneAt(second)
    assert.equal(s.groups.critical.length, 479 + s.entered - s.exited)
    assert.equal(s.trend.at(-1), s.groups.critical.length)
    assert.equal(
      s.products.reduce((sum, p) => sum + p.active, 0),
      s.groups.critical.length,
    )
    assert.equal(s.feed.length, s.entered + s.exited)
    if (second % 10 === 0) {
      assert.equal(s.entered, second * 5)
      assert.equal(s.exited, second * 5)
    }
  }
})
