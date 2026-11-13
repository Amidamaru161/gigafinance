/**
 * The model-facing `moex_securities` tool: discover MOEX-listed companies and
 * securities by ticker, name, or ISIN, or list the main-board shares. This
 * module owns the schema, argument validation, row mapping, and formatting;
 * `MoexClient` owns the network access.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { MoexClient } from './client.ts'
import type { MoexBlock } from './client.ts'
import { asBoolean, asString, field, parseIntValue, parseNumber, requireBlock } from './parse.ts'

/** Default result cap for one `moex_securities` call. */
export const DEFAULT_SECURITIES_LIMIT = 25

/** Hard upper bound on returned securities per call. */
export const MAX_SECURITIES_LIMIT = 100

/** The MOEX main-board id used by the list mode. */
const SHARES_BOARD = 'TQBR'

/** One security row normalized across the search and list sources. */
export interface SecurityRecord {
  /** Stable MOEX security id (ticker-like code), e.g. `SBER`. */
  secid: string
  /** Full name, falling back to the short name or the secid. */
  name: string
  /** Short display name, e.g. `Сбербанк`. */
  shortname?: string
  /** ISIN code, e.g. `RU0009029540`. */
  isin?: string
  /** Instrument type code, e.g. `common_share`. */
  type?: string
  /** Instrument group code, e.g. `stock_shares`. */
  group?: string
  /** Primary trading board id, e.g. `TQBR`. */
  board?: string
  /** Trading currency, e.g. `SUR`/`RUB`. */
  currency?: string
  /** Whether the security is traded. */
  isTraded?: boolean
  /** Previous close price (list mode only). */
  prevPrice?: number
  /** Lot size in units (list mode only). */
  lotSize?: number
  /** Issuer legal title (search mode only). */
  issuerTitle?: string
  /** Issuer INN (search mode only). */
  issuerInn?: string
  /** Issuer OKPO (search mode only). */
  issuerOkpo?: string
}

/** The canonical `moex_securities` output value. */
export interface SecuritiesResult {
  /** Normalized securities, already capped to `limit`. */
  securities: SecurityRecord[]
  /** True when the source held more rows than `limit`. */
  truncated: boolean
  /** The search query, present only in search mode. */
  query?: string
  /** The listed board, present only in list mode. */
  board?: string
}

/** Validated `moex_securities` arguments: an optional query and a resolved limit. */
export interface SecuritiesArgs {
  /** Non-blank search query, or `undefined` to list the main-board shares. */
  query?: string
  /** The resolved result cap. */
  limit: number
}

/**
 * Validate `moex_securities` arguments. A blank query selects list mode.
 * @param args - the schema-validated arguments.
 * @returns the non-blank query (when any) and the resolved limit.
 */
