import {usesRealBackend} from '../shared/api/mode'
import {workspaceFetch} from '../auth/session'
import {useCallback, useEffect, useRef, useState} from 'react'
import type {Command, Desk, DirectoryUser, Source} from './types'
import {confirmedIncident, officialFailure, type OfficialCard, type OfficialChanges} from './official'
import type {Incident} from '../demoData'

interface Reply {
  desk: Desk | null
  version: number
  checked: number
  now: number
  error?: string
  person?: string
  itsmExternal?: boolean
}
function linkedSource(): Source | undefined {
  const {hash, search} = window.location
  const params = new URLSearchParams(search)
  const selected = params.get('dataset')
  if((!/^#(?:evidence|investigation)\//.test(hash) || !hash.includes('dataset=')) && (selected==='case'||selected==='volume')) return selected
  if (!/^#(?:evidence|investigation)\//.test(hash)) return
  const value = new URLSearchParams(hash.split('?')[1]).get('dataset')
  return value === 'volume' || value === 'case' ? value : undefined
}

export function useDesk() {
  const [mode, setMode] = useState<Source>(() =>
    usesRealBackend ? 'case' : linkedSource() ?? (localStorage.getItem('mcc-source') === 'case' ? 'case' : 'volume'),
  )
  const [person, setPerson] = useState(() => usesRealBackend ? '' : localStorage.getItem('mcc-person') || 'anna')
  const [desk, setDesk] = useState<Desk | null>(null)
  const [now, setNow] = useState(Date.now)
  const [itsmExternal, setItsmExternal] = useState(false)
  const [checked, setChecked] = useState(0),
    [error, setError] = useState(''),
    [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [directory, setDirectory] = useState<DirectoryUser[] | null>(null),
    [directoryError, setDirectoryError] = useState('')
  const current = useRef({mode, version: -1})
  const clockOffset = useRef(0)
  const accept = useCallback((reply: Reply, source: Source) => {
    if (current.current.mode !== source || reply.version < current.current.version) return
    if (reply.desk) {
      current.current.version = reply.version
      setDesk(reply.desk)
    }
    if (usesRealBackend && reply.person) setPerson(reply.person)
    if (reply.itsmExternal !== undefined) setItsmExternal(reply.itsmExternal)
    setChecked(reply.checked)
    clockOffset.current = reply.now - Date.now()
    setNow(reply.now)
    setError('')
  }, [])
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const snapshot = current.current
      try {
        const r = await workspaceFetch('/api/stand/snapshot?mode=' + snapshot.mode + '&since=' + snapshot.version, {
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
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
    void refresh(controller.signal)
    const clock = window.setInterval(() => setNow(Date.now() + clockOffset.current), 1000)
    const timer = window.setInterval(() => void refresh(controller.signal), usesRealBackend ? 5000 : 2000)
    return () => {
      controller.abort()
      clearInterval(timer)
      clearInterval(clock)
    }
  }, [mode, refresh])
  async function act(command: Command) {
    const source = current.current.mode
    setBusy(true)
    setActionError('')
    try {
      const r = await workspaceFetch('/api/stand/action?mode=' + source, {
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
      const r = await workspaceFetch('/api/dashboard/users', {cache: 'no-store', signal: AbortSignal.timeout(5000)})
      if (!r.ok) throw Error('HTTP ' + r.status)
      const list: unknown = await r.json()
      if (!Array.isArray(list) || !list.every((u) => u && typeof (u as DirectoryUser).login === 'string' && typeof (u as DirectoryUser).name === 'string'))
        throw Error('Справочник получен в неожиданном формате.')
      setDirectory(
        list.map((u, index) => {
          const user = u as Partial<DirectoryUser>
          return {
            sysId: typeof user.sysId === 'string' ? user.sysId : 'user-' + index,
            login: user.login!,
            name: user.name!,
            groupName: typeof user.groupName === 'string' ? user.groupName : '',
          }
        }),
      )
      return true
    } catch (e) {
      setDirectoryError(e instanceof Error ? e.message : 'Справочник недоступен.')
      return false
    }
  }, [])
  // Only show a changed assignment after the API confirms the write.
  async function patchIncident(incident: Incident, changes: OfficialChanges): Promise<{ok: boolean; error?: string; record?: Incident}> {
    const body: Record<string, unknown> = {}
    if (changes.assignedEmployeeLogin !== undefined) body.assignedEmployeeLogin = changes.assignedEmployeeLogin
    if (changes.assignedGroupName !== undefined) body.assignedGroupName = changes.assignedGroupName
    if (changes.stateEnum !== undefined) body.stateEnum = changes.stateEnum
    if (changes.solution !== undefined) body.solution = changes.solution
    if (!Object.keys(body).length) return {ok: false, error: 'Нет изменений для отправки.'}
    try {
      const r = await workspaceFetch('/api/dashboard/incidents/' + encodeURIComponent(incident.id), {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      })
      const reply: unknown = await r.json().catch(() => null)
      if (!r.ok) throw Error(officialFailure(r.status, reply))
      const record = confirmedIncident(desk?.records[incident.key] ?? incident, reply as OfficialCard)
      await refresh()
      return {ok: true, record}
    } catch (e) {
      void refresh()
      return {ok: false, error: e instanceof Error ? e.message : 'Ошибка сохранения'}
    }
  }
  const selectSource = useCallback((value: Source) => {
    if (usesRealBackend) return
    localStorage.setItem('mcc-source', value)
    if (value === current.current.mode) return
    current.current = {mode: value, version: -1}
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
  function source(value: Source) {
    const url=new URL(window.location.href)
    if(url.searchParams.has('dataset')){
      url.searchParams.set('dataset',value)
      history.replaceState(history.state,'',url)
    }
    selectSource(value)
    location.hash = 'stand'
  }
  function login(value: string) {
    if (usesRealBackend) return
    localStorage.setItem('mcc-person', value)
    setPerson(value)
  }
  return {
    desk,
    mode,
    person,
    source,
    login,
    now,
    checked,
    itsmExternal,
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
