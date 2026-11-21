import test from 'node:test'
import assert from 'node:assert/strict'
import {boardLink, canonicalQueueRoute, overviewLink, overviewSection, scopeQueueParams, selectedQueue} from '../src/desk/queueNavigation.ts'

test('queue bookmarks open their overview section, while the full register and journal keep their own routes', () => {
  for (const key of ['critical', 'assigned', 'high', 'research']) {
    const href = canonicalQueueRoute('#queue/' + key + '?q=INC1&page=2')
    assert.equal(selectedQueue(href), key)
    assert.equal(new URLSearchParams(href.split('?')[1]).get('q'), 'INC1')
    assert.equal(canonicalQueueRoute(href), href)
  }
  assert.equal(canonicalQueueRoute('#queue/all?q=INC1'), '#queue/all?q=INC1')
  assert.equal(canonicalQueueRoute('#events?page=7'), '#events?page=7')
})

test('switching anchors and returning to the top preserves independent filters and pages', () => {
  const listing = '#overview?section=high&page=3&critical.page=2&critical.q=INC7'
  const critical = overviewLink(listing, 'critical')
  const params = new URLSearchParams(critical.split('?')[1])
  assert.equal(params.get('section'), 'critical')
  assert.equal(params.get('page'), '2')
  assert.equal(params.get('q'), 'INC7')
  assert.equal(params.get('high.page'), '3')
  const top = overviewLink(critical)
  assert.equal(selectedQueue(top), undefined)
  assert.equal(overviewLink(top, 'high'), overviewLink(listing, 'high'))
  assert.equal(overviewLink('#events?q=archive', 'critical'), '#overview?section=critical')
})

test('paging a queue after returning to the feed leaves the current anchor alone', () => {
  const href = '#overview?section=feed&page=2'
  const board = scopeQueueParams(new URLSearchParams(href.split('?')[1]), selectedQueue(href) ?? 'critical')
  board.set('high.page', '3')
  assert.equal(boardLink(board, overviewSection(href)), '#overview?section=feed&page=2&high.page=3')
})
