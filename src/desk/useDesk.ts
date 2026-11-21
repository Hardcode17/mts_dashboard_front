import {useCallback, useEffect, useRef, useState} from 'react'
import type {Command, Desk, Source} from './types'
import {workspaceIncidents} from './records'
import {usesRealBackend} from '../shared/api/mode'
import {incidentsApi} from '../features/incidents/api/client'
import {toApiDesk} from '../features/incidents/model/toDesk'
import {createIncidentFlowTracker, type IncidentFlow} from '../features/incidents/model/incidentFlow'
import type {IncidentListResponse, SnapshotStatus} from '../entities/incident/model/api-types'

type DataSource = Source | 'api'

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
  const current = useRef<{mode: DataSource; version: number; flowVersion?: number}>({mode, version: -1})
  const flowTracker = useRef<ReturnType<typeof createIncidentFlowTracker> | null>(null)
  const apiSnapshot = useRef<{incidents: IncidentListResponse; status: SnapshotStatus} | null>(null)
  const clockOffset = useRef(0)
  const accept = useCallback((reply: Reply, source: DataSource) => {
    if (current.current.mode !== source || reply.version < current.current.version) return
    if (reply.desk) {
      current.current.version = reply.version
      setDesk(reply.desk)
      if (!reply.desk.apiBeforeFirstSuccess && !reply.desk.sourceError && current.current.flowVersion !== reply.version) {
        const track = (flowTracker.current ??= createIncidentFlowTracker())
        current.current.flowVersion = reply.version
        setIncidentFlow(track(workspaceIncidents(reply.desk.records, reply.desk.mode), reply.now))
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
          const [incidents, status] = await Promise.all([
            incidentsApi.getIncidents({}, requestSignal),
            incidentsApi.getSnapshotStatus(requestSignal),
          ])
          if (signal?.aborted || snapshot !== current.current || incidents.eventSeq < snapshot.version) return
          const previous = apiSnapshot.current
          const changed = previous?.incidents !== incidents ||
            previous.status.stale !== status.stale ||
            previous.status.lastSuccessAt !== status.lastSuccessAt
          apiSnapshot.current = {incidents, status}
          const now = Date.now()
          accept(
            {
              desk: changed ? toApiDesk(incidents, status, now) : null,
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
      setActionError('Источник API пока доступен только для чтения.')
      return false
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
  const selectSource = useCallback((value: DataSource) => {
    if (usesRealBackend) return
    localStorage.setItem('mcc-source', value)
    if (value === current.current.mode) return
    current.current = {mode: value, version: -1}
    flowTracker.current = null
    apiSnapshot.current = null
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
    refresh,
    act,
    clearError: () => setActionError(''),
  }
}
export type DeskClient = ReturnType<typeof useDesk>
