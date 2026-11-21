import type {Activity} from '../desk/queueActivity.ts'

// QueueMovement.at is the observation time; deadlines use the stand's business clock.
export function minuteSeries(criticalCount: number, activity: Activity, now: number) {
  const ins = Array<number>(60).fill(0),
    outs = Array<number>(60).fill(0)
  for (const movement of activity.movements) {
    const age = now - movement.at
    if (age >= 60000 || age < 0) continue
    const bucket = 59 - Math.floor(age / 1000)
    const counts = movement.entered ? ins : outs
    counts[bucket]++
  }
  let total = criticalCount - ins.reduce((a, b) => a + b, 0) + outs.reduce((a, b) => a + b, 0)
  return {ins, outs, trend: [total, ...ins.map((n, i) => (total += n - outs[i]))]}
}
