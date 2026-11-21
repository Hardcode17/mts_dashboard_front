import {useCallback, useEffect, useRef, useState} from 'react'
import type {Command, Desk, DirectoryUser, Incident, Signal, Source} from './types'
import {confirmedIncident, officialFailure, type OfficialCard, type OfficialChanges} from './official'
import {workspaceIncidents} from './records'
import {usesRealBackend} from '../shared/api/mode'
import {ApiError} from '../shared/api/http'
import {incidentsApi} from '../features/incidents/api/client'
import {toApiDesk, toIncident} from '../features/incidents/model/toDesk'
import {createIncidentFlowTracker, type IncidentFlow} from '../features/incidents/model/incidentFlow'
import type {IncidentListResponse, SnapshotStatus} from '../entities/incident/model/api-types'
import type {DashboardShiftEvent} from '../entities/incident/model/dashboard-contract'

type DataSource = Source | 'api'

function shiftSignals(events: DashboardShiftEvent[]): Signal[] {
  return events.map(event => ({
    id: event.eventId,
    key: event.incidentId,
    at: Date.parse(event.occurredAt),
    title: event.incident?.header ?? undefined,
  }))
}

function sameSignals(first: Signal[], next: Signal[]) {
  return first.length === next.length && first.every((signal, index) => signal.id === next[index].id)
}

