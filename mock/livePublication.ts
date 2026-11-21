import {AsyncLocalStorage} from 'node:async_hooks'
import type {IncomingHttpHeaders} from 'node:http'
import type {Incident} from '../src/demoData.ts'
import type {Desk, Signal} from '../src/desk/types.ts'
import {itsmStateLabels} from '../src/desk/types.ts'
import {createIncidentsApi} from '../src/features/incidents/api/client.ts'
import {toIncident} from '../src/features/incidents/model/toDesk.ts'
import {ApiError, createHttpClient} from '../src/shared/api/http.ts'
import {applyCardDetails, applySnapshotCards, dispatchTasks} from './engine.ts'
import type {itsmGateway} from './itsm.ts'
import {ItsmError} from './itsm.ts'

type Gateway = NonNullable<ReturnType<typeof itsmGateway>>

/** List publications are atomic. Rich cards and direct graph edges load in bounded batches. */
export function livePublication(
  origin: string, gateway: Gateway, current: () => Desk, save: (desk: Desk, cards?: boolean | string[]) => void,
) {
  const credential = new AsyncLocalStorage<string>()
  const options = {baseUrl: origin, getAccessToken: () => credential.getStore()}
  const api = createIncidentsApi(options)
  const journal = createHttpClient(options)
  let journalCursor = 0
  let initialRevision: number | undefined
  let fetchingChanges = false
  let publication: Awaited<ReturnType<typeof api.getIncidents>> | undefined
  let reading: Promise<void> | undefined
  let enriching = false
  let checked = 0
  let generation = 0
  let alarmGeneration = 0
  const pending = new Set<string>()
  const lifetime = new AbortController()
  const timeout = () => AbortSignal.any([lifetime.signal, AbortSignal.timeout(7500)])

  async function syncAlarms() {
    const epoch = alarmGeneration
    const signals: Signal[] = []
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(2500)])
    let cursor = 0
    for (;;) {
      const page: {
        events: {eventId: string; incidentId: string; occurredAt: string; ackRequired: boolean}[]
        nextEventSeq: number
      } = await journal.request(`/api/dashboard/shift/events?sinceEventSeq=${cursor}&limit=500`, {}, signal)
      for (const event of page.events) {
        if (event.ackRequired) signals.push({id: event.eventId, key: event.incidentId, at: Date.parse(event.occurredAt)})
      }
      if (page.events.length < 500 || page.nextEventSeq <= cursor) break
      cursor = page.nextEventSeq
    }
    if (epoch !== alarmGeneration || lifetime.signal.aborted) return
    const desk = current()
    const acknowledged = desk.signals.filter(signal => signal.acknowledged !== undefined)
    const pending = desk.signals.filter(signal => signal.acknowledged === undefined)
    if (pending.length === signals.length && pending.every((signal, i) => signal.id === signals[i].id)) return
    save({...desk, signals: [...acknowledged, ...signals]}, false)
  }

  function metadata(error: string, first: boolean, successAt?: number) {
    const desk = current()
    const lastImport = successAt || desk.lastImport
    if (desk.sourceError !== error || desk.apiBeforeFirstSuccess !== first || lastImport !== desk.lastImport) {
      save({...desk, sourceError: error, apiBeforeFirstSuccess: first, lastImport}, false)
    }
  }

  async function enrich(headers: IncomingHttpHeaders) {
    if (enriching || !pending.size || lifetime.signal.aborted) return
    enriching = true
    try {
      while (pending.size && publication && !lifetime.signal.aborted) {
        const batch = [...pending].slice(0, 8)
        const sequence = publication.eventSeq
        const epoch = generation
        const details = await Promise.allSettled(batch.map(async key => {
          const existing = current().records[key]
          if (!existing || existing.absent) return null
          const [detail, graph] = await Promise.all([
            gateway.detail(existing, headers),
            api.getIncidentRelationships(key, timeout()).catch(() => null),
          ])
          if (detail.eventSeq !== sequence) throw Error('Публикация обновилась')
          if (graph?.focusId === key && Array.isArray(graph.edges)) {
            detail.card.parentId = graph.edges.find(edge => edge.childId === key)?.parentId ?? null
          }
          return detail.card
        }))
        if (lifetime.signal.aborted || epoch !== generation) return
        const hydrated: Incident[] = []
        for (const [index, result] of details.entries()) {
          pending.delete(batch[index])
          if (result.status === 'rejected') pending.add(batch[index])
          else if (result.value) hydrated.push(result.value)
        }
        if (hydrated.length) {
          const desk = structuredClone(current())
          const cards = hydrated.filter(i => desk.records[i.key] && !desk.records[i.key].absent)
            .map(i => ({...desk.records[i.key], ...i}))
          const changed = applyCardDetails(desk, cards, Date.now())
          if (changed.length) save(desk, changed)
        }
        // Retry failed detail requests on the next authorized poll.
        if (details.some(r => r.status === 'rejected')) return
      }
    } finally {
      enriching = false
    }
  }

  async function consumeChanges(headers: IncomingHttpHeaders) {
    if (fetchingChanges || !publication || initialRevision === undefined) return
    fetchingChanges = true
    const epoch = generation
    try {
      // Warm up from persisted history in bounded pages; this cursor is independent of publication.eventSeq.
      for (let page = 0; page < 4; page++) {
        const result = await journal.request<{
          events: {eventSeq: number; changeRevision: number; incidentId: string}[]
          lastEventSeq: number; hasMore: boolean
        }>('/api/dashboard/incidents/changes?afterEventSeq=' + journalCursor + '&limit=100', {}, timeout())
        if (lifetime.signal.aborted || epoch !== generation) return
        const previous = journalCursor
        for (const event of result.events) {
          if (publication.revision == null || event.changeRevision > publication.revision) return
          if (event.changeRevision > initialRevision && current().records[event.incidentId] && !current().records[event.incidentId].absent) {
            pending.add(event.incidentId)
          }
          journalCursor = Math.max(journalCursor, event.eventSeq)
        }
        if (!result.hasMore || journalCursor <= previous) break
      }
    } catch {
      // The published list remains available if the independent change feed is temporarily down.
    } finally {
      fetchingChanges = false
      void enrich(headers).catch(() => {})
    }
  }

  async function synchronize(headers: IncomingHttpHeaders) {
    const epoch = generation
    const [list, status] = await Promise.all([api.getIncidents({}, timeout()), api.getSnapshotStatus(timeout())])
    if (lifetime.signal.aborted || epoch !== generation) return
    const now = Date.now()
    const successAt = status.lastSuccessAt ? Date.parse(status.lastSuccessAt) : undefined
    const sourceError = status.stale && !list.beforeFirstSuccess ? 'Показан последний успешно опубликованный снимок.' : ''
    if (list.beforeFirstSuccess || (publication && list.eventSeq < publication.eventSeq)) {
      initialRevision = undefined
      journalCursor = 0
      pending.clear()
    }
    if (list.beforeFirstSuccess) {
      if (!publication?.beforeFirstSuccess) generation++
      publication = list
      metadata('', true)
    } else if (list !== publication) {
      if (list.revision == null) throw Error('У публикации отсутствует ревизия.')
      const desk = structuredClone(current())
      const ids = new Set<string>()
      const changed: string[] = []
      const cards = list.items.map(dto => {
        if (ids.has(dto.id)) throw Error('В списке повторяется INC.')
        ids.add(dto.id)
        const summary = toIncident(dto)
        const prev = desk.records[dto.id]
        const card = {
          ...prev,
          key: dto.id, id: dto.id, title: prev?.title || dto.header || dto.id,
          product: summary.product, team: summary.team,
          state: itsmStateLabels[dto.stateEnum], priority: summary.priority,
          registered: summary.registered, registeredAt: summary.registeredAt,
          due: summary.due, dueAt: summary.dueAt, research: summary.research,
          restoredAt: summary.restoredAt, restoredEpoch: summary.restoredEpoch, groups: dto.groups,
        }
        if (!prev || prev.absent || prev.state !== card.state || prev.priority !== card.priority ||
            prev.team !== card.team || prev.dueAt !== card.dueAt) changed.push(dto.id)
        return card
      })
      const stillPending = [...pending].filter(key => ids.has(key))
      pending.clear()
      for (const key of changed) pending.add(key)
      for (const key of stillPending) pending.add(key)
      if (initialRevision === undefined) {
        initialRevision = list.revision
        for (const key of ids) pending.add(key)
      }
      applySnapshotCards(desk, cards, now)
      dispatchTasks(desk, now)
      desk.apiCounts = list.counts
      desk.apiBeforeFirstSuccess = false
      desk.sourceError = sourceError
      if (successAt) desk.lastImport = successAt
      save(desk)
      publication = list
      generation++
    } else {
      metadata(sourceError, false, successAt)
    }
    checked = now
    void enrich(headers).catch(() => {})
    if (!list.beforeFirstSuccess) {
      void consumeChanges(headers)
      await syncAlarms().catch(() => {})
    }
  }

  return {
    async acknowledge(headers: IncomingHttpHeaders, ids: string[] | undefined) {
      if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => typeof id !== 'string' || !/^evt-\d+$/.test(id))) {
        throw new ItsmError(400, 'Нет показанных сигналов Spring.')
      }
      const token = headers.authorization!.replace(/^Bearer /i, '')
      const result = await credential.run(token, () =>
        journal.request<{confirmedEventIds: string[]}>('/api/dashboard/shift/events/ack', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({eventIds: ids}),
        }, timeout()),
      ).catch(error => {
        if (error instanceof ApiError) throw new ItsmError(error.status, error.message)
        throw error
      })
      alarmGeneration++
      const desk = current()
      const confirmed = new Set(result.confirmedEventIds)
      const now = Date.now()
      const signals = desk.signals.map(signal =>
        signal.acknowledged === undefined && confirmed.has(signal.id) ? {...signal, acknowledged: now} : signal,
      )
      save({...desk, signals, quietUntil: now + 30_000}, false)
    },
    async refresh(headers: IncomingHttpHeaders) {
      if (reading) return reading
      const token = headers.authorization!.replace(/^Bearer /i, '')
      if (Date.now() - checked < 1000) return
      const epoch = generation
      reading = credential.run(token, () => synchronize(headers)).catch(error => {
        if (lifetime.signal.aborted || epoch !== generation) return
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          throw new ItsmError(error.status, 'Нет доступа к данным рабочего места.')
        }
        const message = 'Не удалось получить актуальный снимок из Spring. Повторяем запрос.'
        metadata(message, !current().lastImport || Boolean(current().apiBeforeFirstSuccess))
      }).finally(() => { reading = undefined })
      return reading
    },
    invalidate() { generation++; checked = 0 },
    close() { lifetime.abort() },
    get checked() { return checked },
  }
}
