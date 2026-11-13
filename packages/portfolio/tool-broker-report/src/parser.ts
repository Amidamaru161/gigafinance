/**
 * Dependency-free parser for Sberbank broker HTML reports ("Отчет брокера").
 * Pure string processing (no DOM), so the same code runs in the Host tool and
 * in the browser upload button. The investor's name is deliberately not
 * extracted: nothing downstream needs it.
 * @module @deepseek-ai/dsh-tool-broker-report/parser
 */

/** Asset class, from the report's securities directory. */
export type PositionKind = 'share' | 'bond' | 'etf' | 'other'

/** One security held at the end of the report period. */
export interface Position {
  /** Short name as printed in the report, e.g. "АПРИ 2Р11". */
  name: string
  isin: string
  /** Exchange code: ticker for shares/ETFs, ISIN for bonds. */
  code: string
  kind: PositionKind
  /** Issuer, from the securities directory. */
  issuer?: string
  currency: string
  /** Quantity at the end of the period. */
  quantity: number
  /** Market price at the end of the period: % of nominal for bonds, currency otherwise. */
  price: number | null
  priceUnit: 'percent' | 'currency'
  /** Bond face value per piece. */
  nominal?: number
  /** Market value without accrued interest, in `currency`. */
  marketValue: number | null
  /** Accrued coupon interest (НКД), in `currency`. */
  accruedInterest: number
  /** Quantity-weighted average buy price over the period, same unit as `price`. */
  avgBuyPrice: number | null
  /** First buy date in the period, ISO yyyy-mm-dd. */
  firstBuyDate: string | null
}

/** One trade row. */
export interface Deal {
  date: string
  code: string
  name: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  amount: number
  accruedInterest: number
  fee: number
}

