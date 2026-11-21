import {queueKeys, type QueueKey} from './types.ts'

type SummarySection = QueueKey | 'attention' | 'feed'

export function overviewSection(href: string): SummarySection | undefined {
  const path = href.split('?')[0]
  if (path !== '#overview' && path !== '#wall') return
  const key = new URLSearchParams(href.split('?')[1]).get('section')
  if (key === 'attention' || key === 'feed') return key
  return queueKeys.find(queue => queue === key)
}

export function selectedQueue(href: string): QueueKey | undefined {
  const section = overviewSection(href)
  return section === 'attention' || section === 'feed' ? undefined : section
}

// Existing bookmarks and saved presets use #queue/<key> with that queue's filters.
export function canonicalQueueRoute(href: string): string {
  const [path, query] = href.split('?')
  const section = queueKeys.find(key => path === '#queue/' + key)
  if (!section) return href
  const params = new URLSearchParams(query)
  params.set('section', section)
  return '#overview?' + params
}

export function scopeQueueParams(params: URLSearchParams, target: QueueKey) {
  const board = new URLSearchParams()
  for (const [key, value] of params) {
    if (key !== 'section') board.set(key.includes('.') ? key : target + '.' + key, value)
  }
  return board
}

export function boardLink(board: URLSearchParams, section?: SummarySection, surface: 'overview' | 'wall' = 'overview') {
  const params = new URLSearchParams()
  if (section) params.set('section', section)
  const prefix = (queueKeys.find(key => key === section) ?? 'critical') + '.'
  for (const [key, value] of board) params.set(key.startsWith(prefix) ? key.slice(prefix.length) : key, value)
  const query = params.toString()
  return '#' + surface + (query ? '?' + query : '')
}

// Changing where to read on the overview keeps the page and filters of every queue.
export function overviewLink(listing: string, section?: SummarySection) {
  const canonical = canonicalQueueRoute(listing)
  const [path, query] = canonical.split('?')
  const params = new URLSearchParams(path === '#overview' ? query : '')
  const board = scopeQueueParams(params, selectedQueue(canonical) ?? 'critical')
  return boardLink(board, section)
}

export function scrollToOverviewSection(key: SummarySection) {
  const target = document.getElementById(key === 'feed' || key === 'attention' ? key : 'section-' + key)
  target?.focus({preventScroll: true})
  target?.scrollIntoView({block: 'start'})
}

// Hash links to sections still scroll when the user follows the same link twice.
export function followOverviewAnchor(event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>, key?: QueueKey) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const path = location.hash.split('?')[0]
  if (path && path !== '#overview') return
  if (key) scrollToOverviewSection(key)
  else window.scrollTo(0, 0)
}
