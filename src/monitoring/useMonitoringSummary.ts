import {useEffect, useState} from 'react'
import {ApiError, createHttpClient} from '../shared/api/http.ts'
import {getApiAccessToken} from '../shared/api/session.ts'
import {parseMonitoringSummary, type MonitoringSummary} from './summary.ts'

export const MONITORING_SUMMARY_URL = '/api/dashboard/monitoring/summary'
export const MONITORING_POLL_MS = 5_000
const REQUEST_TIMEOUT_MS = 4_500
const requestSummary = createHttpClient({getAccessToken: getApiAccessToken})

export type MonitoringConnection = 'loading' | 'ready' | 'stale' | 'error'

export interface MonitoringState {
  data: MonitoringSummary | null
  connection: MonitoringConnection
  error: string
  lastSuccess: number | null
}

const initialState: MonitoringState = {
  data: null,
  connection: 'loading',
  error: '',
  lastSuccess: null,
}

function requestError(error: unknown): string {
  if (error instanceof ApiError) return responseError(error.status).message
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'Сервис не ответил вовремя'
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'Нет подключения к сети'
  return error instanceof Error && error.message ? error.message : 'Неизвестная ошибка запроса'
}

function responseError(status: number): Error {
  if (status === 401 || status === 403) return new Error(`Нет доступа к мониторингу (HTTP ${status})`)
  return new Error(`Мониторинг недоступен (HTTP ${status})`)
}

export function useMonitoringSummary(): MonitoringState {
  const [state, setState] = useState<MonitoringState>(initialState)

  useEffect(() => {
    let disposed = false
    let timer = 0
    let request: AbortController | null = null
    let inFlight = false
    let wakeAfterCurrent = false
    let sequence = 0

    async function poll(): Promise<void> {
      if (disposed) return
      if (inFlight) {
        wakeAfterCurrent = true
        return
      }
      inFlight = true
      const current = ++sequence
      const started = Date.now()
      const controller = new AbortController()
      request = controller
      try {
        const payload = await requestSummary<unknown>(
          MONITORING_SUMMARY_URL,
          {},
          AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        )
        const data = parseMonitoringSummary(payload)
        if (disposed || current !== sequence) return
        setState({
          data,
          connection: 'ready',
          error: '',
          lastSuccess: Date.now(),
        })
      } catch (error) {
        if (disposed || current !== sequence) return
        setState((previous) => ({
          ...previous,
          connection: previous.data ? 'stale' : 'error',
          error: requestError(error),
        }))
      } finally {
        inFlight = false
        if (!disposed && current === sequence) {
          if (wakeAfterCurrent) {
            wakeAfterCurrent = false
            timer = window.setTimeout(() => void poll(), 0)
          } else {
            timer = window.setTimeout(
              () => void poll(),
              Math.max(0, MONITORING_POLL_MS - (Date.now() - started)),
            )
          }
        }
      }
    }

    function wake(): void {
      if (disposed) return
      if (inFlight) {
        wakeAfterCurrent = true
        return
      }
      window.clearTimeout(timer)
      void poll()
    }

    function onVisibilityChange(): void {
      if (document.visibilityState === 'visible') wake()
    }

    function onPageShow(): void {
      wake()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('pageshow', onPageShow)
    void poll()

    return () => {
      disposed = true
      sequence += 1
      window.clearTimeout(timer)
      request?.abort()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  return state
}
