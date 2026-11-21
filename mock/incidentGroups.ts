import {createHash} from 'node:crypto'
import {incidentRevisions, type Incident} from '../src/demoData.ts'
import {active, type Command, type Desk} from '../src/desk/types.ts'
import {registrationTime} from '../src/desk/order.ts'
import {assignmentCycle} from '../src/desk/assignmentCycle.ts'
import type {GroupDecisions, GroupReview, GroupVerdict, OutageGroup} from '../src/desk/outageGroups.ts'

const episodeWindow = 30 * 60_000
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
const normalized = (text: string) => text.trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ')
const current = (i: Incident) => active(i) && !i.absent
const singleId = (key: string) => 'inc:' + key

function decisions(d: Desk, id: string, now: number): GroupDecisions {
  return ((d.outageDecisions ??= {})[id] ??= {included: [], excluded: [], createdAt: now})
}

// The upstream and diagnostic must be independently evidenced. Product names and coincident timestamps are insufficient.
function features(item: Incident) {
  const text = item.title + '\n' + (item.description ?? '')
  const dependency = (
    item.upstreamService ??
    text.match(
      /(?:upstream(?:Service)?|dependency|зависимость)\s*[:=]\s*([^;|,\n]{1,120}?)(?=\s+(?:error|код ошибки)\s*[:=]|[;|,\n]|$)/iu,
    )?.[1]
  )?.trim()
  if (!dependency || /^(?:unknown|null|неизвестно|нет данных)$/iu.test(dependency)) return
  const code = (
    item.errorCode ?? text.match(/(?:error(?:Code)?|код ошибки)\s*[:=]\s*([\w.-]{2,80})/iu)?.[1]
  )?.trim()
  // For signals without a code, compare a specific multiword symptom within the same upstream and episode.
  const stop =
    /^(?:ошибка|сбой|проблема|недоступен|недоступна|сервис|сервиса|при|для|the|error|service|failed)$/iu
  const symptom = [...new Set(normalized(item.title.split(/[·;|]/u)[0]).match(/[\p{L}]{3,}/gu) ?? [])]
    .filter((word) => !stop.test(word))
    .sort()
  if (!code && symptom.length < 2) return
  return {
    dependency,
    diagnostic: code || symptom.join(' '),
    isCode: Boolean(code),
    signature: JSON.stringify([
      normalized(dependency),
      code ? 'code' : 'symptom',
      code ? normalized(code) : symptom,
    ]),
  }
}

interface Candidate {
  id: string
  title: string
  method: OutageGroup['method']
  evidence: string[]
  keys: string[]
  review?: GroupReview
}

