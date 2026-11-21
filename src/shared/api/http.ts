import type {ApiErrorDto} from '../../entities/incident/model/api-types.ts'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, error: ApiErrorDto) {
    super(error.message)
    this.name = 'ApiError'
    this.status = status
    this.code = error.code
  }
}

export interface HttpClientOptions {
  baseUrl?: string
  getAccessToken?: () => string | null | undefined
}

export function createHttpClient(options: HttpClientOptions = {}) {
  const baseUrl = options.baseUrl ?? ''

  async function requestResponse(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    const token = options.getAccessToken?.()

    headers.set('Accept', 'application/json')
    if (token) headers.set('Authorization', `Bearer ${token}`)

    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      signal,
      cache: 'no-store',
    })

    if (!response.ok && response.status !== 304) {
      const error = (await response.json().catch(() => null)) as ApiErrorDto | null
      throw new ApiError(
        response.status,
        error?.code && error.message
          ? error
          : {code: `HTTP_${response.status}`, message: response.statusText},
      )
    }

    return response
  }

  async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
    const response = await requestResponse(path, init, signal)
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  return {request, requestResponse}
}
