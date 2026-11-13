import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as ToolMoex from '@deepseek-ai/dsh-tool-moex'
import {
  formatCandlesOutput,
  formatMarketdataOutput,
  formatSecuritiesOutput,
  formatSecurityOutput,
  parseCandlesArgs,
  parseMarketdataArgs,
  parseSecuritiesArgs,
  parseSecurityArgs,
} from '@deepseek-ai/dsh-tool-moex'

const testToolSignal = new AbortController().signal

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Build a minimal `Response`-shaped object for the client. */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    body: null,
    json: async () => body,
  } as unknown as Response
}

/** A `fetch` mock that returns one canned JSON body. */
function fetchMock(body: unknown): typeof fetch {
  return vi.fn<typeof fetch>(async () => jsonResponse(body))
}

/** Mount the real registries and the MOEX tool suite; return an executor helper. */
async function mount(opts: { config?: ToolMoex.Config; fetch?: typeof fetch } = {}): Promise<{
  ctx: Context
  fiber: Awaited<ReturnType<Context['plugin']>>
  call: (name: string, args: unknown) => Promise<ToolExecutionResult>
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (opts.fetch !== undefined) vi.stubGlobal('fetch', opts.fetch)
  const fiber = await ctx.plugin(ToolMoex, opts.config ?? {})
  let counter = 0
  const call = (name: string, args: unknown) => ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++counter}`),
    name,
    arguments: args,
  })
  return { ctx, fiber, call }
}

/** Join text content blocks into one string. */
function textOf(content: ContentBlock[]): string {
  return content.map(block => block.type === 'text' ? block.text : '').join('')
}

const securitiesSearchResponse = {
  securities: {
    columns: ['secid', 'shortname', 'name', 'isin', 'is_traded', 'emitent_id', 'emitent_title', 'emitent_inn', 'emitent_okpo', 'type', 'group', 'primary_boardid'],
    data: [
      ['SBER', 'Сбербанк', 'Сбербанк России ПАО ао', 'RU0009029540', 1, 484, 'ПАО Сбербанк', '7707083893', '00032537', 'common_share', 'stock_shares', 'TQBR'],
    ],
  },
}

const boardListResponse = {
  securities: {
    columns: ['SECID', 'BOARDID', 'SHORTNAME', 'SECNAME', 'ISIN', 'CURRENCYID', 'PREVPRICE', 'LOTSIZE'],
    data: [
      ['ABIO', 'TQBR', 'iАРТГЕН ао', 'ПАО "Артген"', 'RU000A0JNAB6', 'SUR', '44.32', '10'],
      ['SBER', 'TQBR', 'Сбербанк', 'Сбербанк России ПАО ао', 'RU0009029540', 'RUB', '272.79', '10'],
    ],
  },
}

const securityResponse = {
  description: {
    columns: ['name', 'title', 'value', 'type', 'sort_order', 'is_hidden', 'precision'],
    data: [
      ['NAME', 'Full', 'Сбербанк России ПАО ао', 'string', 3, 0, null],
      ['SHORTNAME', 'Short', 'Сбербанк', 'string', 4, 0, null],
      ['ISIN', 'ISIN', 'RU0009029540', 'string', 5, 0, null],
      ['ISSUESIZE', 'Issue size', '21586948000', 'number', 7, 0, 0],
      ['FACEVALUE', 'Face value', '3', 'number', 8, 0, 2],
      ['FACEUNIT', 'Face unit', 'SUR', 'string', 9, 0, null],
      ['EMITTER_ID', 'Issuer', '484', 'number', 11000, 1, null],
    ],
  },
  boards: {
    columns: ['secid', 'boardid', 'is_traded', 'decimals', 'history_from', 'history_till', 'is_primary', 'currencyid'],
    data: [
      ['SBER', 'TQBR', 1, 2, '2013-03-25', '2026-08-20', 1, 'RUB'],
    ],
  },
}

const candlesResponse = {
  candles: {
    columns: ['open', 'close', 'high', 'low', 'value', 'volume', 'begin', 'end'],
    data: [
      [109, 109.2, 111.11, 108.01, 2211623351.09, 20252489, '2007-07-20 00:00:00', '2007-07-20 23:59:59'],
      [109.7, 112, 112.65, 108.1, 3901828829.37, 35092029, '2007-07-23 00:00:00', '2007-07-23 23:59:59'],
    ],
  },
}

const marketdataResponse = {
  securities: {
    columns: ['SECID', 'BOARDID', 'PREVPRICE', 'CURRENCYID'],
    data: [['SBER', 'TQBR', '273.11', 'RUB']],
  },
  marketdata: {
    columns: ['SECID', 'BOARDID', 'OPEN', 'LOW', 'HIGH', 'LAST', 'CHANGE', 'LASTCHANGEPRCNT', 'VOLTODAY', 'VALTODAY', 'NUMTRADES', 'CLOSEPRICE', 'MARKETPRICE', 'ISSUECAPITALIZATION', 'SYSTIME'],
    data: [['SBER', 'TQBR', '271.48', '269.22', '273.38', '272.79', '-0.32', '-0.12', '10498140', '2846085735', '56777', '273.11', '272.76', '5877046593000', '2026-08-21 13:15:20']],
  },
}

describe('argument validation', () => {
  it('validates securities args and treats a blank query as list mode', () => {
    expect(parseSecuritiesArgs({ query: ' sber ' })).toEqual({ query: 'sber', limit: 25 })
    expect(parseSecuritiesArgs({})).toEqual({ limit: 25 })
    expect(parseSecuritiesArgs({ query: '   ', limit: 10 })).toEqual({ limit: 10 })
    expect(() => parseSecuritiesArgs({ limit: 0 })).toThrow(/limit must be an integer between 1 and 100/)
    expect(() => parseSecuritiesArgs({ limit: 101 })).toThrow(/limit must be an integer between 1 and 100/)
  })

  it('validates security and marketdata secid args', () => {
    expect(parseSecurityArgs({ secid: ' sber ' })).toEqual({ secid: 'sber' })
    expect(() => parseSecurityArgs({ secid: '  ' })).toThrow(/secid must be a non-empty string/)
    expect(() => parseMarketdataArgs({ secid: '' })).toThrow(/secid must be a non-empty string/)
  })

  it('validates candle interval and dates', () => {
    expect(parseCandlesArgs({ secid: 'sber' })).toEqual({ secid: 'SBER', interval: '24' })
    expect(parseCandlesArgs({ secid: 'sber', interval: '31', from: '2026-01-01', till: '2026-03-01' }))
      .toEqual({ secid: 'SBER', interval: '31', from: '2026-01-01', till: '2026-03-01' })
    expect(() => parseCandlesArgs({ secid: 'sber', interval: '99' })).toThrow(/interval must be one of/)
    expect(() => parseCandlesArgs({ secid: 'sber', from: '01-01-2026' })).toThrow(/from must be YYYY-MM-DD/)
    expect(() => parseCandlesArgs({ secid: 'sber', till: 'x' })).toThrow(/till must be YYYY-MM-DD/)
  })
})

describe('formatting', () => {
  it('formats securities with available fields and a truncation note', () => {
    const out = formatSecuritiesOutput({
      query: 'sber',
      truncated: true,
      securities: [{ secid: 'SBER', name: 'Сбербанк России ПАО ао', shortname: 'Сбербанк', isin: 'RU0009029540', issuerTitle: 'ПАО Сбербанк' }],
    })
    expect(out).toContain('MOEX securities matching "sber"')
    expect(out).toContain('- SBER — Сбербанк России ПАО ао · (Сбербанк) · ISIN=RU0009029540 · issuer="ПАО Сбербанк"')
    expect(out).toContain('Showing the first 1 results')
  })

  it('formats an empty securities result', () => {
    expect(formatSecuritiesOutput({ securities: [], truncated: false })).toBe('No MOEX securities found.')
  })

  it('formats a security profile', () => {
    const out = formatSecurityOutput({ secid: 'SBER', name: 'Сбербанк России ПАО ао', isin: 'RU0009029540', emitterId: 484, board: { boardId: 'TQBR', currency: 'RUB', decimals: 2 } })
    expect(out).toContain('SECID: SBER')
    expect(out).toContain('Name: Сбербанк России ПАО ао')
    expect(out).toContain('Primary board:')
    expect(out).toContain('  Board: TQBR')
  })

  it('formats candles as a markdown table', () => {
    const out = formatCandlesOutput({
      secid: 'SBER', interval: '24', truncated: false,
      candles: [{ begin: '2026-08-20 00:00:00', end: '2026-08-20 23:59:59', open: 1, high: 2, low: 0.5, close: 1.5 }],
    })
    expect(out).toContain('MOEX candles for SBER (interval 24): 1 rows')
    expect(out).toContain('| 2026-08-20 00:00:00 | 1 | 2 | 0.5 | 1.5 | - | - |')
  })

  it('formats market data', () => {
    const out = formatMarketdataOutput({ secid: 'SBER', board: 'TQBR', lastPrice: 272.79, currency: 'RUB' })
    expect(out).toContain('SBER (TQBR)')
    expect(out).toContain('Last: 272.79')
    expect(out).toContain('Currency: RUB')
  })
})

describe('registration', () => {
  it('registers all four tools by default with the timeout budget attached', async () => {
    const { ctx, fiber } = await mount()
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toEqual(expect.arrayContaining(['moex_securities', 'moex_security', 'moex_candles', 'moex_marketdata']))
    expect(ctx.tools.get('moex_candles')?.timeoutMs).toBe(30_000)
    expect(ctx.tools.get('moex_securities')?.timeoutMs).toBe(30_000)
    await fiber.dispose()
    expect(ctx.tools.schemas().map(s => s.name)).not.toContain('moex_candles')
  })

  it('registers only enabled tools', async () => {
    const { ctx, fiber } = await mount({ config: { securities: true, security: false, candles: false, marketdata: false } })
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toContain('moex_securities')
    expect(names).not.toContain('moex_security')
    expect(names).not.toContain('moex_candles')
    expect(names).not.toContain('moex_marketdata')
    await fiber.dispose()
  })

  it('contributes prompt sections for the enabled tools', async () => {
    const { ctx, fiber } = await mount()
    const prompt = await ctx.systemPrompt.assemble()
    const text = prompt.sections.map(s => s.text).join('\n')
    expect(text).toContain('Use the moex_securities tool to find companies and securities listed on Moscow Exchange')
    expect(text).toContain('Use the moex_candles tool to read historical OHLCV candles')
    await fiber.dispose()
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in ToolMoex).toBe(false)
  })
})

describe('execution through the real registry', () => {
  it('executes moex_securities in search mode', async () => {
    const { fiber, call } = await mount({ fetch: fetchMock(securitiesSearchResponse) })
    const out = await call('moex_securities', { query: 'sber' })
    expect(out.isError).toBe(false)
    expect(out.value).toEqual({
      query: 'sber',
      truncated: false,
      securities: [{
        secid: 'SBER',
        name: 'Сбербанк России ПАО ао',
        shortname: 'Сбербанк',
        isin: 'RU0009029540',
        type: 'common_share',
        group: 'stock_shares',
        board: 'TQBR',
        isTraded: true,
        issuerTitle: 'ПАО Сбербанк',
        issuerInn: '7707083893',
        issuerOkpo: '00032537',
      }],
    })
    expect(textOf(out.content)).toContain('MOEX securities matching "sber"')
    await fiber.dispose()
  })

  it('executes moex_securities in list mode without a query', async () => {
    const { fiber, call } = await mount({ fetch: fetchMock(boardListResponse) })
    const out = await call('moex_securities', {})
    expect(out.isError).toBe(false)
    expect(out.value).toEqual({
      board: 'TQBR',
      truncated: false,
      securities: [
        { secid: 'ABIO', name: 'ПАО "Артген"', shortname: 'iАРТГЕН ао', isin: 'RU000A0JNAB6', board: 'TQBR', currency: 'SUR', prevPrice: 44.32, lotSize: 10 },
        { secid: 'SBER', name: 'Сбербанк России ПАО ао', shortname: 'Сбербанк', isin: 'RU0009029540', board: 'TQBR', currency: 'RUB', prevPrice: 272.79, lotSize: 10 },
      ],
    })
    await fiber.dispose()
  })

  it('executes moex_security', async () => {
    const { fiber, call } = await mount({ fetch: fetchMock(securityResponse) })
    const out = await call('moex_security', { secid: 'sber' })
    expect(out.isError).toBe(false)
    expect(out.value).toEqual({
      secid: 'SBER',
      name: 'Сбербанк России ПАО ао',
      shortname: 'Сбербанк',
      isin: 'RU0009029540',
      issueSize: 21586948000,
      faceValue: 3,
      faceUnit: 'SUR',
      emitterId: 484,
      board: { boardId: 'TQBR', currency: 'RUB', decimals: 2, isTraded: true, historyFrom: '2013-03-25', historyTill: '2026-08-20' },
    })
    await fiber.dispose()
  })

  it('executes moex_candles and caps to maxCandles', async () => {
    const { fiber, call } = await mount({ config: { maxCandles: 1 }, fetch: fetchMock(candlesResponse) })
    const out = await call('moex_candles', { secid: 'SBER' })
    expect(out.isError).toBe(false)
    expect(out.value).toEqual({
      secid: 'SBER',
      interval: '24',
      truncated: true,
      candles: [
        { begin: '2007-07-23 00:00:00', end: '2007-07-23 23:59:59', open: 109.7, close: 112, high: 112.65, low: 108.1, value: 3901828829.37, volume: 35092029 },
      ],
    })
    await fiber.dispose()
  })

  it('executes moex_marketdata', async () => {
    const { fiber, call } = await mount({ fetch: fetchMock(marketdataResponse) })
    const out = await call('moex_marketdata', { secid: 'sber' })
    expect(out.isError).toBe(false)
    expect(out.value).toEqual({
      secid: 'SBER',
      board: 'TQBR',
      lastPrice: 272.79,
      open: 271.48,
      high: 273.38,
      low: 269.22,
      prevPrice: 273.11,
      change: -0.32,
      changePercent: -0.12,
      volume: 10498140,
      value: 2846085735,
      numTrades: 56777,
      closePrice: 273.11,
      marketPrice: 272.76,
      issueCapitalization: 5877046593000,
      currency: 'RUB',
      lastUpdate: '2026-08-21 13:15:20',
    })
    await fiber.dispose()
  })

  it('surfaces a structured MoexError on HTTP failure', async () => {
    const failingFetch = vi.fn<typeof fetch>(async () => jsonResponse({}, false, 500))
    const { fiber, call } = await mount({ fetch: failingFetch })
    const out = await call('moex_marketdata', { secid: 'SBER' })
    expect(out.isError).toBe(true)
    expect(out.error?.info?.code).toBe('MOEX_HTTP_ERROR')
    await fiber.dispose()
  })

  it('rejects schema-invalid arguments with a structured INVALID_ARGS error', async () => {
    const { fiber, call } = await mount({ fetch: fetchMock(securitiesSearchResponse) })
    const out = await call('moex_securities', { limit: 'x' })
    expect(out.isError).toBe(true)
    expect(out.error?.info?.code).toBe('INVALID_ARGS')
    await fiber.dispose()
  })

  it('surfaces semantic argument errors as tool failures', async () => {
    const { fiber, call } = await mount({ fetch: fetchMock(securitiesSearchResponse) })
    const out = await call('moex_securities', { limit: 999 })
    expect(out.isError).toBe(true)
    expect(out.error?.message).toBe('limit must be an integer between 1 and 100')
    await fiber.dispose()
  })
})
