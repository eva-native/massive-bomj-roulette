import type { ErrorResponse } from './types.gen'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & { json?: unknown }

/** Calls the MBR API and returns the parsed JSON body; throws ApiError on non-2xx. */
export async function api<T>(path: string, { json, headers, ...init }: RequestOptions = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: json === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: json === undefined ? undefined : JSON.stringify(json),
  })

  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`
    try {
      message = ((await res.json()) as ErrorResponse).error || message
    } catch {
      // not a JSON error body
    }
    throw new ApiError(res.status, message)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
