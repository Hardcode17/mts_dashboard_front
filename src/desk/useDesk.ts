import {useCallback, useEffect, useRef, useState} from 'react'
import type {Command, Desk, Source} from './types'

interface Reply {
  desk: Desk | null
  version: number
  checked: number
  now: number
  error?: string
}
function linkedSource(): Source | undefined {
  const {hash} = window.location
  if (!/^#(?:evidence|investigation)\//.test(hash)) return
  const value = new URLSearchParams(hash.split('?')[1]).get('dataset')
  return value === 'volume' || value === 'case' ? value : undefined
}

export function useDesk() {
  const [mode, setMode] = useState<Source>(() =>
    linkedSource() ?? (localStorage.getItem('mcc-source') === 'case' ? 'case' : 'volume'),
  )
  const [person, setPerson] = useState(() => localStorage.getItem('mcc-person') || 'anna')
  const [desk, setDesk] = useState<Desk | null>(null)
  const [now, setNow] = useState(Date.now)
  const [checked, setChecked] = useState(0),
    [error, setError] = useState(''),
    [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const current = useRef({mode, version: -1})
  const clockOffset = useRef(0)
  const accept = useCallback((reply: Reply, source: Source) => {
    if (current.current.mode !== source || reply.version < current.current.version) return
    if (reply.desk) {
      current.current.version = reply.version
      setDesk(reply.desk)
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
    void refresh(controller.signal)
    const clock = window.setInterval(() => setNow(Date.now() + clockOffset.current), 1000)
    const timer = window.setInterval(() => void refresh(controller.signal), 2000)
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
  const selectSource = useCallback((value: Source) => {
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
    selectSource(value)
    location.hash = 'desk/source'
  }
  function login(value: string) {
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
    error,
    actionError,
    busy,
    refresh,
    act,
    clearError: () => setActionError(''),
  }
}
export type DeskClient = ReturnType<typeof useDesk>