function candidates(d: Desk, all: Incident[], live: Incident[], now: number) {
  const result = new Map<string, Candidate>()
  const byId = new Map(all.map((i) => [i.id, i]))
  const roots = new Map<string, Incident | null>()
  const primary = new Set<string>()
  function parentOf(i: Incident) {
    if (roots.has(i.id)) return roots.get(i.id)
    const path = new Set<string>()
    let root: Incident | undefined | null = i
    while (root?.parentId) {
      if (roots.has(root.id)) {
        root = roots.get(root.id)
        break
      }
      if (path.has(root.id)) {
        root = null
        break
      }
      path.add(root.id)
      root = byId.get(root.parentId)
    }
    for (const key of path) roots.set(key, root ?? null)
    return root
  }
  for (const i of live) {
    if (!i.parentId) continue
    const root = parentOf(i)
    if (!root) continue
    const id = 'parent:' + root.id
    let c = result.get(id)
    if (!c) {
      c = {id, title: root.title, method: 'parent', evidence: ['Общий родитель в ITSM: ' + root.id], keys: []}
      result.set(id, c)
      if (current(root)) {
        c.keys.push(root.key)
        primary.add(root.key)
      }
    }
    c.keys.push(i.key)
    primary.add(i.key)
  }

  type Episode = {id: string; signature: string; first: number; last: number; cards: Incident[]}
  const signals = new Map<string, {signal: NonNullable<ReturnType<typeof features>>; cards: Incident[]}>()
  for (const i of live) {
    if (primary.has(i.key)) continue
    const signal = features(i)
    if (!signal || !Number.isFinite(registrationTime(i))) continue
    const bucket = signals.get(signal.signature)
    if (bucket) bucket.cards.push(i)
    else signals.set(signal.signature, {signal, cards: [i]})
  }
  const priorEpisodes = new Map<string, Episode[]>()
  for (const [id, state] of Object.entries(d.outageDecisions ?? {})) {
    const ep = state.episode
    if (!ep) continue
    const episode: Episode = {id, ...ep, cards: []}
    const prior = priorEpisodes.get(ep.signature)
    if (prior) prior.push(episode)
    else priorEpisodes.set(ep.signature, [episode])
  }
  for (const [signature, {signal, cards}] of signals) {
    const episodes = priorEpisodes.get(signature) ?? []
    cards.sort((a, b) => registrationTime(a) - registrationTime(b) || a.id.localeCompare(b.id))
    for (const i of cards) {
      const at = registrationTime(i)
      let episode = episodes.find((e) => e.first <= at && at <= e.last)
      episode ??= episodes.find((e) => Math.max(e.last, at) - Math.min(e.first, at) <= episodeWindow)
      if (!episode) {
        episode = {id: 'outage:' + digest([signature, i.key, at]), signature, first: at, last: at, cards: []}
        episodes.push(episode)
      }
      episode.first = Math.min(episode.first, at)
      episode.last = Math.max(episode.last, at)
      episode.cards.push(i)
    }
    for (const e of episodes) {
      if (!e.cards.length) continue
      const services = [...new Set(e.cards.map((i) => i.service || i.product))].sort()
      // Keep an established outage accessible as the last affected service recovers.
      if (services.length < 2 && !d.outageDecisions?.[e.id]?.episode) continue
      const state = decisions(d, e.id, now)
      state.episode = {signature, first: e.first, last: e.last}
      const keys = e.cards.map((i) => i.key)
      const namedSamples = e.cards.map((i) => (i.service || i.product) + ': ' + i.title)
      const samples = [...new Set(namedSamples)].slice(0, 6)
      const firstAt = registrationTime(e.cards[0])
      const lastAt = registrationTime(e.cards[e.cards.length - 1])
      // A stream of equivalent INC must not invalidate a model verdict faster than the model can answer.
      const symptomClasses = [...new Set(e.cards.map((i) => normalized(i.title).replace(/\d+/g, '#')))].sort()
      const review: GroupReview = {
        groupId: e.id,
        fingerprint: digest([signature, services, symptomClasses, Math.floor((lastAt - firstAt) / 300000)]),
        dependency: signal.dependency,
        errorCode: signal.isCode ? signal.diagnostic : '',
        services,
        incidents: keys.length,
        samples,
        firstAt,
        lastAt,
      }
      result.set(e.id, {
        id: e.id,
        title: 'Возможный общий сбой: ' + signal.dependency,
        method: 'evidence',
        keys,
        review,
        evidence: [
          'Зависимость: ' + signal.dependency,
          (signal.isCode ? 'Совпадает код ошибки: ' : 'Совпадает симптом: ') + signal.diagnostic,
          'Сервисов: ' +
            services.length +
            ' · интервал регистрации: ' +
            Math.ceil((review.lastAt - review.firstAt) / 60000) +
            ' мин',
        ],
      })
    }
  }
  return result
}

