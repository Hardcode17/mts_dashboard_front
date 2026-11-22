import {createHttpClient, type HttpClientOptions} from '../../shared/api/http.ts'

export interface HandoverItem {
  taskId: number
  incidentId: string
  priority: number
  deadline: string | null
  title: string
  team: string | null
  situationKey: string | null
  claimedAt: string | null
  available: boolean
}

export interface HandoverBatch {
  id: number
  senderName: string
  recipientName: string
  createdAt: string
  summary: string
  items: HandoverItem[]
}

export interface HandoverInbox {
  recipients: {id: number; name: string}[]
  owned: HandoverItem[]
  incoming: HandoverBatch[]
  outgoing: HandoverBatch[]
}

export interface CreateHandover {
  requestId: string
  recipientId: number
  taskIds: number[]
  summary: string
  situationKeys?: Record<number, string>
}

const route = '/api/dashboard/shift-handovers'

export function createShiftHandoverApi(fetcher: NonNullable<HttpClientOptions['fetcher']>) {
  const {request, requestResponse} = createHttpClient({fetcher})
  return {
    load(signal?: AbortSignal) {
      return request<HandoverInbox>(route, {}, signal)
    },
    send(batch: CreateHandover) {
      return request<{id: number}>(route, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(batch),
      })
    },
    take(batchId: number, taskId: number) {
      return requestResponse(route + '/' + batchId + '/tasks/' + taskId + '/claim', {method: 'POST'})
    },
    queue(signal?: AbortSignal) {
      return request<{taskId: number; incidentId: string}[]>('/api/dashboard/coordination-tasks', {}, signal)
    },
    takeFromQueue(taskId: number) {
      return requestResponse('/api/dashboard/coordination-tasks/' + taskId + '/claim', {method: 'POST'})
    },
  }
}
