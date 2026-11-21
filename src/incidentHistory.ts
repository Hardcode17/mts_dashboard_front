export const historyFields = {
  state: 'Статус',
  team: 'Группа назначения',
  assignee: 'Исполнитель',
  priority: 'Приоритет',
  due: 'Срок решения',
  solution: 'Текст решения',
} as const

export type TrackedField = keyof typeof historyFields
type Values = Partial<Record<TrackedField, string | null>>

export interface CardRevision {
  observedAt: string
  changedAt?: string
  values: Values
}

// The first observation establishes a baseline. Omitted fields retain their last known value.
export function cardChanges(versions: readonly CardRevision[]) {
  const last: Values = {...versions[0]?.values}
  return versions.slice(1).flatMap(version => {
    const changes = (Object.keys(version.values) as TrackedField[]).flatMap(field => {
      const before = last[field]
      const after = version.values[field]
      if (after === undefined || before === after) return []
      last[field] = after
      return [{field, before, after}]
    })
    return changes.length ? [{...version, changes}] : []
  }).reverse()
}
