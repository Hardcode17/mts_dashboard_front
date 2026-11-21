import type {Incident} from '../demoData'
const words = (value: string) => [...new Set(value.toLocaleLowerCase('ru').match(/[а-яёa-z0-9]{3,}/g) ?? [])]
const tokens = (i: Incident) => [
  ...words(i.title).map((w) => 't:' + w),
  'p:' + i.product,
  ...(i.service ? ['s:' + i.service] : []),
]
export function correlationIndex(incidents: Incident[]) {
  const index = new Map<string, Incident[]>()
  for (const i of incidents)
    for (const token of tokens(i)) {
      const list = index.get(token)
      if (list) list.push(i)
      else index.set(token, [i])
    }
  return index
}
export function similarIncidents(index: Map<string, Incident[]>, item: Incident, excluded?: ReadonlySet<string>) {
  const matches = new Map<string, {incident: Incident; score: number; reasons: string[]}>()
  for (const token of tokens(item))
    for (const other of index.get(token) ?? []) {
      if (other.key === item.key || other.absent || excluded?.has(other.key)) continue
      let hit = matches.get(other.key)
      if (!hit) {
        hit = {incident: other, score: 0, reasons: []}
        matches.set(other.key, hit)
      }
      const type = token.slice(0, 2)
      hit.score += type === 's:' ? 6 : type === 'p:' ? 3 : 2
      hit.reasons.push(
        (type === 's:' ? 'Сервис: ' : type === 'p:' ? 'Продукт: ' : 'Симптом: ') + token.slice(2),
      )
    }
  return [...matches.values()]
    .filter((x) => x.score >= 4)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(!!b.incident.restoredAt) - Number(!!a.incident.restoredAt) ||
        a.incident.id.localeCompare(b.incident.id),
    )
    .slice(0, 6)
}
