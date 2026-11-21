import type {CardRevision} from '../src/incidentHistory.ts'
import {moscowTime, type Incident, type ShiftEvent} from '../src/desk/types.ts'

export const snapshotTime = '12:42'

const sampleIncidents: Incident[] = [
  {key: 'auth', id: 'INC000021940126', product: 'МТС ID', title: 'Недоступна авторизация клиентов', registered: '12:22', due: '13:02', priority: 4, team: 'Команда авторизации', state: 'Назначен', research: false},
  {key: 'video', id: 'INC000021940127', product: 'KION', title: 'Прерывается просмотр трансляций', registered: '12:41', due: '13:08', priority: 4, team: 'Поддержка видео', state: 'Назначен', research: false},
  {key: 'incident', id: 'INC000021940112', product: 'МТС Маркет', title: 'Задержка подтверждения оплаты', registered: '12:19', due: '13:10', priority: 4, team: 'Координаторы МИ', state: 'В работе', research: false, assignedAt: '12:31', assignee: 'Анна Котова'},
  {key: 'access', id: 'INC000021940087', product: 'МТС ID', title: 'Ошибка входа в профиль', registered: '12:15', due: '13:35', priority: 2, team: 'Координаторы МИ', state: 'Назначен', research: false, assignedAt: '12:18'},
  {key: 'kion', id: 'INC000021940098', product: 'KION', title: 'Долгий запуск трансляции', registered: '12:17', due: '13:20', priority: 3, team: 'Поддержка видео', state: 'В работе', research: false},
  {key: 'premium', id: 'INC000021940083', product: 'МТС Premium', title: 'Задержка активации подписки', registered: '12:12', due: '14:00', priority: 3, team: 'Поддержка подписок', state: 'В работе', research: false},
  {key: 'delivery', id: 'INC000021939981', product: 'МТС Линк', title: 'Повторная доставка уведомлений', registered: '11:10', due: null, priority: 3, team: 'Команда уведомлений', state: 'Исследование ситуации', research: true, restoredAt: '11:54', solution: 'Повторная доставка уведомлений устранена.'},
  {key: 'balance', id: 'INC000021939947', product: 'МТС Cashback', title: 'Расхождение баланса кешбэка', registered: '10:54', due: null, priority: 2, team: 'Поддержка лояльности', state: 'Исследование ситуации', research: true, restoredAt: '11:28'},
]

export const additionalIncidents: Incident[] = [
  {key: 'cash', id: 'INC000021940128', product: 'МТС Cashback', title: 'Не проходит списание кешбэка', registered: snapshotTime, due: '13:15', priority: 4, team: 'Поддержка лояльности', state: 'Назначен', research: false},
  {key: 'messages', id: 'INC000021940129', product: 'МТС Сообщения', title: 'Не доставляются коды входа', registered: snapshotTime, due: '13:18', priority: 4, team: 'Команда доставки', state: 'Назначен', research: false},
  {key: 'orders', id: 'INC000021940130', product: 'МТС Маркет', title: 'Заказы остаются без подтверждения', registered: snapshotTime, due: '13:20', priority: 4, team: 'Команда заказов', state: 'Назначен', research: false},
]

const sampleEvents: ShiftEvent[] = [
  {id: 'deadline-auth', time: snapshotTime, kind: 'due', key: 'auth', change: 'До срока решения осталось 20 минут.'},
  {id: 'new-video', time: '12:41', kind: 'new', key: 'video', change: 'Прерывается просмотр трансляций.'},
  {id: 'assign-market', time: '12:31', kind: 'assign', key: 'incident', change: 'Сбой оплаты назначен на координаторов.'},
  {id: 'new-auth', time: '12:22', kind: 'new', key: 'auth', change: 'Клиенты не могут войти в профиль.'},
  {id: 'restore-link', time: '11:54', kind: 'restore', key: 'delivery', change: 'Повторная доставка уведомлений устранена.'},
]

