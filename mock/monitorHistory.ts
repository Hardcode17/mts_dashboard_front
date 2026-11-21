import type {Incident} from '../src/demoData.ts'
import {belongsToQueue, standNow, type Desk} from '../src/desk/types.ts'

const step = 5 * 60_000
export function sampleMonitorHistory(d: Desk, cards: () => Incident[], now: number) {
  if (d.sourceError || (d.mode === 'case' && !d.lastImport)) return false
  const stamp = standNow(d, now)
  const bucket = Math.floor(stamp / step)
  const last = d.monitorHistory?.at(-1)
  if (last && Math.floor(Date.parse(last.at) / step) >= bucket) return false
  const point = {at: new Date(stamp).toISOString(), critical: 0, high: 0, coordinators: 0, research: 0}
  for (const i of cards()) {
    if (belongsToQueue(i, 'critical')) point.critical++
    if (belongsToQueue(i, 'high')) point.high++
    if (belongsToQueue(i, 'assigned')) point.coordinators++
    if (belongsToQueue(i, 'research')) point.research++
  }
  d.monitorHistory = [...(d.monitorHistory ?? []).filter((p) => Date.parse(p.at) > stamp - 86400000), point]
  return true
}
