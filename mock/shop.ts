import {randomUUID} from 'node:crypto'
import {measures, orderProfile, type RecoveryProfile} from '../src/desk/recovery.ts'

export function shopStand() {
  const runs = new Map<
    string,
    {
      at: number
      profile: RecoveryProfile
      input: number
      legs: {elapsed: number[]; expected: number; bottleneck: string; seen: Set<number>}[]
    }
  >()
  return {
    start(profile: RecoveryProfile, input: number, now: number) {
      if (!Number.isInteger(input) || input < 1 || input > 500) throw Error('Нагрузка: 1–500 заказов.')
      for (const [id, run] of runs) if (now - run.at > 600000) runs.delete(id)
      if (runs.size >= 30) throw Error('Слишком много незавершённых прогонов. Повторите позже.')
      const id = randomUUID()
      runs.set(id, {
        at: now,
        profile,
        input,
        legs: measures.map((m) => ({...orderProfile(profile, m, input), seen: new Set()})),
      })
      return id
    },
    order(id: string, leg: number, order: number) {
      const run = runs.get(id),
        stage = run?.legs[leg]
      if (
        !run ||
        !Number.isInteger(leg) ||
        !stage ||
        !Number.isInteger(order) ||
        order < 0 ||
        order >= run.input
      )
        throw Error('Неизвестный заказ или прогон.')
      stage.seen.add(order)
      return {order, elapsedMs: stage.elapsed[order], inTime: stage.elapsed[order] <= 30000}
    },
    finish(id: string) {
      const run = runs.get(id)
      if (!run || run.legs.some((l) => l.seen.size !== run.input)) throw Error('Прогон неполон.')
      const text = run.legs.map((leg, i) => {
        const actual = [...leg.seen].filter((n) => leg.elapsed[n] <= 30000).length
        return (
          measures[i] +
          ': прогноз ' +
          leg.expected +
          ', факт ' +
          actual +
          ' из ' +
          leg.seen.size +
          ' уникальных заказов в срок. Ограничение: ' +
          leg.bottleneck +
          '; рост фоновой очереди ' +
          (i === 2 ? 12 : 0) +
          '/мин.'
        )
      })
      return {
        text:
          'Профиль: ' +
          (run.profile === 'workers' ? 'обработчики' : 'БД') +
          ' · нагрузка ' +
          run.input +
          ' заказов/мин · SLA 30 с.\n' +
          text.join('\n'),
        release: () => runs.delete(id),
      }
    },
  }
}
