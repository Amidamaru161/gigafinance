/**
 * HTTP client and error type for the Moscow Exchange (MOEX) ISS JSON API. The
 * package talks to the public ISS endpoints directly and owns transport limits,
 * timeout fusion, JSON parsing, and error translation; presentation stays in
 * the tool adapters.
 * @module @deepseek-ai/dsh-tool-moex/client
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'

/** One columnar ISS block: a column-name list and parallel row arrays. */
export interface MoexBlock {
  readonly columns: readonly string[]
  readonly data: readonly (readonly unknown[])[]
}

/** The ISS response envelope: named columnar blocks. */
export type MoexResponse = Record<string, MoexBlock>

/** Timeout code stamped on the fused deadline signal. */
const MOEX_TIMEOUT_CODE = 'MOEX_TIMEOUT'

/** Typed MOEX failure with a machine-routable `code`. */
export class MoexError extends HarnessError {}

/** Transport and parsing options for the ISS client. */
export interface MoexClientOptions {
  /** Base URL without a trailing slash, e.g. `https://iss.moex.com/iss`. */
  readonly baseUrl: string
  /** Backstop timeout (ms) fused with caller cancellation. */
  readonly timeoutMs: number
  /** `User-Agent` header sent on every request. */
  readonly userAgent: string
  /** Injectable fetch (defaults to `globalThis.fetch`) for tests. */
  readonly fetchFn?: typeof fetch
}

/**
 * Minimal HTTP client for the MOEX ISS API. Requests carry no cookies or
 * ambient credentials; responses are parsed as a columnar JSON envelope and
 * returned intact for the tool adapters to map.
 */
export class MoexClient {
  readonly #baseUrl: string
  readonly #timeoutMs: number
  readonly #userAgent: string
  readonly #fetch: typeof fetch

  constructor(options: MoexClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.#timeoutMs = options.timeoutMs
    this.#userAgent = options.userAgent
    this.#fetch = options.fetchFn ?? globalThis.fetch
  }

  /**
   * GET one ISS path and parse its JSON envelope.
   * @param path - path relative to the base URL, e.g. `/securities.json`.
   * @param query - query parameters; `undefined` values are omitted.
   * @param signal - caller cancellation, fused with the configured timeout.
   * @returns the parsed columnar envelope.
   */
  async get(path: string, query?: Record<string, string | undefined>, signal?: AbortSignal): Promise<MoexResponse> {
    if (signal?.aborted) throw new MoexError('moex request aborted', 'MOEX_ABORTED')
    using d = deadline(signal, this.#timeoutMs, MOEX_TIMEOUT_CODE)
    let response: Response
    try {
      response = await this.#fetch(this.#url(path, query), {
        method: 'GET',
        headers: { 'user-agent': this.#userAgent, accept: 'application/json' },
        signal: d.signal,
      })
    } catch (error) {
      throw translate(error, d.signal)
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {
        // Best-effort socket cleanup; the status already decides the error.
      })
      throw new MoexError(`MOEX ISS returned HTTP ${response.status}`, 'MOEX_HTTP_ERROR')
    }
    try {
      return await response.json() as MoexResponse
    } catch (error) {
      throw new MoexError(`MOEX ISS returned invalid JSON: ${String(error)}`, 'MOEX_BAD_RESPONSE', { cause: error })
    }
  }

  #url(path: string, query?: Record<string, string | undefined>): string {
    const params = new URLSearchParams()
    if (query !== undefined) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.set(key, value)
      }
    }
    const qs = params.toString()
    return `${this.#baseUrl}${path}${qs === '' ? '' : `?${qs}`}`
  }
}

/** Translate a fetch throw into a typed MoexError by deadline reason. */
function translate(error: unknown, signal: AbortSignal): MoexError {
  const timeout = timeoutOf(signal, MOEX_TIMEOUT_CODE)
  if (timeout !== undefined) return new MoexError('moex request timed out', 'MOEX_TIMEOUT', { cause: timeout })
  if (signal.aborted) return new MoexError('moex request aborted', 'MOEX_ABORTED', { cause: error })
  return new MoexError(`moex request failed: ${String(error)}`, 'MOEX_PROVIDER_ERROR', { cause: error })
}
