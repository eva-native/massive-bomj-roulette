import type { ErrorResponse } from './types.gen'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ApiError'
    this.status = status
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & { json?: unknown }

/** The error text when a request never reached the server. */
export const NETWORK_ERROR = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'

/**
 * How browsers word a fetch that failed for lack of a connection: Chrome,
 * Firefox, Safari, React Native. fetch throws TypeError for a malformed
 * request too (a header with Cyrillic, a body on GET); that is a bug, not a
 * connection problem, and is passed on as is.
 */
const networkFailure = /^(Failed to fetch|NetworkError|Load failed|Network request failed)/

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
    if (err instanceof TypeError && networkFailure.test(err.message)) throw new ApiError(0, NETWORK_ERROR, { cause: err })
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
