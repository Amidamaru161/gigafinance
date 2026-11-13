/**
 * The model-facing `moex_candles` tool: historical OHLCV candles for one MOEX
 * security. This module owns the schema, argument validation, interval enum,
 * row mapping, and formatting; `MoexClient` owns the network access.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { MoexClient } from './client.ts'
import type { MoexBlock } from './client.ts'
import { asString, field, parseNumber, requireBlock } from './parse.ts'

/** The candle interval value used when the model omits one (1 day). */
export const DEFAULT_CANDLE_INTERVAL = '24'

/** Candle intervals accepted by the ISS candles endpoint. */
export const CANDLE_INTERVALS = ['1', '10', '60', '24', '7', '31', '4'] as const

/** Default cap on returned candles (newest kept). */
export const DEFAULT_MAX_CANDLES = 100

/** Hard upper bound on returned candles per call. */
export const MAX_CANDLES = 1000

/** One OHLCV candle as normalized by the tool. */
export interface Candle {
  /** Period start timestamp (local exchange time). */
  begin: string
  /** Period end timestamp (local exchange time). */
  end: string
  /** Open price. */
  open?: number
  /** Close price. */
  close?: number
  /** High price. */
  high?: number
  /** Low price. */
  low?: number
  /** Turnover in the trading currency. */
  value?: number
  /** Traded volume (units). */
  volume?: number
}

/** The canonical `moex_candles` output value. */
export interface CandlesResult {
  /** The security id, uppercased. */
  secid: string
  /** The resolved candle interval value. */
  interval: string
  /** Candles in chronological order, capped to the newest `maxCandles`. */
  candles: Candle[]
  /** True when the source held more candles than `maxCandles`. */
  truncated: boolean
}

/** Validated `moex_candles` arguments. */
export interface CandlesArgs {
  /** Uppercased security id. */
  secid: string
  /** The resolved interval value. */
  interval: string
  /** Optional start date (YYYY-MM-DD). */
  from?: string
  /** Optional end date (YYYY-MM-DD). */
  till?: string
}

/**
 * Validate `moex_candles` arguments: non-blank secid, a known interval, and
 * `YYYY-MM-DD` dates when supplied.
 * @param args - the schema-validated arguments.
 * @returns the normalized arguments.
 */