export function parseSecuritiesArgs(args: { query?: string; limit?: number }): SecuritiesArgs {
  const limit = args.limit ?? DEFAULT_SECURITIES_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SECURITIES_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_SECURITIES_LIMIT}`)
  }
  const query = args.query?.trim()
  return { ...query !== undefined && query !== '' ? { query } : {}, limit }
}

/** Map one search-endpoint row (lowercase columns) into a {@link SecurityRecord}. */
function mapSearchRow(block: MoexBlock, row: readonly unknown[]): SecurityRecord {
  const secid = asString(field(block, row, 'secid')) ?? ''
  const name = asString(field(block, row, 'name')) ?? asString(field(block, row, 'shortname')) ?? secid
  const shortname = asString(field(block, row, 'shortname'))
  const isin = asString(field(block, row, 'isin'))
  const type = asString(field(block, row, 'type'))
  const group = asString(field(block, row, 'group'))
  const board = asString(field(block, row, 'primary_boardid'))
  const isTraded = asBoolean(field(block, row, 'is_traded'))
  const issuerTitle = asString(field(block, row, 'emitent_title'))
  const issuerInn = asString(field(block, row, 'emitent_inn'))
  const issuerOkpo = asString(field(block, row, 'emitent_okpo'))
  return {
    secid,
    name,
    ...shortname !== undefined ? { shortname } : {},
    ...isin !== undefined ? { isin } : {},
    ...type !== undefined ? { type } : {},
    ...group !== undefined ? { group } : {},
    ...board !== undefined ? { board } : {},
    ...isTraded !== undefined ? { isTraded } : {},
    ...issuerTitle !== undefined ? { issuerTitle } : {},
    ...issuerInn !== undefined ? { issuerInn } : {},
    ...issuerOkpo !== undefined ? { issuerOkpo } : {},
  }
}

/** Map one board-list row (uppercase columns) into a {@link SecurityRecord}. */
function mapBoardRow(block: MoexBlock, row: readonly unknown[]): SecurityRecord {
  const secid = asString(field(block, row, 'SECID')) ?? ''
  const name = asString(field(block, row, 'SECNAME')) ?? asString(field(block, row, 'SHORTNAME')) ?? secid
  const shortname = asString(field(block, row, 'SHORTNAME'))
  const isin = asString(field(block, row, 'ISIN'))
  const board = asString(field(block, row, 'BOARDID'))
  const currency = asString(field(block, row, 'CURRENCYID'))
  const prevPrice = parseNumber(field(block, row, 'PREVPRICE'))
  const lotSize = parseIntValue(field(block, row, 'LOTSIZE'))
  return {
    secid,
    name,
    ...shortname !== undefined ? { shortname } : {},
    ...isin !== undefined ? { isin } : {},
    ...board !== undefined ? { board } : {},
    ...currency !== undefined ? { currency } : {},
    ...prevPrice !== undefined ? { prevPrice } : {},
    ...lotSize !== undefined ? { lotSize } : {},
  }
}

/** Build the human-facing bullet line for one security, using present fields only. */
function formatSecurity(s: SecurityRecord): string {
  const parts: string[] = [`${s.secid} — ${s.name}`]
  if (s.shortname !== undefined && s.shortname !== s.name) parts.push(`(${s.shortname})`)
  if (s.type !== undefined) parts.push(`type=${s.type}`)
  if (s.group !== undefined) parts.push(`group=${s.group}`)
  if (s.isin !== undefined) parts.push(`ISIN=${s.isin}`)
  if (s.currency !== undefined) parts.push(s.currency)
  if (s.prevPrice !== undefined) parts.push(`prev=${s.prevPrice}`)
  if (s.lotSize !== undefined) parts.push(`lot=${s.lotSize}`)
  if (s.issuerTitle !== undefined) parts.push(`issuer="${s.issuerTitle}"`)
  if (s.issuerInn !== undefined) parts.push(`INN=${s.issuerInn}`)
  return `- ${parts.join(' · ')}`
}

/**
 * Format a securities result as one model-facing text block.
 * @param result - the canonical `moex_securities` output value.
 * @returns the markdown list, heading, and an optional truncation note.
 */
export function formatSecuritiesOutput(result: SecuritiesResult): string {
  if (result.securities.length === 0) {
    return result.query !== undefined ? `No MOEX securities matched "${result.query}".` : 'No MOEX securities found.'
  }
  const heading = result.query !== undefined
    ? `MOEX securities matching "${result.query}"`
    : `MOEX ${result.board ?? ''} shares`.trim()
  const lines = result.securities.map(formatSecurity)
  const footer = result.truncated
    ? `\n\n(Showing the first ${result.securities.length} results. Narrow the query or raise limit for more.)`
    : ''
  return `${heading}:\n${lines.join('\n')}${footer}`
}

/**
 * Register the `moex_securities` tool and its system-prompt guidance.
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the
 *   registrations; both are effect-scoped and unregister on plugin dispose.
 * @param client - the shared MOEX ISS client.
 * @param timeoutMs - the cooperative tool-call budget attached as `timeoutMs`.
 */
export function applySecuritiesTool(ctx: Context, client: MoexClient, timeoutMs: number): void {
  ctx.systemPrompt.section({
    name: 'tool:moex_securities',
    order: 117,
    text: 'Use the moex_securities tool to find companies and securities listed on Moscow Exchange (MOEX) by ticker, name, or ISIN, or to list the main-board shares when you need a broad view. It returns each security\'s SECID, name, ISIN, instrument type, and (for searched securities) issuer identity.',
  })

  ctx.tools.register(defineTool({
    name: 'moex_securities',
    description: 'Search MOEX-listed securities by ticker, name, or ISIN; omit the query to list the main-board shares.',
    parameters: {
      query: { type: 'string', description: 'Optional ticker, company name, or ISIN to search for. Omit to list main-board shares.' },
      limit: { type: 'integer', description: `Optional maximum number of results (1-${MAX_SECURITIES_LIMIT}, default ${DEFAULT_SECURITIES_LIMIT}).` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          securities: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                secid: { type: 'string', required: true },
                name: { type: 'string', required: true },
                shortname: { type: 'string' },
                isin: { type: 'string' },
                type: { type: 'string' },
                group: { type: 'string' },
                board: { type: 'string' },
                currency: { type: 'string' },
                isTraded: { type: 'boolean' },
                prevPrice: { type: 'number' },
                lotSize: { type: 'integer' },
                issuerTitle: { type: 'string' },
                issuerInn: { type: 'string' },
                issuerOkpo: { type: 'string' },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
          query: { type: 'string' },
          board: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatSecuritiesOutput(value) }],
    },
    timeoutMs,
    // Provider reads do not mutate parent-agent state.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseSecuritiesArgs(args)
      if (input.query !== undefined) {
        const response = await client.get(
          '/securities.json',
          { q: input.query, 'iss.meta': 'off', 'iss.only': 'securities' },
          exec.signal,
        )
        const block = requireBlock(response, 'securities')
        const rows = block.data.slice(0, input.limit)
        return {
          securities: rows.map(row => mapSearchRow(block, row)),
          truncated: block.data.length > rows.length,
          query: input.query,
        }
      }
      const response = await client.get(
        '/engines/stock/markets/shares/boards/TQBR/securities.json',
        { 'iss.meta': 'off', 'iss.only': 'securities' },
        exec.signal,
      )
      const block = requireBlock(response, 'securities')
      const rows = block.data.slice(0, input.limit)
      return {
        securities: rows.map(row => mapBoardRow(block, row)),
        truncated: block.data.length > rows.length,
        board: SHARES_BOARD,
      }
    },
  }))
}
