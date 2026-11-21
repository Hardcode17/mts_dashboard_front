import {getApiAccessToken} from '../../../shared/api/session.ts'
import {createHttpClient, type HttpClientOptions} from '../../../shared/api/http.ts'
import type {
  IncidentDetailResponse,
  IncidentFilters,
  IncidentListResponse,
  IncidentNumber,
  IncidentRelationshipsResponse,
  SnapshotStatus,
} from '../../../entities/incident/model/api-types.ts'

function toSearchParams(filters: IncidentFilters): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value))
    }
  }

  const query = params.toString()
  return query ? `?${query}` : ''
}

export function createIncidentsApi(options: HttpClientOptions = {}) {
  const request = createHttpClient(options)

  return {
    getIncidents(
      filters: IncidentFilters = {},
      signal?: AbortSignal,
    ): Promise<IncidentListResponse> {
      return request(`/api/incidents${toSearchParams(filters)}`, {}, signal)
    },

    getIncident(
      number: IncidentNumber,
      signal?: AbortSignal,
    ): Promise<IncidentDetailResponse> {
      return request(
        `/api/incidents/${encodeURIComponent(number)}`,
        {},
        signal,
      )
    },

    getIncidentRelationships(
      number: IncidentNumber,
      signal?: AbortSignal,
    ): Promise<IncidentRelationshipsResponse> {
      return request(
        `/api/incidents/${encodeURIComponent(number)}/relationships`,
        {},
        signal,
      )
    },

    getSnapshotStatus(signal?: AbortSignal): Promise<SnapshotStatus> {
      return request('/api/snapshot/status', {}, signal)
    },
  }
}

export const incidentsApi = createIncidentsApi({getAccessToken: getApiAccessToken})