export function reconcileGroups(d: Desk, all: Incident[], now: number) {
  const live = all.filter(current)
  const byKey = new Map(live.map((i) => [i.key, i]))
  const previous = new Map((d.outageGroups ?? []).map((g) => [g.id, g]))
  const automatic = candidates(d, all, live, now)
  const proposals: GroupReview[] = []
  const groups: OutageGroup[] = []
  const assigned = new Set<string>()
  const manual = new Map<string, string>()
  for (const [id, state] of Object.entries(d.outageDecisions ?? {})) {
    if (state.seed && state.included.length && !state.excluded.includes(state.seed))
      manual.set(state.seed, id)
    for (const key of state.included) manual.set(key, id)
  }

  // If the first member was already taken before the rest arrived, carry that claim into the new outage.
  // Conflicting active owners remain separate until a coordinator explicitly transfers an INC.
  const reservations = new Map<string, string>()
  for (const prior of previous.values()) {
    if (!prior.owner) continue
    for (const key of prior.members) {
      if (byKey.has(key) && !d.outageDecisions?.[prior.id]?.excluded.includes(key))
        reservations.set(key, prior.id)
    }
  }
  for (const c of automatic.values()) {
    const singles = [
      ...new Set(c.keys.map((key) => reservations.get(key)).filter((id): id is string => !!id)),
    ]
      .map((id) => previous.get(id)!)
      .filter((g) => g.method === 'single' && g.owner)
    if (!singles.length) continue
    const state = decisions(d, c.id, now)
    const owners = new Set(singles.map((g) => g.owner))
    if (!state.owner && owners.size === 1 && !state.verdict) {
      state.owner = singles[0].owner
      state.acceptedAt = Math.min(...singles.map((g) => g.acceptedAt ?? now))
      state.title = c.title
    }
    for (const single of singles) {
      if (
        single.owner !== state.owner ||
        state.excluded.includes(single.members[0]) ||
        manual.has(single.members[0])
      )
        continue
      const solo = decisions(d, single.id, now)
      delete solo.owner
      delete solo.acceptedAt
      delete solo.retainedMembers
      reservations.set(single.members[0], c.id)
    }
  }

  function publish(c: Candidate) {
    const state = d.outageDecisions?.[c.id]
    let autoKeys = state?.owner ? [...new Set([...c.keys, ...(state.retainedMembers ?? [])])] : c.keys
    let method = c.method
    let evidence = c.evidence
    if (c.review) {
      proposals.push(c.review)
      const verdict = state?.verdict
      if (verdict?.fingerprint === c.review.fingerprint) {
        const conclusion =
          verdict.model +
          ' · вывод по выборке из ' +
          (verdict.reviewedIncidents ?? c.review.incidents) +
          ' INC · ' +
          verdict.reason
        if (verdict.agree) {
          method = 'model'
          evidence = [...evidence, conclusion]
        } else {
          autoKeys = verdict.retained
          method = 'manual'
          evidence = ['Состав сохранён по решению координатора', conclusion, ...evidence]
        }
      }
    }
    const keys = [...new Set([...autoKeys, ...(state?.included ?? [])])].filter(
      (key) =>
        byKey.has(key) &&
        !assigned.has(key) &&
        !state?.excluded.includes(key) &&
        (manual.has(key)
          ? manual.get(key) === c.id
          : !reservations.has(key) || reservations.get(key) === c.id),
    )
    if (!keys.length) return
    const members = keys.sort()
    members.forEach((key) => assigned.add(key))
    if (state?.owner) state.retainedMembers = members
    if (method === 'single' && members.length > 1) {
      method = 'manual'
      evidence = ['Состав группы указал координатор']
    }
    const before = previous.get(c.id)
    const body = {
      title: c.title,
      method,
      evidence,
      members,
      included: [...(state?.included ?? [])],
      excluded: [...(state?.excluded ?? [])],
      owner: state?.owner,
      acceptedAt: state?.acceptedAt,
    }
    const membershipChanged =
      !before || body.owner !== before.owner || body.acceptedAt !== before.acceptedAt ||
      (['members', 'included', 'excluded'] as const).some(
        (k) => JSON.stringify(body[k]) !== JSON.stringify(before[k]),
      )
    const changed = membershipChanged || body.title !== before.title || body.method !== before.method ||
      JSON.stringify(body.evidence) !== JSON.stringify(before.evidence)
    const revision = membershipChanged ? ++d.seq : before.revision
    groups.push({
      ...body,
      id: c.id,
      createdAt: before?.createdAt ?? state?.createdAt ?? now,
      updatedAt: changed ? now : before.updatedAt,
      revision,
      openedRevision: before?.openedRevision ?? before?.revision ?? revision,
    })
  }

  // Explicit links survive changing evidence, absent members and server restarts.
  for (const [id, state] of Object.entries(d.outageDecisions ?? {})) {
    if (automatic.has(id) || (!state.included.length && !state.owner)) continue
    const seed = state.seed
    const keys = [
      ...(seed ? [seed] : []),
      ...(state.owner ? (state.retainedMembers ?? []) : []),
      ...state.included,
    ]
    if (!keys.some((k) => byKey.has(k))) continue
    const method =
      seed &&
      !state.included.length &&
      keys.filter((k) => !state.excluded.includes(k)).every((k) => k === seed)
        ? 'single'
        : 'manual'
    automatic.set(id, {
      id,
      title: state.title ?? previous.get(id)?.title ?? 'Группа смены',
      method,
      evidence: [method === 'single' ? 'Активный инцидент' : 'Состав сохранён по решению смены'],
      keys,
    })
  }

  for (const c of automatic.values()) publish(c)
  for (const i of live) {
    if (assigned.has(i.key) || (manual.has(i.key) && manual.get(i.key) !== singleId(i.key))) continue
    let id = singleId(i.key)
    while (automatic.has(id) || d.outageDecisions?.[id]?.excluded.includes(i.key)) id += '~'
    const cycle = assignmentCycle(
      i,
      d.revisions[i.key] ?? (d.mode === 'volume' ? incidentRevisions.get(i.key) : undefined) ?? [],
    )
    if (i.priority !== 4 && !cycle && !d.outageDecisions?.[id]?.included.length) continue
    publish({
      id,
      title: i.title,
      method: 'single',
      evidence: [cycle ? 'Возврат между командами: ' + cycle.join(' → ') : 'Активный критический инцидент'],
      keys: [i.key],
    })
  }
  const visible = new Set(groups.map((g) => g.id))
  for (const [id, state] of Object.entries(d.outageDecisions ?? {})) {
    if (state.owner && !visible.has(id)) {
      delete state.owner
      delete state.acceptedAt
      delete state.retainedMembers
    }
  }
  d.outageProposals = proposals
  d.outageGroups = groups
}

