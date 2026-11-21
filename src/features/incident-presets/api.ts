import {itsmEnumForState, itsmStateLabels, type ItsmState, type QueueKey} from '../../desk/types.ts'
import {createHttpClient, type HttpClientOptions} from '../../shared/api/http.ts'

const filterNames = ['q', 'priority', 'product', 'team', 'state', 'serviceType', 'deadline', 'sort', 'size', 'sla'] as const
type FilterName = (typeof filterNames)[number]
type PresetQueue = 'all' | 'critical' | 'coordinator' | 'high' | 'research'

export interface IncidentPresetSettings {
  name: string
  queue: PresetQueue
  filters: Partial<Record<FilterName, string>>
}

export interface IncidentPreset extends IncidentPresetSettings {
  id: number
}

const queueRoutes: Record<PresetQueue, QueueKey | 'all'> = {
  all: 'all', critical: 'critical', coordinator: 'assigned', high: 'high', research: 'research',
}
const base = '/api/dashboard/incident-presets'

export function presetFromQueue(name: string, route: QueueKey | 'all', params: URLSearchParams): IncidentPresetSettings {
  const filters: IncidentPresetSettings['filters'] = {}
  for (const key of filterNames) {
    const value = params.get(key)?.trim()
    if (!value || (key === 'sla' && route !== 'critical')) continue
    if (key === 'state') {
      const state = itsmEnumForState(value) ?? (Object.hasOwn(itsmStateLabels, value) ? value : undefined)
      if (state) filters.state = state
    } else filters[key] = value
  }
  return {name: name.trim(), queue: route === 'assigned' ? 'coordinator' : route, filters}
}

export function presetHref(preset: IncidentPresetSettings) {
  const params = new URLSearchParams()
  for (const key of filterNames) {
    const value = preset.filters[key]
    if (!value) continue
    if (key === 'state' && Object.hasOwn(itsmStateLabels, value)) {
      params.set(key, itsmStateLabels[value as ItsmState])
    } else params.set(key, value)
  }
  const query = params.toString()
  const queue = Object.hasOwn(queueRoutes, preset.queue) ? queueRoutes[preset.queue] : 'all'
  return '#queue/' + queue + (query ? '?' + query : '')
}

export function createIncidentPresetsApi(fetcher: NonNullable<HttpClientOptions['fetcher']>) {
  const {request} = createHttpClient({fetcher})
  const timeout = () => AbortSignal.timeout(10000)
  return {
    list(signal?: AbortSignal) {
      return request<IncidentPreset[]>(base, {}, signal)
    },
    save({name, queue, filters}: IncidentPresetSettings, id?: number) {
      return request<IncidentPreset>(id === undefined ? base : base + '/' + id, {
        method: id === undefined ? 'POST' : 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name, queue, filters}),
      }, timeout())
    },
    remove(id: number) {
      return request<void>(base + '/' + id, {method: 'DELETE'}, timeout())
    },
  }
}
