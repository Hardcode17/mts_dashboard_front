import {useEffect, useState} from 'react'
import type {Incident} from '../../../desk/types'
import {incidentsApi} from '../api/client'
import {toIncident} from './toDesk'

interface CardResult {
  id: string
  revision: number
  record?: Incident
  error?: string
}

export function useApiIncident(id: string | undefined, revision: number): {record?: Incident; error?: string} {
  const [result, setResult] = useState<CardResult>()

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)])
    void incidentsApi.getIncident(id, signal).then(detail => {
      if (!signal.aborted) {
        setResult({id, revision, record: {...toIncident(detail.incident), itsmUrl: detail.itsmUrl}})
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : 'Карточка недоступна.'
        setResult(previous => ({
          id,
          revision,
          record: previous?.id === id ? previous.record : undefined,
          error: message,
        }))
      }
    })
    return () => controller.abort()
  }, [id, revision])

  if (!id || result?.id !== id) return {}
  return {record: result.record, error: result.revision === revision ? result.error : undefined}
}
