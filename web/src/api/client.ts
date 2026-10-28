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

/** The error text when a request never reached the server. */
export const NETWORK_ERROR = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'

/**
 * Calls the MBR API and returns the parsed JSON body; throws ApiError on
 * non-2xx, and ApiError with status 0 when the server could not be reached.
 */
export async function api<T>(path: string, { json, headers, ...init }: RequestOptions = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: json === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: json === undefined ? undefined : JSON.stringify(json),
    })
  } catch (err) {
    // Without a connection fetch rejects with a TypeError worded by the browser ("Failed to fetch").
    if (err instanceof TypeError) throw new ApiError(0, NETWORK_ERROR)
    throw err
  }

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