/** Parsed broker report. */
export interface BrokerReport {
  broker: 'sber'
  account: string | null
  period: { from: string | null; to: string | null }
  reportDate: string | null
  /** End-of-period valuation in RUB. */
  totals: { securities: number | null; cash: number | null; total: number | null }
  positions: Position[]
  cash: { currency: string; amount: number }[]
  /** Net cash deposited minus withdrawn over the period, RUB. */
  netDeposits: number | null
  deals: Deal[]
  /** Ready-made arguments for the moex-finance `analyze_user_portfolio` tool (shares and ETFs). */
  analyzeArgs: { tickers: string[]; quantities: number[]; buy_prices: (number | null)[]; buy_dates: (string | null)[] }
  /** Bond ISINs held, for the moex-finance bond tools (cashflows, price history). */
  bondIsins: string[]
  warnings: string[]
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", laquo: '«', raquo: '»', mdash: '—', ndash: '–' }

/** Decode the HTML entities that occur in broker reports. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

/** Strip tags and collapse whitespace. */
function cellText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** Rows of one table as arrays of cell texts. */
function tableRows(table: string): string[][] {
  const rows: string[][] = []
  for (const row of table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    rows.push((row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(cellText))
  }
  return rows
}

/** "1 234.56" / "+1 234,56" / "" → number | null. */
export function parseNumber(text: string | undefined): number | null {
  if (text === undefined) return null
  const cleaned = text.replace(/[\s ]/g, '').replace(',', '.').replace(/^\+/, '')
  if (cleaned === '' || cleaned === '-') return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/** dd.mm.yyyy → yyyy-mm-dd. */
function isoDate(text: string | undefined): string | null {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(text ?? '')
  return m === null ? null : `${m[3]}-${m[2]}-${m[1]}`
}

/** Tables paired with the plain text that precedes each one (its heading). */
function sections(html: string): { heading: string; rows: string[][] }[] {
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
  const parts = body.split(/(<table[\s\S]*?<\/table>)/i)
  const out: { heading: string; rows: string[][] }[] = []
  for (let i = 1; i < parts.length; i += 2) {
    out.push({ heading: cellText(parts[i - 1] ?? '').slice(-300), rows: tableRows(parts[i] ?? '') })
  }
  return out
}

function findSection(all: { heading: string; rows: string[][] }[], pattern: RegExp) {
  return all.find(section => pattern.test(section.heading))
}

function kindOf(description: string): PositionKind {
  const d = description.toLowerCase()
  if (d.includes('облигац')) return 'bond'
  if (d.includes('фонд')) return 'etf'
  if (d.includes('акци') || d.includes('депозитарн')) return 'share'
  return 'other'
}

/** Header numbering rows ("1","2",...) and section labels are not data. */
function isDataRow(cells: string[], minCells: number): boolean {
  return cells.length >= minCells && cells[0] !== '1' && !/^(Итого|Площадка:|Наименование|Дата)/.test(cells[0] ?? '')
}

/**
 * Parse a Sberbank broker report.
 * @param html - the report's full HTML text.
 * @returns the structured portfolio; throws when the file is not a recognizable report.
 */
export function parseBrokerReport(html: string): BrokerReport {
  const warnings: string[] = []
  const all = sections(html)
  const intro = cellText(html.split(/<table/i)[0] ?? '')
  if (!/Отчет брокера/i.test(intro) && !all.some(s => /Портфель Ценных Бумаг/i.test(s.heading))) {
    throw new Error('Not a recognizable Sberbank broker report (no "Отчет брокера" / "Портфель Ценных Бумаг" section).')
  }

  const period = /за период с (\d{2}\.\d{2}\.\d{4}) по (\d{2}\.\d{2}\.\d{4})/.exec(intro)
  const created = /дата создания (\d{2}\.\d{2}\.\d{4})/.exec(intro)
  const account = /Договор\s+(\S+)/.exec(intro)?.[1] ?? /Отчет брокера\s+(\S+)/.exec(intro)?.[1] ?? null

  // Securities directory: name/code → ISIN, issuer, kind.
  const directory = new Map<string, { code: string; isin: string; issuer: string; kind: PositionKind }>()
  for (const cells of findSection(all, /Справочник Ценных Бумаг/i)?.rows ?? []) {
    if (!isDataRow(cells, 5)) continue
    const [name = '', code = '', isin = '', issuer = '', kind = ''] = cells
    const entry = { code, isin, issuer, kind: kindOf(kind) }
    directory.set(isin, entry)
    directory.set(name, entry)
  }

  // Trades.
  const deals: Deal[] = []
  for (const cells of findSection(all, /Сделки купли\/продажи/i)?.rows ?? []) {
    if (!isDataRow(cells, 13)) continue
    const side = cells[6] === 'Покупка' ? 'buy' : cells[6] === 'Продажа' ? 'sell' : null
    const quantity = parseNumber(cells[7])
    const price = parseNumber(cells[8])
    if (side === null || quantity === null || price === null) continue
    deals.push({
      date: isoDate(cells[0]) ?? '',
      name: cells[3] ?? '',
      code: cells[4] ?? '',
      side,
      quantity,
      price,
      amount: parseNumber(cells[9]) ?? 0,
      accruedInterest: parseNumber(cells[10]) ?? 0,
      fee: (parseNumber(cells[11]) ?? 0) + (parseNumber(cells[12]) ?? 0),
    })
  }

  // Holdings at period end.
  const positions: Position[] = []
  const portfolio = findSection(all, /Портфель Ценных Бумаг/i)
  if (portfolio === undefined) warnings.push('Section "Портфель Ценных Бумаг" not found.')
  for (const cells of portfolio?.rows ?? []) {
    if (!isDataRow(cells, 13)) continue
    const [name = '', isin = '', currency = 'RUB'] = cells
    const quantity = parseNumber(cells[8]) ?? 0
    if (quantity === 0) continue
    const info = directory.get(isin) ?? directory.get(name)
    if (info === undefined) warnings.push(`"${name}" (${isin}) is missing from the securities directory.`)
    const kind = info?.kind ?? 'other'
    const code = info?.code ?? isin
    const lots = openLots(deals.filter(d => d.code === code || d.code === isin || d.name === name))
    const lotQty = lots.reduce((sum, lot) => sum + lot.quantity, 0)
    if (lotQty !== quantity) warnings.push(`${name}: trades in this report explain ${lotQty} of ${quantity} pieces (position opened before the period?); average buy price covers the traded part only.`)
    const nominal = parseNumber(cells[9])
    positions.push({
      name,
      isin,
      code,
      kind,
      ...info?.issuer !== undefined && info.issuer !== '' ? { issuer: info.issuer } : {},
      currency,
      quantity,
      price: parseNumber(cells[10]),
      priceUnit: kind === 'bond' ? 'percent' : 'currency',
      ...nominal !== null ? { nominal } : {},
      marketValue: parseNumber(cells[11]),
      accruedInterest: parseNumber(cells[12]) ?? 0,
      avgBuyPrice: lotQty > 0 ? round(lots.reduce((sum, lot) => sum + lot.price * lot.quantity, 0) / lotQty, 4) : null,
      firstBuyDate: lots.map(lot => lot.date).filter(Boolean).sort()[0] ?? null,
    })
  }

  // Valuation summary: the market row carries securities / cash / total at period end.
  const totals = { securities: null as number | null, cash: null as number | null, total: null as number | null }
  const valuation = findSection(all, /Оценка активов/i)
  const market = valuation?.rows.find(cells => cells.length >= 7 && /рынок/i.test(cells[0] ?? '') && cells[0] !== 'Торговая площадка')
  if (market !== undefined) {
    totals.securities = parseNumber(market[4])
    totals.cash = parseNumber(market[5])
    totals.total = parseNumber(market[6])
  } else {
    warnings.push('Asset valuation summary not found.')
  }

  // Cash balances by currency (end of period), non-zero only.
  const cash: { currency: string; amount: number }[] = []
  for (const cells of findSection(all, /Денежные средства$/i)?.rows ?? []) {
    if (!isDataRow(cells, 6) || !/счет/i.test(cells[0] ?? '')) continue
    const amount = parseNumber(cells[5])
    if (amount !== null && amount !== 0) cash.push({ currency: cells[1] ?? '', amount })
  }

  // Net deposits from the cash-flow summary.
  let netDeposits: number | null = null
  for (const cells of findSection(all, /Сводная информация по движению денежных средств/i)?.rows ?? []) {
    const amount = parseNumber(cells[1])
    if (amount === null) continue
    if (/Пополнение/i.test(cells[0] ?? '')) netDeposits = (netDeposits ?? 0) + amount
    if (/Вывод|Списание д\/с/i.test(cells[0] ?? '')) netDeposits = (netDeposits ?? 0) - amount
  }

  // analyze_user_portfolio is an equity tool: shares and ETFs only; bonds go to bondIsins.
  const priced = positions.filter(p => p.kind === 'share' || p.kind === 'etf')
  return {
    broker: 'sber',
    account,
    period: { from: isoDate(period?.[1]), to: isoDate(period?.[2]) },
    reportDate: isoDate(created?.[1]),
    totals,
    positions,
    cash,
    netDeposits,
    deals,
    analyzeArgs: {
      tickers: priced.map(p => p.code),
      quantities: priced.map(p => p.quantity),
      buy_prices: priced.map(p => p.avgBuyPrice),
      buy_dates: priced.map(p => p.firstBuyDate),
    },
    bondIsins: positions.filter(p => p.kind === 'bond').map(p => p.isin),
    warnings,
  }
}

/**
 * FIFO: replay one security's trades in date order; sells consume the oldest
 * lots first. What remains is the cost basis of the current holding.
 */
function openLots(trades: Deal[]): { date: string; price: number; quantity: number }[] {
  const lots: { date: string; price: number; quantity: number }[] = []
  const ordered = trades.map((d, i) => ({ d, i })).sort((a, b) => a.d.date.localeCompare(b.d.date) || a.i - b.i)
  for (const { d } of ordered) {
    if (d.side === 'buy') {
      lots.push({ date: d.date, price: d.price, quantity: d.quantity })
      continue
    }
    let left = d.quantity
    while (left > 0 && lots.length > 0) {
      const head = lots[0]!
      const take = Math.min(head.quantity, left)
      head.quantity -= take
      left -= take
      if (head.quantity === 0) lots.shift()
    }
  }
  return lots
}

function round(value: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/** Human-readable portfolio summary (Markdown) for the model and the chat. */
export function formatReportSummary(report: BrokerReport, maxDeals = 0): string {
  const rub = (v: number | null) => (v === null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 }))
  const kindLabel: Record<PositionKind, string> = { share: 'акция', bond: 'облигация', etf: 'фонд', other: 'прочее' }
  const lines = [
    `Отчёт брокера Сбер, счёт ${report.account ?? '?'}, период ${report.period.from ?? '?'} — ${report.period.to ?? '?'}.`,
    `Оценка на конец периода: бумаги ${rub(report.totals.securities)} ₽, деньги ${rub(report.totals.cash)} ₽, всего ${rub(report.totals.total)} ₽.`
      + (report.netDeposits !== null ? ` Внесено за период: ${rub(report.netDeposits)} ₽.` : ''),
    '',
    '| Бумага | Код | Тип | Кол-во | Цена | Ср. цена покупки | Стоимость | НКД |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...report.positions.map(p => {
      const unit = p.priceUnit === 'percent' ? '%' : ''
      return `| ${p.name} | ${p.code} | ${kindLabel[p.kind]} | ${p.quantity} | ${p.price ?? '—'}${unit} | ${p.avgBuyPrice ?? '—'}${p.avgBuyPrice !== null ? unit : ''} | ${rub(p.marketValue)} | ${rub(p.accruedInterest)} |`
    }),
  ]
  if (report.cash.length > 0) lines.push('', `Денежные средства: ${report.cash.map(c => `${rub(c.amount)} ${c.currency}`).join(', ')}.`)
  lines.push('', `Сделок за период: ${report.deals.length} (покупок ${report.deals.filter(d => d.side === 'buy').length}, продаж ${report.deals.filter(d => d.side === 'sell').length}).`)
  if (maxDeals > 0 && report.deals.length > 0) {
    lines.push('', 'Последние сделки:')
    for (const d of report.deals.slice(-maxDeals)) lines.push(`- ${d.date} ${d.side === 'buy' ? 'покупка' : 'продажа'} ${d.code} ×${d.quantity} по ${d.price}`)
  }
  if (report.analyzeArgs.tickers.length > 0) {
    lines.push('', 'Аргументы для mcp__moex-finance__analyze_user_portfolio (акции и фонды):', '```json', JSON.stringify(report.analyzeArgs), '```')
  }
  if (report.bondIsins.length > 0) lines.push('', `Облигации (ISIN) для облигационных инструментов: ${report.bondIsins.join(', ')}.`)
  if (report.warnings.length > 0) lines.push('', `Предупреждения парсера: ${report.warnings.join(' ')}`)
  return lines.join('\n')
}
