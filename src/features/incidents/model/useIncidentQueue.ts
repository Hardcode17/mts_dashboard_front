import {useEffect, useState} from 'react'
import type {QueueKey} from '../../../desk/types'
import type {IncidentDto} from '../../../entities/incident/model/api-types'
import {incidentsApi} from '../api/client'
import {queueFilterQuery} from './queueFilters'

type QueueResult =
  | {key: string; items: IncidentDto[]; failed?: false}
  | {key: string; failed: true}

export function useIncidentQueue(key: string, queue: QueueKey | 'all', refresh: number, clockBucket: number) {
  const [result, setResult] = useState<QueueResult>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const query = queueFilterQuery(key, queue)
    const timer = window.setTimeout(() => {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
      void incidentsApi.getIncidents(query, signal).then(
        ({items}) => {if (!controller.signal.aborted) setResult({key, items})},
        () => {if (!controller.signal.aborted) setResult({key, failed: true})},
      )
    }, query.q ? 250 : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [key, queue, refresh, clockBucket, attempt])

  const current = result?.key === key ? result : undefined
  return {
    items: current?.failed ? undefined : current?.items,
    failed: current?.failed === true,
    retry: () => {
      setResult(undefined)
      setAttempt(value => value + 1)
    },
  }
}
