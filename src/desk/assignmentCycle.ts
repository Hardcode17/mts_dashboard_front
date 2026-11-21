import type {Incident} from './types.ts'
import type {CardRevision} from '../incidentHistory.ts'

/** A loop is evidenced by distinct consecutive assignments ending at the current team. */
export function assignmentCycle(
  item: Pick<Incident, 'state' | 'team' | 'research' | 'restoredAt' | 'absent'>,
  versions: readonly CardRevision[],
): string[] | undefined {
  const closed = (state: string | null | undefined) =>
    state === 'Завершён' || state === 'Завершен' || state === 'Закрыт' || state === 'Исследование ситуации'
  if (item.absent || item.research || item.restoredAt || closed(item.state) || !item.team) return
  const path: string[] = []
  let finished = false
  for (const {values} of versions) {
    if (values.state !== undefined) {
      finished = closed(values.state)
      if (finished) path.length = 0
    }
    if (finished || values.team === undefined) continue
    const team = values.team?.trim()
    if (!team) path.length = 0
    else if (team !== path.at(-1)) path.push(team)
  }
  const current = item.team.trim()
  if (path.length < 3 || current !== path.at(-1)) return
  const previous = path.lastIndexOf(current, path.length - 2)
  return previous < 0 ? undefined : path.slice(previous)
}