export function pendingGroupReviews(d: Desk) {
  return (d.outageProposals ?? []).filter(
    (p) => d.outageDecisions?.[p.groupId]?.verdict?.fingerprint !== p.fingerprint,
  )
}

export function applyGroupReview(
  d: Desk,
  review: GroupReview,
  verdict: GroupVerdict,
  now: number,
  incidents: Incident[],
) {
  if (
    !pendingGroupReviews(d).some((p) => p.groupId === review.groupId && p.fingerprint === review.fingerprint)
  )
    return false
  const state = decisions(d, review.groupId, now)
  const group = d.outageGroups?.find((g) => g.id === review.groupId)
  const edited = Boolean(state.owner || state.included.length || state.excluded.length)
  state.verdict = {
    ...verdict,
    fingerprint: review.fingerprint,
    reviewedIncidents: review.incidents,
    retained: !verdict.agree && edited && group ? [...group.members] : [],
  }
  reconcileGroups(d, incidents, now)
  return true
}

export function editOutageGroup(d: Desk, c: Command, incidents: Incident[], now: number) {
  const group = d.outageGroups?.find((g) => g.id === c.id)
  if (!group) throw Error('Группа уже изменилась. Обновите данные.')
  const person = d.people.find((p) => p.id === c.person)
  if (!person) throw Error('Неизвестный координатор.')
  if (c.type === 'groupClaim') {
    // A claim covers the live outage, including arrivals since the button was shown.
    if (typeof c.expected !== 'number' || !Number.isSafeInteger(c.expected) ||
        c.expected < (group.openedRevision ?? group.revision) || c.expected > group.revision)
      throw Error('Группа уже изменилась. Обновите данные.')
    if (group.owner === person.id) return
  } else if (c.expected !== group.revision) {
    throw Error('Группа уже изменилась. Обновите данные.')
  }
  const state = decisions(d, group.id, now)
  state.title = group.title
  if (group.method === 'single') state.seed = group.members[0]
  if (c.type === 'groupClaim') {
    if (state.owner && state.owner !== person.id) throw Error('Группа уже назначена другому дежурному.')
    state.owner = person.id
    state.acceptedAt ??= now
    state.retainedMembers = [...group.members]
  } else {
    if (!Array.isArray(c.ids) || !c.ids.length || c.ids.some((key) => typeof key !== 'string'))
      throw Error('Выберите инциденты.')
    const keys = new Set(c.ids)
    const activeKeys = new Set(incidents.filter(current).map((i) => i.key))
    if ([...keys].some((key) => !activeKeys.has(key))) throw Error('Один из INC больше не активен.')
    if (group.method === 'single' && keys.has(group.members[0]) && c.type === 'groupExclude')
      throw Error('Этот INC открывает группу. Для переноса добавьте его в другую группу.')
    if (c.type === 'groupExclude' && [...keys].some((key) => !group.members.includes(key)))
      throw Error('INC не входит в группу.')
    if (c.type === 'groupAdd') {
      for (const key of keys) {
        if (state.included.includes(key)) continue
        for (const [id, other] of Object.entries(d.outageDecisions ?? {})) {
          if (id !== group.id) other.included = other.included.filter((k) => k !== key)
        }
        for (const other of d.outageGroups ?? []) {
          if (other.id === group.id || !other.members.includes(key)) continue
          const origin = decisions(d, other.id, now)
          origin.included = origin.included.filter((k) => k !== key)
          if (other.method !== 'single' && !origin.excluded.includes(key)) origin.excluded.push(key)
        }
        state.excluded = state.excluded.filter((k) => k !== key)
        state.included.push(key)
      }
    } else {
      state.included = state.included.filter((k) => !keys.has(k))
      state.excluded = [...new Set([...state.excluded, ...keys])]
    }
  }
  reconcileGroups(d, incidents, now)
}