export function parseCandlesArgs(args: { secid: string; interval?: string; from?: string; till?: string }): CandlesArgs {
  if (args.secid.trim().length === 0) throw new Error('secid must be a non-empty string')
  const interval = args.interval ?? DEFAULT_CANDLE_INTERVAL
  if (!(CANDLE_INTERVALS as readonly string[]).includes(interval)) {
    throw new Error(`interval must be one of ${CANDLE_INTERVALS.join(', ')}`)
  }
  const from = args.from?.trim()
  const till = args.till?.trim()
  if (from !== undefined && from !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('from must be YYYY-MM-DD')
  if (till !== undefined && till !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(till)) throw new Error('till must be YYYY-MM-DD')
  return {
    secid: args.secid.trim().toUpperCase(),
    interval,
    ...from !== undefined && from !== '' ? { from } : {},
    ...till !== undefined && till !== '' ? { till } : {},
  }
}

/** Map one candles row into a {@link Candle}. */
function mapCandle(block: MoexBlock, row: readonly unknown[]): Candle {
  const begin = asString(field(block, row, 'begin')) ?? ''
  const end = asString(field(block, row, 'end')) ?? ''
  const open = parseNumber(field(block, row, 'open'))
  const close = parseNumber(field(block, row, 'close'))
  const high = parseNumber(field(block, row, 'high'))
  const low = parseNumber(field(block, row, 'low'))
  const value = parseNumber(field(block, row, 'value'))
  const volume = parseNumber(field(block, row, 'volume'))
  return {
    begin,
    end,
    ...open !== undefined ? { open } : {},
    ...close !== undefined ? { close } : {},
    ...high !== undefined ? { high } : {},
    ...low !== undefined ? { low } : {},
    ...value !== undefined ? { value } : {},
    ...volume !== undefined ? { volume } : {},
  }
}

/** Render one cell value, with `-` for absent numbers. */
function cell(value: number | undefined): string {
  return value === undefined ? '-' : String(value)
}

/**
 * Format a candles result as one model-facing text block: a markdown table
 * preceded by a one-line summary.
 * @param result - the canonical `moex_candles` output value.
 * @returns the summary line, the table, and an optional truncation note.
 */
export function formatCandlesOutput(result: CandlesResult): string {
  if (result.candles.length === 0) {
    return `No MOEX candles found for ${result.secid} (interval ${result.interval}).`
  }
  const header = `MOEX candles for ${result.secid} (interval ${result.interval}): ${result.candles.length} rows`
  const rows = result.candles.map(c =>
    `| ${c.begin} | ${cell(c.open)} | ${cell(c.high)} | ${cell(c.low)} | ${cell(c.close)} | ${cell(c.volume)} | ${cell(c.value)} |`)
  const table = [
    '| Begin | Open | High | Low | Close | Volume | Value |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
  const footer = result.truncated
    ? `\n\n(Showing the ${result.candles.length} newest candles. Set from/till for an older range.)`
    : ''
  return `${header}\n\n${table}${footer}`
}

/**
 * Register the `moex_candles` tool and its system-prompt guidance.
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the
 *   registrations; both are effect-scoped and unregister on plugin dispose.
 * @param client - the shared MOEX ISS client.
 * @param timeoutMs - the cooperative tool-call budget attached as `timeoutMs`.
 * @param maxCandles - the candle cap (newest kept).
 */
export function applyCandlesTool(ctx: Context, client: MoexClient, timeoutMs: number, maxCandles: number): void {
  ctx.systemPrompt.section({
    name: 'tool:moex_candles',
    order: 119,
    text: 'Use the moex_candles tool to read historical OHLCV candles for one MOEX security by its SECID. Intervals: 1, 10, 60 (minutes), 24 (day, default), 7 (week), 31 (month), 4 (quarter). Set from/till (YYYY-MM-DD) for a specific range; otherwise the newest candles are returned.',
  })

  ctx.tools.register(defineTool({
    name: 'moex_candles',
    description: 'Read historical OHLCV candles for one MOEX security (open, high, low, close, volume, turnover).',
    parameters: {
      secid: { type: 'string', required: true, description: 'The MOEX security id (SECID), e.g. SBER.' },
      interval: { type: 'string', enum: CANDLE_INTERVALS, description: 'Candle interval: 1/10/60 minutes, 24 = day (default), 7 = week, 31 = month, 4 = quarter.' },
      from: { type: 'string', description: 'Optional start date (YYYY-MM-DD).' },
      till: { type: 'string', description: 'Optional end date (YYYY-MM-DD).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          secid: { type: 'string', required: true },
          interval: { type: 'string', required: true },
          candles: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                begin: { type: 'string', required: true },
                end: { type: 'string', required: true },
                open: { type: 'number' },
                close: { type: 'number' },
                high: { type: 'number' },
                low: { type: 'number' },
                value: { type: 'number' },
                volume: { type: 'number' },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatCandlesOutput(value) }],
    },
    timeoutMs,
    // Provider reads do not mutate parent-agent state.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseCandlesArgs(args)
      const response = await client.get(
        `/engines/stock/markets/shares/securities/${input.secid}/candles.json`,
        {
          interval: input.interval,
          ...input.from !== undefined ? { from: input.from } : {},
          ...input.till !== undefined ? { till: input.till } : {},
          'iss.meta': 'off',
          'iss.only': 'candles',
        },
        exec.signal,
      )
      const block = requireBlock(response, 'candles')
      const rows = block.data.slice(-maxCandles)
      return {
        secid: input.secid,
        interval: input.interval,
        candles: rows.map(row => mapCandle(block, row)),
        truncated: block.data.length > rows.length,
      }
    },
  }))
}
