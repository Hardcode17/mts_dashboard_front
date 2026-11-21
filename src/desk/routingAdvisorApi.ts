import type {Incident} from '../demoData'
import {usesRealBackend} from '../shared/api/mode'

const BASE = '/routing-advisor'
const SEARCH_TIMEOUT = 30_000
const CATALOGUE_TIMEOUT = 10_000

export const routingAdvisorEnabled =
  import.meta.env.VITE_ROUTING_ADVISOR_ENABLED === 'true' && !usesRealBackend

export interface RoutingCatalogue {
  service: string[]
  site: string[]
  infrastructure: string[]
}

export interface RoutingAnalogue {
  incident_id: string
  source_ref?: string
  matched_signals: string[]
  differences: string[]
  outcome: string | null
  resolved_by: string | null
  similarity: number
}

export interface RoutingRecommendation {
  group: string
  incident_ids: string[]
  reasons: string[]
}

export interface RoutingSearchResult {
  incident_id: string
  analogues: RoutingAnalogue[]
  recommendation: RoutingRecommendation | null
  candidate_count?: number
}

export interface RoutingSearchRequest {
  incident_id: string
  symptom: string
  service?: string
  site?: string
  infrastructure?: string[]
  current_group?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw Error(`Некорректный ответ локального поиска: ${field}`)
  return value
}

function optionalText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw Error(`Некорректный ответ локального поиска: ${field}`)
  return value
}

function strings(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw Error(`Некорректный ответ локального поиска: ${field}`)
  }
  return value
}

function similarity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw Error('Некорректный ответ локального поиска: similarity')
  }
  return value
}

function parseCatalogue(value: unknown): RoutingCatalogue {
  if (!isRecord(value)) throw Error('Некорректный ответ локального каталога.')
  return {
    service: strings(value.service, 'service'),
    site: strings(value.site, 'site'),
    infrastructure: strings(value.infrastructure, 'infrastructure'),
  }
}

function parseAnalogue(value: unknown): RoutingAnalogue {
  if (!isRecord(value)) throw Error('Некорректный ответ локального поиска: analogue')
  return {
    incident_id: text(value.incident_id, 'analogue.incident_id'),
    source_ref: typeof value.source_ref === 'string' ? value.source_ref : undefined,
    matched_signals: strings(value.matched_signals, 'analogue.matched_signals'),
    differences: strings(value.differences, 'analogue.differences'),
    outcome: optionalText(value.outcome, 'analogue.outcome'),
    resolved_by: optionalText(value.resolved_by, 'analogue.resolved_by'),
    similarity: similarity(value.similarity),
  }
}

function parseRecommendation(value: unknown): RoutingRecommendation | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) throw Error('Некорректный ответ локального поиска: recommendation')
  return {
    group: text(value.group, 'recommendation.group'),
    incident_ids: strings(value.incident_ids, 'recommendation.incident_ids'),
    reasons: strings(value.reasons, 'recommendation.reasons'),
  }
}

function parseSearch(value: unknown): RoutingSearchResult {
  if (!isRecord(value) || !Array.isArray(value.analogues)) {
    throw Error('Некорректный ответ локального поиска.')
  }
  const candidateCount = value.candidate_count
  if (candidateCount !== undefined && (typeof candidateCount !== 'number' || !Number.isFinite(candidateCount))) {
    throw Error('Некорректный ответ локального поиска: candidate_count')
  }
  return {
    incident_id: text(value.incident_id, 'incident_id'),
    analogues: value.analogues.map(parseAnalogue),
    recommendation: parseRecommendation(value.recommendation),
    candidate_count: candidateCount,
  }
}

function requestSignal(signal: AbortSignal | undefined, timeout: number) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
}

async function request(path: string, init: RequestInit, signal: AbortSignal | undefined, timeout: number) {
  let response: Response
  try {
    response = await fetch(BASE + path, {
      ...init,
      signal: requestSignal(signal, timeout),
      headers: {Accept: 'application/json', ...init.headers},
      cache: 'no-store',
    })
  } catch (error) {
    if (signal?.aborted) throw error
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw Error('Локальный поиск не ответил за ' + timeout / 1000 + ' с.')
    }
    throw Error('Локальный сервис поиска недоступен.')
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw Error('Локальный сервис поиска вернул ответ не в формате JSON.')
  }
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string' ? body.error : 'HTTP ' + response.status
    throw Error(message)
  }
  return body
}

export async function fetchRoutingCatalogue(signal?: AbortSignal): Promise<RoutingCatalogue> {
  return parseCatalogue(await request('/catalogue', {method: 'GET'}, signal, CATALOGUE_TIMEOUT))
}

export async function searchRouting(
  body: RoutingSearchRequest,
  signal?: AbortSignal,
): Promise<RoutingSearchResult> {
  return parseSearch(
    await request(
      '/search',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      },
      signal,
      SEARCH_TIMEOUT,
    ),
  )
}

export function incidentSymptom(item: Incident): string {
  const description = item.description || item.impact || ''
  const symptom = (item.title + (description ? '. ' + description : '')).replace(/\s+/g, ' ').trim()
  return symptom.slice(0, 1000)
}

export function routingQuerySymptom(item: Incident, input: string): string {
  const text = input.replace(/\s+/g, ' ').trim()
  const source = incidentSymptom(item)
  if (!text) return ''
  if (text === source) return text.slice(0, 1000)
  const title = item.title.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU')
  if (title && text.toLocaleLowerCase('ru-RU').includes(title)) return text.slice(0, 1000)
  return (source + '. ' + text).slice(0, 1000)
}
