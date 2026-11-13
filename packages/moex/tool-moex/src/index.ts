/**
 * Model-facing Moscow Exchange (MOEX) tools over the public ISS JSON API. This
 * package owns the schemas, validation, row mapping, formatting, and the shared
 * HTTP client; it never exposes credentials and reads only public endpoints.
 * @module @deepseek-ai/dsh-tool-moex
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { MoexClient } from './client.ts'
import { applySecuritiesTool, DEFAULT_SECURITIES_LIMIT, MAX_SECURITIES_LIMIT } from './securities.ts'
import { applySecurityTool } from './security.ts'
import { applyCandlesTool, DEFAULT_MAX_CANDLES, MAX_CANDLES } from './candles.ts'
import { applyMarketdataTool } from './marketdata.ts'

export { MoexClient, MoexError } from './client.ts'
export type { MoexBlock, MoexResponse, MoexClientOptions } from './client.ts'
export { asBoolean, asString, field, parseIntValue, parseNumber, requireBlock } from './parse.ts'
export {
  DEFAULT_SECURITIES_LIMIT,
  MAX_SECURITIES_LIMIT,
  applySecuritiesTool,
  formatSecuritiesOutput,
  parseSecuritiesArgs,
} from './securities.ts'
export type { SecurityRecord, SecuritiesResult, SecuritiesArgs } from './securities.ts'
export {
  applySecurityTool,
  formatSecurityOutput,
  parseSecurityArgs,
} from './security.ts'
export type { SecurityBoard, SecurityProfile } from './security.ts'
export {
  CANDLE_INTERVALS,
  DEFAULT_CANDLE_INTERVAL,
  DEFAULT_MAX_CANDLES,
  MAX_CANDLES,
  applyCandlesTool,
  formatCandlesOutput,
  parseCandlesArgs,
} from './candles.ts'
export type { Candle, CandlesResult, CandlesArgs } from './candles.ts'
export {
  applyMarketdataTool,
  formatMarketdataOutput,
  parseMarketdataArgs,
} from './marketdata.ts'
export type { MarketData } from './marketdata.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-moex'

/** Services required by the MOEX tool suite. */
export const inject = ['tools', 'systemPrompt']

/** Default ISS base URL. */
export const DEFAULT_BASE_URL = 'https://iss.moex.com/iss'

/** Default cooperative tool-call timeout budget (ms). */
export const DEFAULT_TIMEOUT_MS = 30_000

/** Default `User-Agent`: an explicit product agent, never a browser disguise. */
export const DEFAULT_USER_AGENT = 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)'

/** Plugin config: which tools to register, the transport, and the result caps. */
export interface Config {
  /** ISS base URL. Defaults to `https://iss.moex.com/iss`. */
  baseUrl?: string
  /** Cooperative tool-call timeout budget (ms). Defaults to 30000. */
  timeoutMs?: number
  /** `User-Agent` header sent on every request. */
  userAgent?: string
  /** Register `moex_securities`. Defaults to true. */
  securities?: boolean
  /** Register `moex_security`. Defaults to true. */
  security?: boolean
  /** Register `moex_candles`. Defaults to true. */
  candles?: boolean
  /** Register `moex_marketdata`. Defaults to true. */
  marketdata?: boolean
  /** Upper bound on securities returned by one `moex_securities` call. */
  maxSecurities?: number
  /** Upper bound on candles returned by one `moex_candles` call. */
  maxCandles?: number
}

export const Config: z<Config> = z.object({
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
  securities: z.boolean().default(true),
  security: z.boolean().default(true),
  candles: z.boolean().default(true),
  marketdata: z.boolean().default(true),
  maxSecurities: z.number().default(DEFAULT_SECURITIES_LIMIT),
  maxCandles: z.number().default(DEFAULT_MAX_CANDLES),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/** A positive finite timeout within Node's timer range. */
function assertTimeoutMs(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('tool-moex: timeoutMs must be a positive finite number')
  }
  if (value > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-moex: timeoutMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** A result cap must be a positive integer within its bound. */
function assertLimit(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`tool-moex: ${name} must be an integer between 1 and ${max}`)
  }
}

/** The base URL must be an absolute http(s) URL. */
function assertBaseUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('tool-moex: baseUrl must be an absolute URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('tool-moex: baseUrl must be http(s)')
  }
}

/**
 * Register the enabled MOEX tools and their system-prompt guidance. Each tool
 * is registered through an effect-scoped registry, so plugin disposal removes
 * it. The shared client fuses the cooperative budget (`timeoutMs`) with caller
 * cancellation on every request.
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the
 *   registrations.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertTimeoutMs(resolved.timeoutMs)
  assertLimit('maxSecurities', resolved.maxSecurities, MAX_SECURITIES_LIMIT)
  assertLimit('maxCandles', resolved.maxCandles, MAX_CANDLES)
  assertBaseUrl(resolved.baseUrl)
  const client = new MoexClient({
    baseUrl: resolved.baseUrl,
    timeoutMs: resolved.timeoutMs,
    userAgent: resolved.userAgent,
  })
  if (resolved.securities) applySecuritiesTool(ctx, client, resolved.timeoutMs)
  if (resolved.security) applySecurityTool(ctx, client, resolved.timeoutMs)
  if (resolved.candles) applyCandlesTool(ctx, client, resolved.timeoutMs, resolved.maxCandles)
  if (resolved.marketdata) applyMarketdataTool(ctx, client, resolved.timeoutMs)
}