interface Reply {
  desk: Desk | null
  version: number
  checked: number
  now: number
  error?: string
}
function linkedSource(): DataSource | undefined {
  const {hash} = window.location
  if (!/^#(?:evidence|investigation)\//.test(hash)) return
  const value = new URLSearchParams(hash.split('?')[1]).get('dataset')
  return value === 'volume' || value === 'case' || value === 'api'
    ? value
    : undefined
}

function savedSource(): DataSource {
  const saved = localStorage.getItem('mcc-source')
  return saved === 'case' || saved === 'volume' || saved === 'api'
    ? saved
    : 'volume'
}

export function useDesk() {
  const [mode, setMode] = useState<DataSource>(() => usesRealBackend ? 'api' : linkedSource() ?? savedSource())
  const [person, setPerson] = useState(() => usesRealBackend ? '' : localStorage.getItem('mcc-person') || 'anna')
  const [desk, setDesk] = useState<Desk | null>(null)
  const [incidentFlow, setIncidentFlow] = useState<IncidentFlow | null>(null)
  const [now, setNow] = useState(Date.now)
  const [checked, setChecked] = useState(0),
    [error, setError] = useState(''),
    [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [directory, setDirectory] = useState<DirectoryUser[] | null>(null),
    [directoryError, setDirectoryError] = useState('')
  const current = useRef<{mode: DataSource; version: number; flowVersion?: number}>({mode, version: -1})
  const flowTracker = useRef<ReturnType<typeof createIncidentFlowTracker> | null>(null)
  const apiSnapshot = useRef<{incidents: IncidentListResponse; status: SnapshotStatus} | null>(null)
  const apiShift = useRef({signals: [] as Signal[], quietUntil: 0, writeVersion: 0})
  const clockOffset = useRef(0)
  const accept = useCallback((reply: Reply, source: DataSource) => {
    if (current.current.mode !== source || reply.version < current.current.version) return
    if (reply.desk) {
      current.current.version = reply.version
      setDesk(reply.desk)
      if (!reply.desk.apiBeforeFirstSuccess && !reply.desk.sourceError && current.current.flowVersion !== reply.version) {
        const track = (flowTracker.current ??= createIncidentFlowTracker())
        current.current.flowVersion = reply.version
        setIncidentFlow(track(workspaceIncidents(reply.desk.records), reply.now))
      }
    }
    setChecked(reply.checked)
    clockOffset.current = reply.now - Date.now()
    setNow(reply.now)
    setError('')
  }, [])
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const snapshot = current.current
      try {
        if (snapshot.mode === 'api') {
          const timeout = AbortSignal.timeout(5000)
          const requestSignal = signal
            ? AbortSignal.any([signal, timeout])
            : timeout
          const shiftWriteVersion = apiShift.current.writeVersion
          const [incidents, status, signals] = await Promise.all([
            incidentsApi.getIncidents({}, requestSignal),
            incidentsApi.getSnapshotStatus(requestSignal),
            incidentsApi.getPendingShiftEvents(requestSignal).then(shiftSignals).catch(() => null),
          ])
          if (signal?.aborted || snapshot !== current.current || incidents.eventSeq < snapshot.version) return
          const shift = apiShift.current
          const shiftChanged = signals !== null && shiftWriteVersion === shift.writeVersion &&
            !sameSignals(shift.signals, signals)
          if (shiftChanged) shift.signals = signals
          const previous = apiSnapshot.current
          const changed = shiftChanged || previous?.incidents !== incidents ||
            previous.status.stale !== status.stale ||
            previous.status.lastSuccessAt !== status.lastSuccessAt ||
            previous.status.lastReceivedAt !== status.lastReceivedAt
          apiSnapshot.current = {incidents, status}
          const now = Date.now()
          accept(
            {
              desk: changed ? {...toApiDesk(incidents, status, now), signals: shift.signals, quietUntil: shift.quietUntil} : null,
              version: incidents.eventSeq,
              checked: now,
              now,
            },
            snapshot.mode,
          )
          return
        }

        const r = await fetch('/api/stand/snapshot?mode=' + snapshot.mode + '&since=' + snapshot.version, {
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
          cache: 'no-store',
        })
        if (!r.ok) throw Error('HTTP ' + r.status)
        accept(await r.json(), snapshot.mode)
      } catch (e) {
      if (!signal?.aborted && snapshot.mode === current.current.mode)
        setError('Источник недоступен. ' + (e instanceof Error ? e.message : ''))
      }
    },
    [accept],
  )
  useEffect(() => {
    const controller = new AbortController()
    const initialRequest = window.setTimeout(() => void refresh(controller.signal), 0)
    const clock = window.setInterval(() => setNow(Date.now() + clockOffset.current), 1000)
    const timer = window.setInterval(
      () => void refresh(controller.signal),
      mode === 'api' ? 5000 : 2000,
    )
    return () => {
      controller.abort()
      clearTimeout(initialRequest)
      clearInterval(timer)
      clearInterval(clock)
    }
  }, [mode, refresh])
  async function act(command: Command) {
    const source = current.current.mode
    if (source === 'api') {
      if (command.type !== 'ack' || !command.ids?.length) {
        setActionError('Это действие пока недоступно в API рабочего места.')
        return false
      }
      setBusy(true)
      setActionError('')
      try {
        const {confirmedEventIds, events} = await incidentsApi.acknowledgeShiftEvents(command.ids, AbortSignal.timeout(5000))
        const shift = apiShift.current
        const confirmed = new Set(confirmedEventIds)
        const remaining = new Map(shift.signals.filter(event => !confirmed.has(event.id)).map(event => [event.id, event]))
        for (const event of shiftSignals(events.filter(event => event.ackRequired))) remaining.set(event.id, event)
        shift.signals = [...remaining.values()]
        shift.quietUntil = Date.now() + 30_000
        shift.writeVersion += 1
        setDesk(previous => previous && {...previous, signals: shift.signals, quietUntil: shift.quietUntil})
        void refresh()
        return true
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Не удалось подтвердить просмотр.')
        return false
      } finally {
        setBusy(false)
      }
    }
    setBusy(true)
    setActionError('')
    try {
      const r = await fetch('/api/stand/action?mode=' + source, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(command),
      })
      const reply: Reply = await r.json()
      if (!r.ok) throw Error(reply.error || 'Действие отклонено')
      accept(reply, source)
      return true
    } catch (e) {
      if (current.current.mode === source) setActionError(e instanceof Error ? e.message : 'Ошибка действия')
      void refresh()
      return false
    } finally {
      setBusy(false)
    }
  }
  /** Справочник исполнителей ITSM: GET /api/dashboard/users (KAN-58). */
  const loadUsers = useCallback(async () => {
    setDirectoryError('')
    try {
      setDirectory(await incidentsApi.getUsers(AbortSignal.timeout(5000)))
      return true
    } catch (e) {
      setDirectoryError(e instanceof Error ? e.message : 'Справочник недоступен.')
      return false
    }
  }, [])
  /**
   * Официальное изменение инцидента: PATCH /api/dashboard/incidents/{id}.
   * Карточка и группы меняются только после подтверждения сервера.
   */
  async function patchIncident(incident: Incident, changes: OfficialChanges): Promise<{ok: boolean; error?: string; record?: Incident}> {
    const {assignedEmployeeLogin, assignedGroupName, stateEnum, solution} = changes
    const body = {assignedEmployeeLogin, assignedGroupName, stateEnum, solution}
    if (Object.values(body).every(value => value === undefined)) return {ok: false, error: 'Нет изменений для отправки.'}
    const source = current.current
    const signal = AbortSignal.timeout(15_000)
    try {
      if (source.mode === 'api') {
        const {detail, eventSeq} = await incidentsApi.patchIncident(incident.id, body, signal)
        const record = {...toIncident(detail.incident), itsmUrl: detail.itsmUrl}
        if (source === current.current && eventSeq >= source.version) {
          source.version = eventSeq
          // Группы и их счётчики обновляются вместе из подтверждённого списка, не вычисляются на клиенте.
          setDesk(previous => previous && {...previous, records: {
            ...previous.records,
            [incident.key]: {...record, groups: previous.records[incident.key]?.groups ?? record.groups},
          }})
          void refresh()
        }
        return {ok: true, record}
      }
      const r = await fetch('/api/dashboard/incidents/' + encodeURIComponent(incident.id), {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
        signal,
      })
      const reply: unknown = await r.json().catch(() => null)
      if (!r.ok) throw Error(officialFailure(r.status, reply))
      const record = confirmedIncident(desk?.records[incident.key] ?? incident, reply as OfficialCard)
      setDesk((d) => (d ? {...d, records: {...d.records, [incident.key]: record}} : d))
      void refresh()
      return {ok: true, record}
    } catch (e) {
      return {ok: false, error: e instanceof ApiError ? `${e.message} · ${e.code}` : e instanceof Error ? e.message : 'Ошибка сохранения'}
    }
  }
  const selectSource = useCallback((value: DataSource) => {
    if (usesRealBackend) return
    localStorage.setItem('mcc-source', value)
    if (value === current.current.mode) return
    current.current = {mode: value, version: -1}
    flowTracker.current = null
    apiSnapshot.current = null
    apiShift.current = {signals: [], quietUntil: 0, writeVersion: 0}
    setDirectory(null)
    setDirectoryError('')
    setIncidentFlow(null)
    setDesk(null)
    setChecked(0)
    setError('')
    setActionError('')
    setMode(value)
  }, [])
  useEffect(() => {
    function followLink() {
      const requested = linkedSource()
      if (requested) selectSource(requested)
    }
    followLink()
    window.addEventListener('hashchange', followLink)
    return () => window.removeEventListener('hashchange', followLink)
  }, [selectSource])
  function source(value: DataSource) {
    selectSource(value)
    location.hash = 'desk/source'
  }
  function login(value: string) {
    localStorage.setItem('mcc-person', value)
    setPerson(value)
  }
  return {
    desk,
    incidentFlow,
    mode,
    person,
    source,
    login,
    now,
    checked,
    error,
    actionError,
    busy,
    directory,
    directoryError,
    loadUsers,
    refresh,
    act,
    patchIncident,
    clearError: () => setActionError(''),
  }
}
export type DeskClient = ReturnType<typeof useDesk>
