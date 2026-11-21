// Isolated, repeatable shift for the layout prototype. No actions reach the stand.
import {initialIncidents} from '../fixtures/shift.ts'
import {active, belongsToQueue, queueKeys, type Incident, type QueueKey} from '../../src/desk/types.ts'
import {incidentOrder} from '../../src/desk/order.ts'

export const start = Date.parse('2026-11-21T12:57:00+03:00')
export function clock(sec: number, seconds = true) {
  return new Date(start + sec * 1000 + 3 * 3600000).toISOString().slice(11, seconds ? 19 : 16)
}
const profiles = [
  ['МТС Маркет', 'Задержка подтверждения оплаты', 'Платежи'],
  ['МТС ID', 'Ошибка входа в личный кабинет', 'Идентификация'],
  ['KION', 'Прерывается видеотрансляция', 'Видеоплатформа'],
  ['МТС Линк', 'Потеря звука на встрече', 'Связь'],
  ['МТС Premium', 'Задержка активации подписки', 'Подписки'],
  ['МТС Cashback', 'Не обновился баланс кешбэка', 'Лояльность'],
]
const cities = ['Москва', 'Тула', 'Казань', 'Самара', 'Омск', 'Пермь', 'Ростов']
const originals = ['auth', 'video', 'incident'].map((key) => initialIncidents.find((i) => i.key === key)!)
export const canonicalIds = new Set(originals.map((i) => i.id))

function make(n: number, priority: number, research = false): Incident {
  const [product, title, team] = profiles[(n * 13 + Math.floor(n / 7)) % profiles.length]
  const id = 'INC' + String(32_000_000 + n).padStart(12, '0')
  const dueAt = start + (16 + ((n * 7) % 180)) * 60000
  return {
    key: id,
    id,
    product,
    title: title + ' · ' + cities[n % cities.length],
    priority,
    research,
    team: n % 11 === 0 ? 'Координаторы МИ' : team,
    state: research ? 'Исследование ситуации' : 'В работе',
    registered: clock(-1800 - (n % 60) * 60, false),
    registeredAt: start - (1800 + (n % 60) * 60) * 1000,
    due: research ? null : clock((dueAt - start) / 1000, false),
    dueAt: research ? null : dueAt,
  }
}
const baseline = [
  ...originals,
  ...Array.from({length: 476}, (_, i) => make(i, 4)),
  ...Array.from({length: 76}, (_, i) => make(500 + i, 3)),
  ...Array.from({length: 18}, (_, i) => make(600 + i, 2, true)),
]
export type Motion = {item: Incident; second: number; kind: 'in' | 'out'}
const movements: Motion[] = []
for (let n = 0; n < 300; n++) {
  const offset = Math.floor(n / 50) * 10
  const phase = ((n % 50) + 0.5) / 50
  const skew = [1.9, 0.65, 1.4, 0.48, 2.15, 0.94][Math.floor(n / 50)]
  const enter = offset + 0.05 + 9.9 * phase ** skew
  const exit = offset + 0.1 + 9.8 * phase ** (1 / skew)
  const item = make(1000 + n, 4)
  movements.push(
    {second: enter, kind: 'in', item: {...item, registered: clock(enter, false), registeredAt: start + enter * 1000}},
    {
      second: exit,
      kind: 'out',
      item: {
        ...baseline[3 + n],
        state: 'Завершён',
        restoredAt: clock(exit, false),
        solution: 'Восстановление подтверждено проверкой продукта.',
      },
    },
  )
}
movements.sort((a, b) => a.second - b.second || a.item.id.localeCompare(b.item.id))

export function sceneAt(second: number) {
  const feed = movements.filter((m) => m.second <= second)
  const records = new Map(baseline.map((i) => [i.id, i]))
  const ins = Array<number>(60).fill(0),
    outs = Array<number>(60).fill(0)
  let entered = 0,
    exited = 0
  const movement = Object.fromEntries(queueKeys.map(key => [key, {entered: 0, exited: 0}])) as
    Record<QueueKey, {entered: number; exited: number}>
  for (const m of feed) {
    const before = records.get(m.item.id)
    for (const key of queueKeys) {
      const was = belongsToQueue(before, key)
      const now = belongsToQueue(m.item, key)
      if (was !== now) movement[key][now ? 'entered' : 'exited']++
    }
    records.set(m.item.id, m.item)
    if (m.kind === 'in') {
      entered++
      ins[Math.ceil(m.second) - 1]++
    } else {
      exited++
      outs[Math.ceil(m.second) - 1]++
    }
  }
  const cards = [...records.values()].sort(incidentOrder)
  const groups = Object.fromEntries(
    queueKeys.map((k) => [k, cards.filter((i) => belongsToQueue(i, k))]),
  ) as Record<QueueKey, Incident[]>
  let total = 479
  const trend = [total, ...ins.slice(0, second).map((v, i) => (total += v - outs[i]))]
  const products = profiles
    .map(([name]) => ({
      name,
      active: groups.critical.filter((i) => i.product === name).length,
      entered: feed.filter((e) => e.kind === 'in' && e.item.product === name).length,
      exited: feed.filter((e) => e.kind === 'out' && e.item.product === name).length,
    }))
    .sort((a, b) => b.active - a.active)
  return {
    records,
    groups,
    movement,
    feed: feed.reverse(),
    ins,
    outs,
    trend,
    products,
    entered,
    exited,
    nearest: groups.critical.find((i) => active(i) && i.due),
  }
}
