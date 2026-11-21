import {assignmentCycle} from '../desk/assignmentCycle.ts'
import {dueInstant, type Desk, type Attempt, type Task, type Signal, type Incident} from '../desk/types.ts'
import type {OutageGroup} from '../desk/outageGroups.ts'

export const groupHref = (id: string) => '#attention?group=' + encodeURIComponent(id)

export interface AttentionRow {
  id: string
  group: OutageGroup
  title: string
  members: Incident[]
  serviceCount: number
  productCount: number
  deadline: number | null
  priority: number
  ownerState: 'unclaimed' | 'waiting' | 'owned'
  ownerLabel: string
  acceptedAt?: number
  reason: string
  cycle?: {item: Incident; teams: string[]}
}

const svcForms = new Intl.PluralRules('ru')

export function serviceCount(row: AttentionRow) {
  const n = row.serviceCount || row.productCount
  const forms = row.serviceCount ? ['сервис', 'сервиса', 'сервисов'] : ['продукт', 'продукта', 'продуктов']
  const form = svcForms.select(n)
  return n + ' ' + forms[form === 'one' ? 0 : form === 'few' ? 1 : 2]
}

function liveAttempt(task?: Task) {
  const attempt = task?.attempts.at(-1)
  return task && !task.finished && attempt && !attempt.ended ? attempt : undefined
}

function ownership(
  group: OutageGroup | undefined,
  attempt: Attempt | undefined,
  people: Desk['people'],
): Pick<AttentionRow, 'ownerState' | 'ownerLabel'> {
  // One person's acceptance belongs to the individual INC, not to a multi-INC group.
  const individual = !group || (group.method === 'single' && group.members.length === 1) ? attempt : undefined
  const owner = group?.owner ?? (individual?.accepted ? individual.person : undefined)
  const personName = (id: string) => people.find((p) => p.id === id)?.name ?? id
  if (owner) return {ownerState: 'owned', ownerLabel: 'Ведёт ' + personName(owner)}
  if (individual)
    return {ownerState: 'waiting', ownerLabel: 'Ожидает принятия · ' + personName(individual.person)}
  return {ownerState: 'unclaimed', ownerLabel: 'Никто не взял'}
}

export function cardCoordination(desk: Desk, item: Incident): {group?: OutageGroup; ownerLabel: string} {
  const group = desk.outageGroups?.find((g) => g.members.includes(item.key))
  const task = desk.tasks.find((t) => !t.finished && t.key === item.key)
  if (!group && !task) return {ownerLabel: 'Активной задачи нет'}
  return {group, ownerLabel: ownership(group, liveAttempt(task), desk.people).ownerLabel}
}

export function queueOwnerLabels(desk: Desk): Map<string, string> {
  const labels = new Map<string, string>()
  const assignments = new Map<string, Attempt>()
  for (const task of desk.tasks) {
    if (task.finished) continue
    const attempt = liveAttempt(task)
    if (attempt) assignments.set(task.key, attempt)
    labels.set(task.key, ownership(undefined, attempt, desk.people).ownerLabel)
  }
  for (const group of desk.outageGroups ?? []) {
    const label = ownership(group, assignments.get(group.members[0]), desk.people).ownerLabel
    for (const key of group.members) labels.set(key, label)
  }
  return labels
}

export function buildAttentionRows(desk: Desk, incidents: readonly Incident[]): AttentionRow[] {
  const byKey = new Map(incidents.map((i) => [i.key, i]))
  const assignments = new Map(
    desk.tasks.flatMap((task) => {
      const attempt = liveAttempt(task)
      return attempt ? [[task.key, attempt] as const] : []
    }),
  )
  const rows: AttentionRow[] = []
  for (const group of desk.outageGroups ?? []) {
    const members = group.members.map((key) => byKey.get(key)).filter((i) => i !== undefined)
    if (!members.length) continue
    const {ownerState, ownerLabel} = ownership(group, assignments.get(members[0].key), desk.people)
    let deadline: number | null = null
    let priority = 0
    let cycle: AttentionRow['cycle']
    const products = new Set<string>(),
      services = new Set<string>()
    for (const i of members) {
      if (i.product) products.add(i.product)
      if (i.service) services.add(i.service)
      const at = dueInstant(i)
      if (at != null && Number.isFinite(at) && (deadline == null || at < deadline)) deadline = at
      priority = Math.max(priority, i.priority)
      const versions = desk.revisions[i.key]
      if (!cycle && versions) {
        const teams = assignmentCycle(i, versions)
        if (teams) cycle = {item: i, teams}
      }
    }
    rows.push({
      id: group.id,
      group,
      title: group.title,
      members,
      serviceCount: services.size,
      productCount: products.size,
      deadline,
      priority,
      ownerState,
      ownerLabel,
      acceptedAt: group.acceptedAt ?? (group.method === 'single' ? assignments.get(members[0].key)?.accepted : undefined),
      cycle,
      reason: cycle ? 'Возврат назначения: ' + cycle.teams.join(' → ') : (group.evidence[0] ?? ''),
    })
  }
  const order = {unclaimed: 0, waiting: 1, owned: 2}
  return rows.sort(
    (a, b) =>
      order[a.ownerState] - order[b.ownerState] ||
      b.priority - a.priority ||
      (a.deadline ?? Infinity) - (b.deadline ?? Infinity) ||
      Number(!!b.cycle) - Number(!!a.cycle) ||
      b.members.length - a.members.length ||
      a.id.localeCompare(b.id),
  )
}

export function wallHighlights(rows: readonly AttentionRow[], signals: readonly Signal[]) {
  const waiting = new Map<string, AttentionRow>()
  let taken: AttentionRow | undefined
  for (const row of rows) {
    if (row.ownerState === 'owned') {
      if (!taken || (row.acceptedAt ?? 0) > (taken.acceptedAt ?? 0)) taken = row
    } else {
      for (const item of row.members) waiting.set(item.key, row)
    }
  }
  // Signals are appended on import. Acknowledging a signal does not claim its outage.
  let signal: Signal | undefined
  for (let i = signals.length - 1; i >= 0; i--) {
    const row = waiting.get(signals[i].key)
    if (row && signals[i].at >= row.group.createdAt) {
      signal = signals[i]
      break
    }
  }
  const newest = signal && waiting.get(signal.key)
  const visible = new Set<AttentionRow>()
  for (const row of [rows[0], newest, taken, ...rows.slice(0, 3)]) {
    if (row && visible.size < 3) visible.add(row)
  }
  return {visible: [...visible], newest, signal}
}
