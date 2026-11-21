import type {PriorityId} from '../../entities/incident/model/api-types.ts'
import {ApiError, type HttpClientOptions, createHttpClient} from '../../shared/api/http.ts'

export const notificationChannels = [
  'email', 'sms', 'push', 'telegram', 'mattermost', 'max', 'mts_link', 'mobile_hub', 'mts_notifica',
] as const

export type NotificationChannel = (typeof notificationChannels)[number]

export interface NotificationConnectionSettings {
  channel: NotificationChannel
  address: string
  active: boolean
  priorityIds: PriorityId[]
}

export interface NotificationConnection extends NotificationConnectionSettings {
  id: number
}

const path = '/api/dashboard/notification-connections'

export function createNotificationSettingsApi(fetcher: NonNullable<HttpClientOptions['fetcher']>) {
  const {request} = createHttpClient({fetcher})

  return {
    list(signal?: AbortSignal) {
      return request<NotificationConnection[]>(path, {}, signal)
    },
    save({channel, address, active, priorityIds}: NotificationConnectionSettings, id?: number) {
      return request<NotificationConnection>(id === undefined ? path : path + '/' + id, {
        method: id === undefined ? 'POST' : 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({channel, address, active, priorityIds}),
      }, AbortSignal.timeout(10000))
    },
  }
}

export function isInvalidNotificationSettings(error: unknown) {
  return error instanceof ApiError && error.code === 'INVALID_NOTIFICATION_CONNECTION'
}
