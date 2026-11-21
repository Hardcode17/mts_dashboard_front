import {useEffect, useState} from 'react'
import type {Incident} from '../../../desk/types'
import type {IncidentDetailResponse} from '../../../entities/incident/model/api-types'
import {usesRealBackend} from '../../../shared/api/mode'
import {incidentsApi} from '../api/client'
import {toIncident} from './toDesk'

type Result = {id: string; observed: number | undefined; detail?: IncidentDetailResponse; receivedAt?: number; error?: string}

export function useOfficialIncident(record: Incident) {
  const {id, updatedAt} = record
  const [result, setResult] = useState<Result>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!usesRealBackend) return
    const controller = new AbortController()
    void incidentsApi.getIncident(id, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]))
      .then(detail => {
        if (detail.incident.id !== id) throw Error('Ответ ITSM относится к другому инциденту.')
        if (!controller.signal.aborted) setResult({id, observed: updatedAt, detail, receivedAt: Date.now()})
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setResult({id, observed: updatedAt,
          error: err instanceof Error ? err.message : 'Не удалось прочитать карточку ITSM.'})
      })
    return () => controller.abort()
  }, [id, updatedAt, attempt])

  const current = result?.id === id && result.observed === updatedAt ? result : undefined
  const detail = current?.detail
  const receivedAt = current?.receivedAt
  const incident: Incident = detail ? {
    ...record,
    ...toIncident(detail.incident),
    key: record.key,
    updatedAt,
    itsmUrl: detail.itsmUrl,
    itsmDemo: detail.itsmDemo,
    meetingUrl: detail.meetingUrl ?? record.meetingUrl,
    deadlineStatus: receivedAt !== undefined && detail.incident.remainingSeconds !== null ? {
      remainingSeconds: detail.incident.remainingSeconds,
      overdue: detail.incident.overdue,
      observedAt: receivedAt,
    } : undefined,
  } : record
  function retry() {
    setResult(undefined)
    setAttempt(value => value + 1)
  }
  return {incident, error: current?.error, retry}
}
