import {additionalIncidents, initialIncidents, incidentRevisions, type Incident} from '../src/demoData.ts'
import {
  active,
  belongsToQueue,
  queueKeys,
  queueWindowMs,
  channels,
  coordinatorGroup,
  dueInstant,
  emptyWork,
  moscowTime,
  onCoordinators,
  standNow,
  states,
  type Desk,
  type Source,
  type Command,
  type Task,
  type Channel,
} from '../src/desk/types.ts'
import type {CardRevision, TrackedField} from '../src/incidentHistory.ts'
import {analyzeDemoIncident} from '../src/agentDemo.ts'
import {recoveryTrial, measures} from '../src/desk/recovery.ts'
import {parseSnapshot} from './snapshot.ts'
import {editOutageGroup, reconcileGroups} from './incidentGroups.ts'

const base = new Map(initialIncidents.map((i) => [i.key, i]))
export function lookup(d: Desk, key: string) {
  return Object.hasOwn(d.records, key) ? d.records[key] : d.mode === 'volume' ? base.get(key) : undefined
}
export function items(d: Desk) {
  return d.mode === 'case'
    ? Object.values(d.records)
    : [
        ...initialIncidents.map((x) => d.records[x.key] ?? x),
        ...Object.values(d.records).filter((x) => !base.has(x.key)),
      ]
}
const uid = (d: Desk) => String(++d.seq)
const time = (d: Desk, now: number) => moscowTime(standNow(d, now))
function required(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20000)
    throw Error('Проверьте поле «' + label + '».')
  return value.trim()
}
function ensure(value: unknown, message: string): asserts value {
  if (!value) throw Error(message)
}
const target = (d: Desk, key: unknown) => {
  const i = typeof key === 'string' ? lookup(d, key) : undefined
  ensure(i, 'Карточка не найдена.')
  return i
}
const requestChannels = (list: unknown): Channel[] => {
  ensure(Array.isArray(list) && list.every((c) => channels.includes(c)), 'Неизвестный канал.')
  return [...new Set(list)]
}
function deliveries(
  d: Desk,
  key: string,
  recipient: string,
  text: string,
  now: number,
  selected = d.enabled,
  attempt?: string,
) {
  for (const channel of selected)
    d.notices.unshift({
      id: uid(d),
      key,
      recipient,
      text,
      channel,
      at: now,
      status: d.failedChannels.includes(channel) ? 'Ошибка' : 'Доставлено',
      tries: 1,
      attempt,
    })
}
function enqueue(d: Desk, key: string, now: number) {
  if (!d.tasks.some((t) => t.key === key && t.finished === undefined))
    d.tasks.push({key, opened: now, attempts: []})
}
function closeTask(t: Task, reason: string, now: number) {
  t.finished = now
  const a = t.attempts.at(-1)
  if (a && a.ended === undefined) {
    a.ended = now
    a.reason = reason
  }
}
export function dispatchTasks(d: Desk, now: number) {
  let changed = false
  const busy = new Set<string>()
  for (const task of d.tasks) {
    if (task.finished !== undefined) continue
    const attempt = task.attempts.at(-1)
    if (!attempt || attempt.ended !== undefined) continue
    if (attempt.deadline !== null && attempt.accepted === undefined && attempt.deadline <= now) {
      attempt.ended = attempt.deadline
      attempt.reason = 'Нет реакции'
      changed = true
    } else busy.add(attempt.person)
  }
  const free = d.people.filter((p) => p.available && !busy.has(p.id))
  if (!free.length) return changed
  for (const task of d.tasks) {
    if (task.finished !== undefined) continue
    const last = task.attempts.at(-1)
    if (last && last.ended === undefined) continue
    const i = lookup(d, task.key)
    if (!i || !onCoordinators(i)) continue
    const pos = free.findIndex(
      (p) =>
        p.group === coordinatorGroup &&
        !task.attempts.some(
          (a) => a.person === p.id && a.reason === 'Нет реакции' && a.generation === p.generation,
        ),
    )
    if (pos === -1) continue
    const [p] = free.splice(pos, 1),
      id = uid(d)
    task.attempts.push({
      id,
      person: p.id,
      generation: p.generation,
      assigned: now,
      deadline: active(i) && i.priority === 4 ? now + 60000 : null,
    })
    deliveries(d, i.key, p.id, 'Примите задачу на распределение: ' + i.id, now, d.enabled, id)
    changed = true
    if (!free.length) break
  }
  return changed
}
const values = (i: Incident): CardRevision['values'] => ({
  state: i.state,
  team: i.team,
  assignee: i.assignee ?? null,
  priority: String(i.priority),
  due: i.dueAt != null ? new Date(i.dueAt).toISOString() : i.due,
  solution: i.solution ?? null,
})
function appendEvent(
  d: Desk,
  i: Incident,
  kind: 'new' | 'assign' | 'restore' | 'due',
  change: string,
  now: number,
) {
  const id = uid(d)
  d.events.unshift({id: 'obs-' + id, at: standNow(d, now), key: i.key, time: time(d, now), kind, change})
  if (kind === 'new') d.signals.push({id, key: i.key, at: now})
  deliveries(d, i.key, 'shift', change + ' · ' + i.id, now)
}
function openCritical(i: Incident) {
  return active(i) && i.priority === 4
}
function recordMembership(d: Desk, old: Incident | undefined, item: Incident, now: number) {
  for (const queue of queueKeys) {
    const entered = belongsToQueue(item, queue)
    if (entered === belongsToQueue(old, queue)) continue
    let reason: string
    if (item.absent) reason = 'Отсутствует в снимке'
    else if (!old) reason = 'Новый INC'
    else if (old.absent) reason = 'Снова в снимке'
    else if (active(old) && !active(item)) reason = 'Сбой устранён'
    else if (!active(old) && active(item)) reason = 'Возврат в работу'
    else if (old.priority !== item.priority && (queue === 'high' || queue === 'critical')) reason = 'Изменение приоритета'
    else if (queue === 'assigned') reason = 'Смена назначения'
    else reason = 'Смена статуса'
    const movements = d.movements ??= []
    movements.push({id: uid(d), key: item.key, queue, at: now, entered, reason})
  }
}
export function applyCard(d: Desk, incoming: Incident, now: number) {
  const changed = applyCardChange(d,incoming,now)
  if (changed) reconcileGroups(d,items(d),now)
  return changed
}
function applyCardChange(d: Desk, incoming: Incident, now: number) {
  const old = lookup(d, incoming.key)
  if (incoming.parentId === undefined && old?.parentId) incoming = {...incoming, parentId:old.parentId}
  if (old) {
    for (const key of ['meetingUrl', 'itsmUrl', 'itsmDemo'] as const) {
      if (incoming[key] === undefined && old[key] !== undefined) incoming = {...incoming, [key]: old[key]}
    }
  }
  const comparable = (i: Incident) => JSON.stringify({...i, updatedAt: undefined, absent: undefined})
  if (old && !old.absent && comparable(old) === comparable(incoming)) return false
  const item = {...incoming, updatedAt: Math.max(now, (old?.updatedAt ?? 0) + 1), absent: false}
  const before = old ? values(old) : {},
    after = values(item)
  const fields = (Object.keys(after) as TrackedField[]).filter((k) => before[k] !== after[k])
  const observedAt = new Date(now).toISOString()
  const history = (d.revisions[item.key] ??=
    d.mode === 'volume' ? [...(incidentRevisions.get(item.key) ?? [])] : [])
  if (old && !history.length) history.push({observedAt: old.registered, values: before})
  if (!old || !openCritical(item) || !old.due || old.due !== item.due) delete d.warnings[item.key]
  if (!old) history.push({observedAt, values: after})
  else if (fields.length) {
    const changes = new Map<number | undefined, CardRevision['values']>()
    for (const field of fields) {
      const assignment =
        (field === 'team' || field === 'assignee') && item.assignedEpoch !== old.assignedEpoch
      const completed =
        field === 'state' && item.state === 'Завершён' && item.restoredEpoch !== old.restoredEpoch
      const stamp = assignment ? item.assignedEpoch : completed ? item.restoredEpoch : undefined
      const patch = changes.get(stamp) ?? {}
      patch[field] = after[field]
      changes.set(stamp, patch)
    }
    for (const [stamp, patch] of changes)
      history.push({
        observedAt,
        changedAt: stamp === undefined ? undefined : new Date(stamp).toISOString(),
        values: patch,
      })
  }
  recordMembership(d, old, item, now)
  d.records[item.key] = item
  d.lastChanges.unshift({
    id: item.id,
    fields: !old ? ['Новая карточка'] : fields.length ? fields : ['Атрибуты карточки'],
  })
  if (openCritical(item) && (!old || !openCritical(old)))
    appendEvent(d, item, 'new', 'Новый критический: ' + item.title, now)
  if (onCoordinators(item) && (!old || !onCoordinators(old))) {
    appendEvent(d, item, 'assign', 'Назначен на координаторов', now)
    enqueue(d, item.key, now)
  }
  if (old && active(old) && !active(item))
    appendEvent(d, item, 'restore', 'Сбой устранён: ' + item.title, now)
  if (!onCoordinators(item))
    for (const task of d.tasks)
      if (task.key === item.key && task.finished === undefined)
        closeTask(task, active(item) || item.research
          ? (item.team ? 'Передано: ' + item.team : 'Снято назначение в ITSM')
          : 'Завершено в ITSM', now)
  return true
}
export function applySnapshot(d: Desk, raw: unknown, now: number) {
  const incoming = parseSnapshot(raw)
  const first = d.lastImport === 0
  const seen = new Set(incoming.map((i) => i.key))
  let changed = false
  const last = d.lastChanges
  d.lastChanges = []
  for (const item of incoming) {
    if (first) {
      d.records[item.key] = {...item, updatedAt: now}
      d.revisions[item.key] = [{observedAt: new Date(now).toISOString(), values: values(item)}]
      if (onCoordinators(item)) enqueue(d, item.key, now)
    } else if (applyCardChange(d, item, now)) changed = true
  }
  for (const item of Object.values(d.records))
    if (!seen.has(item.key) && !item.absent) {
      recordMembership(d, item, {...item, absent:true}, now)
      item.absent = true
      changed = true
      d.lastChanges.push({id: item.id, fields: ['Отсутствует в свежей выборке']})
    }
  if (!first && !changed) d.lastChanges = last
  if (first || changed) {
    d.lastImport = now
    reconcileGroups(d,items(d),now)
  }
  const recovered = Boolean(d.sourceError)
  d.sourceError = ''
  return first || changed || recovered
}
export function createDesk(mode: Source, now: number): Desk {
  const d: Desk = {
    mode,
    started: now,
    version: 1,
    seq: 0,
    input: 'file',
    sourceError: '',
    lastImport: 0,
    lastChanges: [],
    records: {},
    revisions: {},
    events: [],
    signals: [],
    quietUntil: 0,
    threshold: 20,
    warnings: {},
    people: [
      {id: 'anna', name: 'Анна Котова', group: coordinatorGroup, available: true, generation: 1},
      {id: 'oleg', name: 'Олег Соколов', group: coordinatorGroup, available: true, generation: 1},
      {id: 'ira', name: 'Ирина Белова', group: coordinatorGroup, available: false, generation: 0},
    ],
    tasks: [],
    notices: [],
    enabled: [...channels],
    failedChannels: [],
    work: {},
    presets: {},
    demoCount: 0,
  }
  if (mode === 'volume') {
    for (const i of initialIncidents) if (onCoordinators(i)) enqueue(d, i.key, now)
    const work = emptyWork()
    work.room = {
      id: 'ER-112',
      ended: false,
      fragments: [],
      members: [
        {
          role: 'Анна Котова',
          team: 'Координаторы МИ',
          invited: '12:24',
          joined: '12:26',
          delivery: 'Прочитано',
        },
        {
          role: 'Дежурный платежей',
          team: 'Команда платежей',
          invited: '12:25',
          joined: '12:30',
          delivery: 'Прочитано',
        },
        {role: 'Дежурный сети', team: 'Сетевые сервисы', invited: '12:38', delivery: 'Доставлено'},
        {
          role: 'Инженер мониторинга',
          team: 'Мониторинг',
          invited: '12:22',
          joined: '12:23',
          left: '12:35',
          delivery: 'Прочитано',
        },
      ],
    }
    d.work.incident = work
    dispatchTasks(d, now)
  }
  reconcileGroups(d,items(d),now)
  return d
}
export function tickDesk(d: Desk, now: number) {
  let changed = dispatchTasks(d, now)
  if (d.movements?.length && d.movements[0].at <= now - queueWindowMs) {
    d.movements = d.movements.filter(move => move.at > now - queueWindowMs)
    changed = true
  }
  const stamp = standNow(d, now)
  for (const i of items(d)) {
    if (!active(i) || i.absent) continue
    const due = dueInstant(i)
    if (due === null) continue
    const left = due - stamp,
      token = due + '/' + d.threshold
    if (left < 0 || left > d.threshold * 60000 || d.warnings[i.key] === token) continue
    d.warnings[i.key] = token
    appendEvent(d, i, 'due', 'До срока ' + Math.ceil(left / 60000) + ' мин', now)
    changed = true
  }
  return changed
}
function patchOfficial(d: Desk, key: string, data: unknown, now: number, expected?: number) {
  const i = target(d, key)
  if (expected !== undefined)
    ensure(expected === (i.updatedAt ?? 0), 'Карточка уже изменилась. Обновите данные.')
  ensure(data && typeof data === 'object', 'Нет полей карточки.')
  const p = data as Record<string, unknown>
  const next = {...i}
  if ('team' in p) next.team = required(p.team, 'Команда')
  if ('state' in p) {
    ensure(states.includes(p.state as (typeof states)[number]), 'Неизвестный статус.')
    next.state = String(p.state)
    ensure(i.state !== 'Закрыт' || next.state === i.state, 'Закрытый INC окончателен.')
  }
  if ('priority' in p) {
    ensure([1, 2, 3, 4].includes(Number(p.priority)), 'Приоритет от 1 до 4.')
    next.priority = Number(p.priority)
  }
  if ('solution' in p) next.solution = String(p.solution ?? '')
  if ('assignee' in p) next.assignee = String(p.assignee ?? '')
  if ('due' in p) {
    const date = p.due == null || p.due === '' ? null : Date.parse(String(p.due))
    ensure(date === null || Number.isFinite(date), 'Неверный срок.')
    next.dueAt = date
    next.due = date === null ? null : moscowTime(date)
  }
  next.research = next.state === 'Исследование ситуации'
  next.restoredAt = ['Завершён', 'Закрыт', 'Исследование ситуации'].includes(next.state)
    ? (i.restoredAt ?? time(d, now))
    : undefined
  if (next.restoredAt && !i.restoredAt) next.restoredEpoch = standNow(d, now)
  if (!next.restoredAt) next.restoredEpoch = undefined
  if (next.team !== i.team || next.assignee !== i.assignee) next.assignedEpoch = standNow(d, now)
  next.assignedAt = onCoordinators(next) ? (i.assignedAt ?? time(d, now)) : undefined
  applyCard(d, next, now)
}
export function execute(d: Desk, c: Command, now: number) {
  dispatchTasks(d, now)
  const person = d.people.find((p) => p.id === c.person)
  const work = () => {
    const i = target(d, c.key)
    return (d.work[i.key] ??= emptyWork())
  }
  switch (c.type) {
    case 'groupClaim':
    case 'groupAdd':
    case 'groupExclude':
      editOutageGroup(d,c,items(d),now)
      break
    case 'wifi': {
      const historic: Incident = {
        key: 'wifi-msk',
        id: 'INC000022008001',
        product: 'Корпоративная сеть',
        service: 'Офисный Wi-Fi',
        title: 'Недоступен Wi-Fi в офисе',
        team: 'Сети · Москва',
        registered: '08:20',
        restoredAt: '11:40',
        state: 'Завершён',
        research: false,
        priority: 4,
        due: null,
        site: 'Москва',
        specialists: 3,
        workMinutes: 180,
        solution: 'Инженеры восстановили маршрут офисного контроллера.',
      }
      if (!lookup(d, historic.key)) applyCard(d, historic, now)
      const current: Incident = {
        ...historic,
        key: 'wifi-rostov',
        id: 'INC000022008002',
        team: coordinatorGroup,
        state: 'Назначен',
        registered: time(d, now),
        assignedAt: time(d, now),
        site: 'Ростов',
        due: moscowTime(standNow(d, now) + 7200000),
        dueAt: standNow(d, now) + 7200000,
        restoredAt: undefined,
        workMinutes: undefined,
        specialists: undefined,
        solution: undefined,
      }
      if (!lookup(d, current.key)) applyCard(d, current, now)
      break
    }
    case 'demo': {
      const i = additionalIncidents[d.demoCount % additionalIncidents.length]
      const n = d.demoCount++,
        id = n < 3 ? i.id : 'INC' + String(23000000 + n).padStart(12, '0')
      applyCard(
        d,
        {
          ...i,
          id,
          key: d.mode === 'case' ? id : n < 3 ? i.key : id,
          team: coordinatorGroup,
          assignedAt: time(d, now),
          registered: time(d, now),
        },
        now,
      )
      break
    }
    case 'ack': {
      ensure(Array.isArray(c.ids) && c.ids.length > 0, 'Нет показанных сигналов.')
      const ids = new Set(c.ids)
      let found = false
      for (const s of d.signals)
        if (!s.acknowledged && ids.has(s.id)) {
          s.acknowledged = now
          found = true
        }
      if (found) d.quietUntil = now + 30000
      break
    }
    case 'available': {
      ensure(person, 'Неизвестный координатор.')
      if (c.enabled && !person.available) person.generation++
      person.available = !!c.enabled
      break
    }
    case 'accept':
    case 'handoff': {
      const task = d.tasks.find((t) => t.key === c.key && t.finished === undefined),
        a = task?.attempts.at(-1)
      ensure(
        task && a && !a.ended && a.id === c.id && a.person === c.person,
        'Назначение устарело или принадлежит другому дежурному.',
      )
      if (c.type === 'accept') {
        ensure(a.deadline === null || a.accepted !== undefined || now < a.deadline, 'Срок принятия истёк.')
        a.accepted ??= now
      } else {
        ensure(a.accepted !== undefined, 'Сначала примите задачу.')
        const team = required(c.value, 'Команда решения')
        ensure(team !== coordinatorGroup && team !== 'Координаторы МИ', 'Выберите команду решения.')
        patchOfficial(d, task.key, {team}, now, c.expected)
      }
      break
    }
    case 'send': {
      const i = target(d, c.key)
      const selection = requestChannels(c.channels)
      ensure(selection.length, 'Выберите канал.')
      deliveries(d, i.key, required(c.person, 'Получатель'), required(c.text, 'Сообщение'), now, selection)
      break
    }
    case 'retry':
    case 'read': {
      const n = d.notices.find((n) => n.id === c.id)
      ensure(n, 'Уведомление не найдено.')
      if (c.type === 'retry') {
        ensure(n.status === 'Ошибка', 'Повтор доступен после ошибки.')
        n.tries++
        n.status = d.failedChannels.includes(n.channel) ? 'Ошибка' : 'Доставлено'
      } else {
        ensure(n.status !== 'Ошибка', 'Сообщение не доставлено.')
        n.status = 'Прочитано'
      }
      break
    }
    case 'channels':
      d.enabled = requestChannels(c.channels)
      break
    case 'failChannels':
      d.failedChannels = requestChannels(c.channels)
      break
    case 'link':
    case 'unlink': {
      const a = target(d, c.key),
        b = target(d, c.value)
      ensure(a.key !== b.key, 'Нельзя связать карточку с собой.')
      for (const [x, y] of [
        [a, b],
        [b, a],
      ]) {
        const w = (d.work[x.key] ??= emptyWork())
        w.links = w.links.filter((v) => v !== y.key)
        if (c.type === 'link') w.links.push(y.key)
      }
      break
    }
    case 'note': {
      const x = work()
      ensure(['Заметка', 'Следующий шаг', 'Проверка'].includes(c.kind ?? ''), 'Выберите тип записи.')
      x.notes.unshift({
        id: uid(d),
        kind: c.kind as 'Заметка' | 'Следующий шаг' | 'Проверка',
        text: required(c.text, 'Текст'),
        owner: required(c.owner, 'Ответственный'),
        author: person?.name,
        at: now,
        done: false,
        due: c.due,
      })
      break
    }
    case 'toggleNote': {
      const n = work().notes.find((n) => n.id === c.id)
      ensure(n, 'Запись не найдена.')
      n.done = !n.done
      break
    }
    case 'report': {
      work().reports.unshift({
        id: uid(d),
        at: now,
        title: required(c.title, 'Название'),
        content: required(c.text, 'Содержание'),
        revision: d.version,
      })
      break
    }
    case 'room':
    case 'meetingEnd': {
      const w = work()
      if (c.type === 'room') {
        ensure(!w.room, 'Комната уже существует.')
        w.room = {
          id: 'ER-' + target(d, c.key).id,
          ended: false,
          members: [
            {
              role: person?.name ?? 'Дежурный смены',
              team: coordinatorGroup,
              invited: time(d, now),
              joined: time(d, now),
              delivery: 'Прочитано',
            },
          ],
          fragments: [],
        }
      } else {
        ensure(w.room && !w.room.ended, 'Встреча недоступна.')
        w.room.ended = true
        const incident = target(d, c.key)
        const host = w.room.members.find((m) => m.joined)?.role ?? 'Координатор'
        const checked = w.notes.filter((n) => n.done)
        const steps = w.notes.filter((n) => !n.done && n.kind === 'Следующий шаг')
        const questions = w.notes.filter((n) => !n.done && n.kind === 'Проверка')
        const actions = (notes: typeof w.notes) =>
          notes.map((n) => n.text + ' — ' + n.owner + (n.due ? ', к ' + n.due : '')).join(' · ')
        const describe = (notes: typeof w.notes) => notes.map((n) => n.text).join(' · ')
        const finding = incident.solution || describe(checked) || 'Решение ещё не зафиксировано'
        const next = actions(steps) || 'Следующее действие и ответственного нужно согласовать'
        const open = actions(questions) || 'Подтверждено ли восстановление для клиентов?'
        w.room.fragments = [
          {
            at: w.room.members[0].invited,
            who: host,
            text: incident.id + '. Обсуждаем сбой: ' + incident.title + '.',
          },
          ...[...w.notes]
            .reverse()
            .map((n) => ({
              at: time(d, n.at),
              who: n.author ?? host,
              text:
                'В журнале смены: ' +
                n.text +
                '. Ответственный: ' +
                n.owner +
                (n.due ? ', срок ' + n.due : '') +
                '.',
            })),
          {
            at: time(d, now),
            who: host,
            text: 'Итог: ' + finding + '. Следующей смене: ' + next + '. Открытая проверка: ' + open,
          },
        ]
        w.reports.unshift({
          id: uid(d),
          at: now,
          revision: d.version,
          title: 'Сводка встречи ' + w.room.id,
          content: [
            'Обсудили: ' + incident.title,
            'Итог проверки: ' + finding,
            'Следующие действия: ' + next,
            'Открытый вопрос: ' + open,
          ].join('\n'),
        })
      }
      break
    }
    case 'roomMember': {
      const room = work().room
      ensure(room && !room.ended, 'Встреча недоступна.')
      if (!room.timeline) {
        room.timeline = room.members
          .flatMap((m) => {
            const base = new Date(standNow(d, now) + 10800000).toISOString().slice(0, 10)
            return [
              [m.invited, 'Приглашение'],
              [m.joined, 'Подключился'],
              [m.left, 'Вышел'],
            ]
              .filter(([when]) => when)
              .map(([when, text]) => ({
                at: now + (Date.parse(base + 'T' + when + ':00+03:00') - standNow(d, now)),
                who: m.role,
                text: text!,
              }))
          })
          .sort((a, b) => b.at - a.at)
      }
      const member = room.members.find((m) => m.role === c.owner)
      const when = time(d, now)
      if (!member) {
        ensure(c.kind === 'invite', 'Участник не найден.')
        room.members.push({
          role: required(c.owner, 'Участник'),
          team: required(c.value, 'Команда'),
          invited: when,
          delivery: 'Доставлено',
        })
      } else if (c.kind === 'join') {
        member.joined = when
        delete member.left
      } else if (c.kind === 'leave') {
        ensure(member.joined && !member.left, 'Участник вне звонка.')
        member.left = when
      } else if (c.kind === 'read') member.delivery = 'Прочитано'
      else if (c.kind === 'miss') member.delivery = 'Пропущено'
      else throw Error('Действие недоступно.')
      ;(room.timeline ??= []).unshift({
        at: now,
        who: c.owner!,
        text: {
          invite: 'Приглашение доставлено',
          join: 'Подключился',
          leave: 'Вышел',
          read: 'Прочитал приглашение',
          miss: 'Пропуск подтверждён источником',
        }[c.kind as 'join'],
      })
      break
    }
    case 'advisor': {
      const w = work()
      if (c.kind === 'availability') {
        ensure(['ready', 'wait', 'unknown'].includes(c.value ?? ''), 'Недопустимая доступность.')
        w.availability = c.value as 'ready' | 'wait' | 'unknown'
      } else {
        w.recommendation = required(c.text, 'Решение координатора')
        if (c.kind === 'accept') w.recommendedTeam = required(c.value, 'Команда решения')
        else if (c.kind === 'reject') w.recommendedTeam = null
        else delete w.recommendedTeam
        w.reports.unshift({
          id: uid(d), at: now, title: 'Решение о маршрутизации',
          content: (person ? person.name + ' · ' : '') + w.recommendation, revision: d.version,
        })
      }
      break
    }
    case 'threshold': {
      ensure(Number.isInteger(c.number) && c.number! > 0 && c.number! <= 1440, 'Порог: от 1 до 1440 минут.')
      d.threshold = c.number!
      break
    }
    case 'preset': {
      ensure(person, 'Неизвестный координатор.')
      const href = required(c.value, 'Фильтры')
      ensure(/^#queue\/(critical|assigned|high|research|all)(\?|$)/.test(href), 'Некорректное представление.')
      const list = (d.presets[person.id] ??= [])
      const name = required(c.title, 'Название')
      d.presets[person.id] = [...list.filter((x) => x.name !== name), {name, href}]
      break
    }
    case 'removePreset': {
      ensure(person, 'Неизвестный координатор.')
      d.presets[person.id] = (d.presets[person.id] ?? []).filter((x) => x.name !== c.title)
      break
    }
    case 'edit':
      patchOfficial(d, required(c.key, 'INC'), c.data, now, c.expected)
      break
    case 'upload':
      applySnapshot(d, c.data, now)
      d.input = 'upload'
      break
    case 'watchFile':
      d.input = 'file'
      break
    case 'analyze': {
      const i = target(d, c.key),
        w = work()
      ensure(!w.modelOffline, 'Мок-модель недоступна. Карточка и сохранённые наблюдения доступны.')
      const sample = w.telemetryOffline
        ? null
        : i.key === 'incident' && w.profile === 'workers'
          ? {kind: 'payment' as const, waitMs: 120, cpuPercent: 94, held: 3, pool: 24}
          : undefined
      const analysis = analyzeDemoIncident(i, d.mode === 'volume' ? sample : null)
      if (w.dataInterval !== undefined && !w.telemetryOffline) {
        const measured = w.diagnosticsAt ?? now
        const dataset = w.dataObject ?? 'Реестр продукта'
        const age = w.lastRowAge ?? 0
        const stale = age > w.dataInterval
        const last = time(d, measured - age * 60000)
        analysis.evidence.push({
          source: 'Журнал загрузки',
          finding: stale ? 'Загрузка в ожидаемом интервале пропущена' : 'Загрузка завершена',
          record:
            time(d, measured) +
            ' МСК · ' +
            dataset +
            ' · ' +
            (stale ? 'mock_batch=waiting_for_input' : 'mock_batch=completed'),
        })
        analysis.evidence.push({
          source: 'Проверка свежести данных',
          finding: stale ? 'Поток данных запаздывает' : 'Данные поступают вовремя',
          record:
            time(d, measured) +
            ' МСК · ' +
            dataset +
            ' · последняя запись ' +
            last +
            ' МСК · интервал ' +
            w.dataInterval +
            ' мин, возраст ' +
            age +
            ' мин',
        })
        if (stale && !analysis.hypothesis) {
          analysis.hypothesis = 'Поступление данных в ' + dataset + ' могло остановиться до этапа загрузки.'
          analysis.question = 'Получил ли загрузчик следующую партию после ' + last + ' МСК?'
          analysis.next =
            'Сверить последний успешный пакет с журналом источника и повторить проверку после следующей загрузки.'
        }
      }
      if (w.telemetryOffline)
        analysis.evidence.push({
          source: 'Мониторинг продукта',
          finding: 'Свежие наблюдения недоступны',
          record: 'Пропуск измерений. Проверьте сборщик. Доступность сервиса неизвестна.',
        })
      w.reports.unshift({
        id: uid(d),
        at: now,
        title: 'Разбор агента',
        revision: i.updatedAt ?? 0,
        analysis,
        content: [
          i.id,
          ...analysis.evidence.map((e) => e.source + ': ' + e.finding + ' (' + e.record + ')'),
          analysis.hypothesis ?? 'Недостаточно данных',
          analysis.recipient,
          analysis.question,
          analysis.next,
        ].join('\n'),
      })
      break
    }
    case 'experiment': {
      const i = target(d, c.key),
        w = work()
      ensure(i.key === 'incident', 'Этот профиль относится к оплате МТС Маркет.')
      ensure(!w.telemetryOffline, 'Нет свежих измерений для проверки прогноза.')
      ensure(
        Number.isInteger(c.number) && c.number! >= 1 && c.number! <= 500,
        'Нагрузка от 1 до 500 заказов.',
      )
      const trial = measures.map((m) => recoveryTrial(w.profile ?? 'database', m, c.number))
      w.reports.unshift({
        id: uid(d),
        at: now,
        title: 'Эксперимент восстановления',
        revision: i.updatedAt ?? 0,
        content: trial
          .map(
            (t) =>
              t.measure +
              ': прогноз ' +
              t.expected +
              ', факт ' +
              t.actual +
              ' из ' +
              t.input +
              ' заказов/мин; p95 ' +
              t.p95 +
              ' мс; ограничение: ' +
              t.bottleneck +
              '; рост фоновой очереди ' +
              t.background +
              '/мин.',
          )
          .join('\n'),
      })
      break
    }
    case 'diagnostics': {
      const w = work()
      ensure(
        Number.isInteger(c.number) && c.number! > 0 && Number.isInteger(c.age) && c.age! >= 0,
        'Укажите интервал и возраст данных в минутах.',
      )
      w.dataObject = c.title ? required(c.title, 'Таблица или индекс') : (w.dataObject ?? 'payment_registry')
      w.diagnosticsAt = now
      w.dataInterval = c.number
      w.lastRowAge = c.age
      w.telemetryOffline = !!c.enabled
      w.profile = c.value === 'workers' ? 'workers' : 'database'
      w.modelOffline = c.kind === 'offline'
      break
    }
    default:
      throw Error('Неизвестное действие.')
  }
  dispatchTasks(d, now)
}
