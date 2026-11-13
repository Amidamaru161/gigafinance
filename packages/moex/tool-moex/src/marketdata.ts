/**
 * The model-facing `moex_marketdata` tool: the current market snapshot for one
 * MOEX security on the main board. This module owns the schema, argument
 * validation, row mapping, and formatting; `MoexClient` owns the network access.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { MoexClient, MoexError } from './client.ts'
import type { MoexBlock } from './client.ts'
import { asString, field, parseIntValue, parseNumber, requireBlock } from './parse.ts'

/** The main board id used for market snapshots. */
const SHARES_BOARD = 'TQBR'

/** The canonical `moex_marketdata` output value. */
export interface MarketData {
  /** The security id, uppercased. */
  secid: string
  /** The board this snapshot comes from. */
  board: string
  /** Last trade price. */
  lastPrice?: number
  /** Session open price. */
  open?: number
  /** Session high price. */
  high?: number
  /** Session low price. */
  low?: number
  /** Previous close price. */
  prevPrice?: number
  /** Absolute change versus the previous close. */
  change?: number
  /** Percentage change versus the previous close. */
  changePercent?: number
  /** Session traded volume (lots). */
  volume?: number
  /** Session turnover in the trading currency. */
  value?: number
  /** Number of trades this session. */
  numTrades?: number
  /** Official close price. */
  closePrice?: number
  /** Market price for settlement. */
  marketPrice?: number
  /** Total issue capitalization. */
  issueCapitalization?: number
  /** Trading currency. */
  currency?: string
  /** Exchange system timestamp of the snapshot. */
  lastUpdate?: string
}

/**
 * Validate `moex_marketdata` arguments: a non-blank `secid`.
 * @param args - the schema-validated arguments.
 * @returns the trimmed `secid`.
 */
export function parseMarketdataArgs(args: { secid: string }): { secid: string } {
  if (args.secid.trim().length === 0) throw new Error('secid must be a non-empty string')
  return { secid: args.secid.trim() }
}

/** Require the first row of a block, throwing a typed error when empty. */
function requireRow(block: MoexBlock, name: string): readonly unknown[] {
  const row = block.data[0]
  if (row === undefined) throw new MoexError(`MOEX response has an empty "${name}" block`, 'MOEX_BAD_RESPONSE')
  return row
}

/**
 * Format a market snapshot as one model-facing text block.
 * @param data - the canonical `moex_marketdata` output value.
 * @returns the `Field: value` listing.
 */
export function formatMarketdataOutput(data: MarketData): string {
  const lines: string[] = [`${data.secid} (${data.board})`]
  const add = (label: string, value: string | number | undefined): void => {
    if (value !== undefined) lines.push(`${label}: ${value}`)
  }
  add('Last', data.lastPrice)
  add('Open', data.open)
  add('High', data.high)
  add('Low', data.low)
  add('Prev close', data.prevPrice)
  add('Change', data.change)
  add('Change %', data.changePercent)
  add('Volume (lots)', data.volume)
  add('Turnover', data.value)
  add('Trades', data.numTrades)
  add('Close price', data.closePrice)
  add('Market price', data.marketPrice)
  add('Capitalization', data.issueCapitalization)
  add('Currency', data.currency)
  add('Updated', data.lastUpdate)
  return lines.join('\n')
}

/**
 * Register the `moex_marketdata` tool and its system-prompt guidance.
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the
 *   registrations; both are effect-scoped and unregister on plugin dispose.
 * @param client - the shared MOEX ISS client.
 * @param timeoutMs - the cooperative tool-call budget attached as `timeoutMs`.
 */