const services = [
  {product: 'МТС ID', team: 'Команда авторизации', problems: ['Задерживается выпуск токена', 'Ошибка входа в профиль', 'Не приходит код подтверждения']},
  {product: 'МТС Маркет', team: 'Поддержка платежей', problems: ['Оплата ожидает подтверждения', 'Ошибка оформления заказа', 'Каталог обновляется с задержкой']},
  {product: 'KION', team: 'Поддержка видео', problems: ['Замедлился запуск трансляции', 'Не загружается каталог', 'Снижается качество воспроизведения']},
  {product: 'МТС Premium', team: 'Поддержка подписок', problems: ['Задержка активации подписки', 'Не обновляется тариф', 'Ошибка продления подписки']},
  {product: 'МТС Линк', team: 'Команда коммуникаций', problems: ['Не проходит подключение к встрече', 'Задержка доставки сообщения', 'Недоступна запись встречи']},
  {product: 'МТС Cashback', team: 'Поддержка лояльности', problems: ['Расхождение баланса', 'Задержка начисления кешбэка', 'Списание остаётся в обработке']},
  {product: 'Мой МТС', team: 'Мобильные сервисы', problems: ['Профиль загружается с задержкой', 'Не видны подключённые услуги', 'Не обновляется остаток пакета']},
]
const regions = ['Москва', 'Поволжье', 'Урал', 'Сибирь', 'Северо-Запад', 'Юг', 'Дальний Восток', 'Центр', 'Северный Кавказ']

function clockTime(minutes: number) {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0')
  return hours + ':' + String(minutes % 60).padStart(2, '0')
}

function makeShiftSnapshot() {
  const incidents = [...sampleIncidents]
  const events = [...sampleEvents]
  const history = new Map<string, CardRevision[]>()

  // These ITSM revisions are part of the same demo scenario as the shift events.
  for (const item of sampleIncidents) {
    const versions: CardRevision[] = [{observedAt: item.registered, values: {}}]
    if (item.assignedAt) versions.push({changedAt: item.assignedAt, observedAt: item.assignedAt, values: {team: item.team}})
    if (item.restoredAt) versions.push({changedAt: item.restoredAt, observedAt: item.restoredAt, values: {state: 'Завершён'}})
    if (item.research) versions.push({observedAt: snapshotTime, values: {state: item.state}})
    history.set(item.key, versions)
  }
  history.set('incident', [
    {observedAt: '12:19', values: {state: 'Назначен', team: 'Команда платежей', due: '13:19', assignee: null}},
    {changedAt: '12:23', observedAt: '12:24', values: {state: 'В работе'}},
    {observedAt: '12:29', values: {due: '13:10'}},
    {changedAt: '12:31', observedAt: '12:31', values: {team: 'Координаторы МИ', assignee: 'Анна Котова'}},
  ])
  history.set('delivery', [
    {observedAt: '11:10', values: {state: 'В работе', solution: null}},
    {changedAt: '11:54', observedAt: '11:54', values: {state: 'Завершён', solution: 'Повторная доставка уведомлений устранена.'}},
    {changedAt: '12:04', observedAt: '12:04', values: {state: 'Исследование ситуации'}},
  ])

  for (let index = 0; incidents.length < 3600; index++) {
    // Each cycle includes open, restored, routed and post-incident cases.
    const scenario = index % 8
    const cycle = Math.floor(index / 8)
    const service = services[index % services.length]
    const title = service.problems[cycle % service.problems.length] + ' · ' + regions[Math.floor(cycle / 3) % regions.length]
    const key = 'shift-' + (index + 1)
    const start = 6 * 60 + (index * 13) % 275
    const restored = scenario >= 3
    const research = restored && scenario < 7
    // The first 27 routed research cases supply the final 27 escalations in the 14,400-event fixture.
    const escalated = scenario === 0 || scenario === 3 || scenario >= 5 || (scenario === 4 && cycle < 27)
    const routedForResearch = scenario === 4 || scenario === 5
    const coordinator = routedForResearch || (!restored && cycle % 3 === 0)
    const assignedAt = coordinator ? clockTime(start + (routedForResearch ? 60 : 2)) : undefined
    const priority = escalated ? 4 : scenario === 1 || scenario === 4 ? 3 : 2
    const restoredAt = restored ? clockTime(start + 52) : undefined
    incidents.push({
      key, id: 'INC' + String(22_000_001 + index).padStart(12, '0'), product: service.product,
      title, team: coordinator ? 'Координаторы МИ' : service.team,
      state: research ? 'Исследование ситуации' : restored ? 'Завершён' : coordinator ? 'Назначен' : 'В работе',
      registered: clockTime(start), due: restored ? null : clockTime(13 * 60 + 11 + (index * 17) % 360),
      priority, research, assignedAt, restoredAt,
    })

    function log(kind: ShiftEvent['kind'], afterMinutes: number, change: string) {
      events.push({id: key + '-' + kind + '-' + afterMinutes, key, kind, time: clockTime(start + afterMinutes), change})
    }
    log('assign', 2, 'Карточка поступила координаторам для маршрутизации.')
    if (escalated) log('new', 5, 'Приоритет повышен до критического. ' + title + '.')
    if (restored) {
      log('due', 25, 'До срока решения осталось 30 минут.')
      log('due', 45, 'До срока решения осталось 10 минут.')
      if (scenario >= 6) log('due', 50, 'До срока решения осталось 5 минут.')
      log('restore', 52, 'Команда подтвердила восстановление сервиса.')
    }
    if (routedForResearch) log('assign', 60, 'Исследование причин назначено на координаторов.')

    const versions: CardRevision[] = [{observedAt: clockTime(start), values: {
      state: 'Назначен', team: null, priority: escalated ? '3' : String(priority),
    }}]
    function revise(afterMinutes: number, values: CardRevision['values']) {
      const time = clockTime(start + afterMinutes)
      versions.push({changedAt: time, observedAt: time, values})
    }
    revise(2, {team: 'Координаторы МИ'})
    if (!coordinator || routedForResearch) revise(4, {team: service.team, state: 'В работе'})
    if (escalated) revise(5, {priority: '4'})
    if (restored) revise(52, {state: 'Завершён'})
    if (research) revise(56, {state: 'Исследование ситуации'})
    if (routedForResearch) revise(60, {team: 'Координаторы МИ'})
    history.set(key, versions)
  }
  events.sort((left, right) => right.time.localeCompare(left.time))
  return {incidents, events, history}
}

