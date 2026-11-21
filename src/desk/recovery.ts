export type RecoveryProfile = 'database' | 'workers'
export const measures = ['Без изменений', 'Добавить реплику оплаты', 'Ограничить фоновую сверку'] as const
type Measure = (typeof measures)[number]

// A reproducible mock processing clock. All three alternatives receive the same batch of orders.
export function orderProfile(profile: RecoveryProfile, measure: Measure, input: number) {
  const workers = (profile === 'workers' ? 82 : 112) + (measure === measures[1] ? 32 : 0)
  const database = (profile === 'database' ? 82 : 122) + (measure === measures[2] ? 16 : 0)
  const elapsed = []
  let workerFree = 0,
    dbFree = 0
  for (let n = 0; n < input; n++) {
    const jitter = 1 + (((n * 7) % 9) - 4) / 100
    workerFree += (30000 / workers) * jitter
    dbFree = Math.max(dbFree, workerFree) + (30000 / database) * (2 - jitter)
    elapsed.push(Math.round(dbFree))
  }
  return {
    elapsed,
    expected: Math.min(input, workers, database),
    bottleneck: workers <= database ? 'Обработчики платежей' : 'База данных',
  }
}
export function recoveryTrial(profile: RecoveryProfile, measure: Measure, input = 100) {
  const size = Math.min(500, Math.max(1, Math.floor(input)))
  const {elapsed, expected, bottleneck} = orderProfile(profile, measure, size)
  return {
    measure,
    profile,
    input: size,
    expected,
    actual: elapsed.filter((ms) => ms <= 30000).length,
    bottleneck,
    p95: elapsed[Math.ceil(size * 0.95) - 1],
    background: measure === measures[2] ? 12 : 0,
  }
}
