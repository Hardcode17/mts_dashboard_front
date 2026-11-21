import {ApiError, createHttpClient, type HttpClientOptions} from '../../../shared/api/http.ts'
import type {
  IncidentDetailResponse,
  IncidentDto,
  IncidentListResponse,
  IncidentNumber,
  IncidentRelationshipsResponse,
  SnapshotStatus,
  SimilarIncidentsResponse,
} from '../../../entities/incident/model/api-types.ts'
import type {
  DashboardIdentity,
  DashboardIncidentCard,
  DashboardIncidentPage,
  DashboardIncidentQuery,
  DashboardIncidentSummary,
} from '../../../entities/incident/model/dashboard-contract.ts'

const listPath = '/api/dashboard/incidents'

function listUrl(query: DashboardIncidentQuery) {
  const params = new URLSearchParams()
  for (const group of query.group ?? []) params.append('group', group)
  if (query.includeCompleted !== undefined) params.set('includeCompleted', String(query.includeCompleted))
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor) params.set('cursor', query.cursor)
  const search = params.toString()
  return listPath + (search ? '?' + search : '')
}

function mapIncident(summary: DashboardIncidentSummary, detail?: DashboardIncidentCard): IncidentDto {
  return {
    id: summary.id,
    header: detail?.header ?? '',
    description: detail?.description ?? null,
    productName: summary.productName ?? null,
    service: detail?.service ?? null,
    serviceType: detail?.serviceType ?? null,
    submitDate: summary.submitDate,
    updatedAt: undefined,
    completionDate: summary.completionDate ?? null,
    stateEnum: summary.stateEnum,
    priorityId: summary.priorityId,
    assignedGroupName: summary.assignedGroupName ?? null,
    assignedEmployee: detail?.assignedEmployee ?? null,
    assignedEmployeeLogin: detail?.assignedEmployeeLogin,
    solution: detail?.solution,
    deadline: summary.deadline,
    remainingSeconds: detail?.remainingSeconds ?? null,
    overdue: detail?.overdue ?? false,
    groups: summary.groupMemberships.map(({group}) => group === 'coordinator' ? 'coordinators' : group),
    deadlineRisk: detail?.deadlineRisk ?? null,
  }
}

type ListQuery = Omit<DashboardIncidentQuery, 'cursor' | 'limit'>

export function createIncidentsApi(options: HttpClientOptions = {}) {
  const {request, requestResponse} = createHttpClient(options)
  const cache = new Map<string, {etag: string | null; data: IncidentListResponse}>()

  async function getIncidents(query: ListQuery = {}, signal?: AbortSignal): Promise<IncidentListResponse> {
    const firstQuery = {...query, includeCompleted: query.includeCompleted ?? true, limit: 100}
    const url = listUrl(firstQuery)
    const previous = cache.get(url)
    const response = await requestResponse(url, {
      headers: previous?.etag ? {'If-None-Match': previous.etag} : {},
    }, signal)
    if (response.status === 304 && previous) return previous.data

    const first = await response.json() as DashboardIncidentPage
    const items = first.items.map(item => mapIncident(item))
    const seenCursors = new Set<string>()
    let cursor = first.nextCursor
    while (cursor) {
      if (seenCursors.has(cursor)) throw new ApiError(409, {code: 'INVALID_CURSOR', message: 'Сервер повторил курсор списка.'})
      seenCursors.add(cursor)
      const next = await request<DashboardIncidentPage>(listUrl({...firstQuery, cursor}), {}, signal)
      if (next.eventSeq !== first.eventSeq || next.revision !== first.revision) {
        throw new ApiError(409, {code: 'SNAPSHOT_CHANGED', message: 'Снимок изменился во время загрузки списка.'})
      }
      items.push(...next.items.map(item => mapIncident(item)))
      cursor = next.nextCursor
    }
    const counts = {critical: 0, coordinators: 0, high: 0, research: 0}
    for (const group of first.groups) {
      counts[group.key === 'coordinator' ? 'coordinators' : group.key] = group.incidentCount
    }
    const data = {revision: first.revision, eventSeq: first.eventSeq, beforeFirstSuccess: first.beforeFirstSuccess, counts, items}
    cache.set(url, {etag: response.headers.get('ETag'), data})
    return data
  }

  return {
    getIncidents,
    getPage(query: DashboardIncidentQuery, signal?: AbortSignal) {
      return request<DashboardIncidentPage>(listUrl(query), {}, signal)
    },
    async getIncident(number: IncidentNumber, signal?: AbortSignal): Promise<IncidentDetailResponse> {
      const card = await request<DashboardIncidentCard>(listPath + '/' + encodeURIComponent(number), {}, signal)
      return {
        revision: card.revision,
        incident: mapIncident(card, card),
        itsmUrl: card.itsmUrl,
        itsmDemo: card.itsmDemo,
        meetingUrl: null,
      }
    },

    getSimilar(number: IncidentNumber, signal?: AbortSignal) {
      return request<SimilarIncidentsResponse>(listPath + '/' + encodeURIComponent(number) + '/similar', {}, signal)
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

    getSnapshotStatus(signal?: AbortSignal) {
      return request<SnapshotStatus>('/api/snapshot/status', {}, signal)
    },
    getIdentity(signal?: AbortSignal) {
      return request<DashboardIdentity>('/api/me', {}, signal)
    },
  }
}

let accessToken: string | undefined
export function setDashboardAccessToken(token: string | undefined) {
  accessToken = token
}

export const getDashboardAccessToken = () => accessToken

export const incidentsApi = createIncidentsApi({getAccessToken: () => accessToken})