export function applyMarketdataTool(ctx: Context, client: MoexClient, timeoutMs: number): void {
  ctx.systemPrompt.section({
    name: 'tool:moex_marketdata',
    order: 120,
    text: 'Use the moex_marketdata tool to read the current market snapshot of one MOEX security by its SECID: last price, open/high/low, previous close, change and change %, session volume and turnover, capitalization, and the exchange update time.',
  })

  ctx.tools.register(defineTool({
    name: 'moex_marketdata',
    description: 'Read the current MOEX market snapshot for one security (last price, change, session volume/turnover, capitalization).',
    parameters: {
      secid: { type: 'string', required: true, description: 'The MOEX security id (SECID), e.g. SBER.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          secid: { type: 'string', required: true },
          board: { type: 'string', required: true },
          lastPrice: { type: 'number' },
          open: { type: 'number' },
          high: { type: 'number' },
          low: { type: 'number' },
          prevPrice: { type: 'number' },
          change: { type: 'number' },
          changePercent: { type: 'number' },
          volume: { type: 'number' },
          value: { type: 'number' },
          numTrades: { type: 'integer' },
          closePrice: { type: 'number' },
          marketPrice: { type: 'number' },
          issueCapitalization: { type: 'number' },
          currency: { type: 'string' },
          lastUpdate: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatMarketdataOutput(value) }],
    },
    timeoutMs,
    // Provider reads do not mutate parent-agent state.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseMarketdataArgs(args)
      const secid = input.secid.toUpperCase()
      const response = await client.get(
        `/engines/stock/markets/shares/boards/${SHARES_BOARD}/securities/${secid}.json`,
        { 'iss.meta': 'off' },
        exec.signal,
      )
      const marketdata = requireBlock(response, 'marketdata')
      const securities = requireBlock(response, 'securities')
      const md = requireRow(marketdata, 'marketdata')
      const sec = requireRow(securities, 'securities')
      const board = asString(field(marketdata, md, 'BOARDID')) ?? SHARES_BOARD
      const lastPrice = parseNumber(field(marketdata, md, 'LAST'))
      const open = parseNumber(field(marketdata, md, 'OPEN'))
      const high = parseNumber(field(marketdata, md, 'HIGH'))
      const low = parseNumber(field(marketdata, md, 'LOW'))
      const change = parseNumber(field(marketdata, md, 'CHANGE'))
      const changePercent = parseNumber(field(marketdata, md, 'LASTCHANGEPRCNT'))
      const volume = parseNumber(field(marketdata, md, 'VOLTODAY'))
      const value = parseNumber(field(marketdata, md, 'VALTODAY'))
      const numTrades = parseIntValue(field(marketdata, md, 'NUMTRADES'))
      const closePrice = parseNumber(field(marketdata, md, 'CLOSEPRICE'))
      const marketPrice = parseNumber(field(marketdata, md, 'MARKETPRICE'))
      const issueCapitalization = parseNumber(field(marketdata, md, 'ISSUECAPITALIZATION'))
      const lastUpdate = asString(field(marketdata, md, 'SYSTIME'))
      const prevPrice = parseNumber(field(securities, sec, 'PREVPRICE'))
      const currency = asString(field(securities, sec, 'CURRENCYID'))
      return {
        secid,
        board,
        ...lastPrice !== undefined ? { lastPrice } : {},
        ...open !== undefined ? { open } : {},
        ...high !== undefined ? { high } : {},
        ...low !== undefined ? { low } : {},
        ...prevPrice !== undefined ? { prevPrice } : {},
        ...change !== undefined ? { change } : {},
        ...changePercent !== undefined ? { changePercent } : {},
        ...volume !== undefined ? { volume } : {},
        ...value !== undefined ? { value } : {},
        ...numTrades !== undefined ? { numTrades } : {},
        ...closePrice !== undefined ? { closePrice } : {},
        ...marketPrice !== undefined ? { marketPrice } : {},
        ...issueCapitalization !== undefined ? { issueCapitalization } : {},
        ...currency !== undefined ? { currency } : {},
        ...lastUpdate !== undefined ? { lastUpdate } : {},
      }
    },
  }))
}
