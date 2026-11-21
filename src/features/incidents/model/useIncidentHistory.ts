import {useEffect, useState} from 'react'
import type {DashboardHistoryEvent} from '../../../entities/incident/model/dashboard-contract'
import {incidentsApi} from '../api/client'

export type IncidentHistoryLoad =
  | {status: 'idle' | 'loading' | 'ready'; events: readonly DashboardHistoryEvent[]; error?: undefined}
  | {status: 'error'; events: readonly DashboardHistoryEvent[]; error: string}

const idle: IncidentHistoryLoad = {status: 'idle', events: []}
const loading: IncidentHistoryLoad = {status: 'loading', events: []}

export function useIncidentHistory(id: string | undefined, revision: number): IncidentHistoryLoad {
  const [result, setResult] = useState<{id: string; revision: number; history: IncidentHistoryLoad}>()

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)])
    void incidentsApi.getHistory(id, signal).then(
      ({events}) => {
        if (!controller.signal.aborted) setResult({id, revision, history: {status: 'ready', events}})
      },
      () => {
        if (!controller.signal.aborted) setResult({
          id,
          revision,
          history: {status: 'error', events: [], error: 'История изменений недоступна.'},
        })
      },
    )
    return () => controller.abort()
  }, [id, revision])

  if (!id) return idle
  return result?.id === id && result.revision === revision ? result.history : loading
}