const shift = makeShiftSnapshot()
export const initialIncidents = shift.incidents
export const initialEvents = shift.events
export const incidentRevisions: ReadonlyMap<string, readonly CardRevision[]> = shift.history

function minuteOfDay(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function fixtureTime(started: number, value: string): number {
  return Math.floor(started / 60_000) * 60_000 + (minuteOfDay(value) - minuteOfDay(snapshotTime)) * 60_000
}

function makeVolumeFixture(started: number) {
  const at = (value: string) => fixtureTime(started, value)
  const iso = (value: string) => new Date(at(value)).toISOString()
  const records: Record<string, Incident> = Object.fromEntries(initialIncidents.map((item) => {
    const registeredAt = at(item.registered)
    const dueAt = item.due === null ? null : at(item.due)
    const assignedEpoch = item.assignedAt === undefined ? undefined : at(item.assignedAt)
    const restoredEpoch = item.restoredAt === undefined ? undefined : at(item.restoredAt)
    return [item.key, {
      ...item,
      registeredAt,
      registered: moscowTime(registeredAt),
      dueAt,
      due: dueAt === null ? null : moscowTime(dueAt),
      assignedEpoch,
      assignedAt: assignedEpoch === undefined ? undefined : moscowTime(assignedEpoch),
      restoredEpoch,
      restoredAt: restoredEpoch === undefined ? undefined : moscowTime(restoredEpoch),
    }]
  }))
  const revisions: Record<string, CardRevision[]> = Object.fromEntries(Array.from(incidentRevisions, ([key, versions]) => [
    key,
    versions.map(({observedAt, changedAt, values}) => ({
      observedAt: iso(observedAt),
      changedAt: changedAt === undefined ? undefined : iso(changedAt),
      values: {...values, due: typeof values.due === 'string' ? iso(values.due) : values.due},
    })),
  ]))
  const events = initialEvents.map((event) => {
    const stamp = at(event.time)
    return {...event, at: stamp, time: moscowTime(stamp)}
  })
  return {records, revisions, events}
}

// Store only deviations in SQLite. Give each mock instance a common real-time
// anchor for its sample cards, events and revisions when materializing the reply.
let cached: {started: number; fixture: ReturnType<typeof makeVolumeFixture>} | undefined
export function volumeFixture(started: number): ReturnType<typeof makeVolumeFixture> {
  if (cached?.started !== started) cached = {started, fixture: makeVolumeFixture(started)}
  return cached.fixture
}
