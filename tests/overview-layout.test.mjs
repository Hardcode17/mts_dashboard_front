import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  defaultOverviewOrder,
  isDefaultOverviewOrder,
  moveOverviewBlock,
  normalizeOverviewOrder,
  overviewOrderStorageKey,
  parseOverviewOrder,
  readOverviewOrder,
  saveOverviewOrder,
} from '../src/overviewLayout.ts'

function memoryStorage() {
  const values = new Map()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

test('overview order falls back to the default for missing, partial or malformed values', () => {
  assert.deepEqual(defaultOverviewOrder, ['stats', 'charts', 'critical'])
  for (const raw of [null, '', 'not json', '{}', '[]', '["charts"]', '["charts","stats","stats"]', '["charts","stats","events"]']) {
    assert.deepEqual(parseOverviewOrder(raw), [...defaultOverviewOrder])
  }
  assert.deepEqual(parseOverviewOrder('["critical","stats","charts"]'), ['critical', 'stats', 'charts'])
  assert.deepEqual(normalizeOverviewOrder(['stats', 'charts', 'critical']), [...defaultOverviewOrder])
  assert(isDefaultOverviewOrder(defaultOverviewOrder))
  assert(!isDefaultOverviewOrder(['charts', 'stats', 'critical']))
})

test('blocks move one position and never cross the list boundaries', () => {
  const original = ['stats', 'charts', 'critical']
  assert.deepEqual(moveOverviewBlock(original, 'stats', 1), ['charts', 'stats', 'critical'])
  assert.deepEqual(moveOverviewBlock(original, 'critical', -1), ['stats', 'critical', 'charts'])
  assert.deepEqual(moveOverviewBlock(original, 'stats', -1), original)
  assert.deepEqual(moveOverviewBlock(original, 'critical', 1), original)
  assert.deepEqual(original, ['stats', 'charts', 'critical'])
})

test('custom order is saved, restored after reload and removed when reset', () => {
  const storage = memoryStorage()
  const custom = ['critical', 'stats', 'charts']
  assert.deepEqual(saveOverviewOrder(custom, storage), custom)
  assert.equal(storage.values.get(overviewOrderStorageKey), JSON.stringify(custom))
  assert.deepEqual(readOverviewOrder(storage), custom)

  saveOverviewOrder(defaultOverviewOrder, storage)
  assert.equal(storage.values.has(overviewOrderStorageKey), false)
  assert.deepEqual(readOverviewOrder(storage), [...defaultOverviewOrder])
})

test('unavailable storage does not break reading or saving the order', () => {
  const broken = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') },
    removeItem() { throw new Error('blocked') },
  }
  assert.deepEqual(readOverviewOrder(broken), [...defaultOverviewOrder])
  assert.deepEqual(saveOverviewOrder(['charts', 'stats', 'critical'], broken), ['charts', 'stats', 'critical'])
})
