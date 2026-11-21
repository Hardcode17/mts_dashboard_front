import type {Incident} from './desk/types'

export type TrendPeriod = 'shift' | 'hour'

function minuteOfDay(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
}

function clockTime(minute: number) {
  return String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0')
}

export function incidentTrend(incidents: Incident[], asOf: string, period: TrendPeriod, epoch?:number) {
  const now = minuteOfDay(asOf)
  const sameDay=(stamp:number|undefined)=>epoch===undefined||stamp===undefined||Math.floor((epoch+10800000)/86400000)===Math.floor((stamp+10800000)/86400000)
  const step = period === 'hour' ? 10 : 30
  const first = period === 'hour' ? Math.max(0, now - 59) :
    Math.floor(incidents.reduce((min, item) => sameDay(item.registeredAt)?Math.min(min, minuteOfDay(item.registered)):min, now) / step) * step
  const bins = Array.from({length: Math.floor((now - first) / step) + 1}, (_, i) => ({
    label: clockTime(first + i * step), registered: 0, restored: 0,
  }))
  function count(time: string, key: 'registered' | 'restored') {
    const minute = minuteOfDay(time)
    if (minute >= first && minute <= now) bins[Math.floor((minute - first) / step)][key]++
  }
  for (const incident of incidents) {
    if(sameDay(incident.registeredAt))count(incident.registered, 'registered')
    if (incident.restoredAt && sameDay(incident.restoredEpoch)) count(incident.restoredAt, 'restored')
  }
  return bins
}

export function remainingMinutes(due: string | null, asOf: string) {
  return due === null ? null : minuteOfDay(due) - minuteOfDay(asOf)
}

export function deadlineDistribution(critical: Incident[], asOf: string, epoch?:number) {
  const counts = [0, 0, 0, 0, 0, 0]
  for (const item of critical) {
    const left = epoch!==undefined&&item.dueAt!=null?Math.ceil((item.dueAt-epoch)/60000):remainingMinutes(item.due, asOf)
    const bucket = left === null ? 5 : left < 0 ? 0 : left <= 30 ? 1 : left <= 60 ? 2 : left <= 180 ? 3 : 4
    counts[bucket]++
  }
  const labels = ['Просрочены', 'До 30 мин', '31–60 мин', '1–3 ч', 'Более 3 ч', 'Без срока']
  return counts.map((value, i) => ({label: labels[i], value}))
}
