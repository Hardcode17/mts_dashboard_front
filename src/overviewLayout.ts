export const overviewBlocks = [
  {id: 'stats', title: 'Показатели очередей'},
  {id: 'charts', title: 'Динамика и сроки'},
  {id: 'critical', title: 'Ближайшие критические сроки'},
] as const

export type OverviewBlockId = typeof overviewBlocks[number]['id']
export type OverviewMoveDirection = -1 | 1

export const overviewBlockTitles: Record<OverviewBlockId, string> = {
  stats: 'Показатели очередей',
  charts: 'Динамика и сроки',
  critical: 'Ближайшие критические сроки',
}

export const defaultOverviewOrder: readonly OverviewBlockId[] = overviewBlocks.map(block => block.id)
export const overviewOrderStorageKey = 'mcc-overview-order'
const hiddenStorageKey = 'mcc-overview-hidden'

type OverviewOrderStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function browserStorage(): OverviewOrderStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function isOverviewBlockId(value: unknown): value is OverviewBlockId {
  return overviewBlocks.some(block => block.id === value)
}

export function normalizeOverviewOrder(value: unknown): OverviewBlockId[] {
  if (!Array.isArray(value)) return [...defaultOverviewOrder]
  const unique = value.filter(isOverviewBlockId).filter((id, index, list) => list.indexOf(id) === index)
  return unique.length === defaultOverviewOrder.length ? unique : [...defaultOverviewOrder]
}

export function parseOverviewOrder(raw: string | null | undefined): OverviewBlockId[] {
  if (!raw) return [...defaultOverviewOrder]
  try {
    return normalizeOverviewOrder(JSON.parse(raw))
  } catch {
    return [...defaultOverviewOrder]
  }
}

export function isDefaultOverviewOrder(order: readonly OverviewBlockId[]): boolean {
  return order.length === defaultOverviewOrder.length
    && order.every((id, index) => id === defaultOverviewOrder[index])
}

export function moveOverviewBlock(
  order: readonly OverviewBlockId[],
  id: OverviewBlockId,
  direction: OverviewMoveDirection,
): OverviewBlockId[] {
  const next = normalizeOverviewOrder(order)
  const from = next.indexOf(id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= next.length) return next
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export function readOverviewOrder(storage: OverviewOrderStorage | null = browserStorage()): OverviewBlockId[] {
  try {
    return parseOverviewOrder(storage?.getItem(overviewOrderStorageKey))
  } catch {
    return [...defaultOverviewOrder]
  }
}

export function saveOverviewOrder(
  order: readonly OverviewBlockId[],
  storage: OverviewOrderStorage | null = browserStorage(),
): OverviewBlockId[] {
  const normalized = normalizeOverviewOrder(order)
  try {
    if (isDefaultOverviewOrder(normalized)) storage?.removeItem(overviewOrderStorageKey)
    else storage?.setItem(overviewOrderStorageKey, JSON.stringify(normalized))
  } catch {
    // Storage can be unavailable in private previews; the in-memory order still works.
  }
  return normalized
}

export function readHiddenOverviewBlocks(storage: OverviewOrderStorage | null = browserStorage()): OverviewBlockId[] {
  try {
    const ids: unknown = JSON.parse(storage?.getItem(hiddenStorageKey) ?? '[]')
    return Array.isArray(ids) ? defaultOverviewOrder.filter(id => ids.includes(id)) : []
  } catch {
    return []
  }
}

export function saveHiddenOverviewBlocks(ids: readonly OverviewBlockId[], storage: OverviewOrderStorage | null = browserStorage()) {
  try {
    if (ids.length) storage?.setItem(hiddenStorageKey, JSON.stringify(ids))
    else storage?.removeItem(hiddenStorageKey)
  } catch {
    // The current view still works when browser storage is unavailable.
  }
}
