/**
 * Model-facing `parse_broker_report` tool: reads a broker HTML report from
 * the session workspace and returns the portfolio (positions, cash, trades,
 * FIFO cost basis) plus ready-made arguments for the moex-finance portfolio
 * tools. Parsing is the dependency-free `./parser` module, shared with the
 * browser upload button.
 * @module @deepseek-ai/dsh-tool-broker-report
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { formatReportSummary, parseBrokerReport } from './parser.ts'

export { formatReportSummary, parseBrokerReport } from './parser.ts'
export type { BrokerReport, Deal, Position, PositionKind } from './parser.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-broker-report'

/** Services required by the tool. */
export const inject = ['tools', 'fs', 'systemPrompt']

/** Reports are a few hundred KB; refuse anything absurdly large. */
const MAX_REPORT_CHARS = 20_000_000

/**
 * Register the `parse_broker_report` tool and its guidance.
 * @param ctx - context with `tools`, `fs`, and `systemPrompt`.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:parse_broker_report',
    order: 122,
    text: 'When the user shares a broker report (an HTML file such as a Sberbank "Отчет брокера"), call parse_broker_report with its path to get the portfolio. '
      + 'Then use the returned analyzeArgs with mcp__moex-finance__analyze_user_portfolio for shares and ETFs, and the bond ISINs with the moex-finance bond tools. '
      + 'Bond prices in the report are percent of nominal. If the conversation already contains a portfolio-context injection (a report the user attached from the composer), use it directly instead of asking for the file.',
  })

  ctx.tools.register(defineTool({
    name: 'parse_broker_report',
    description: 'Parse a broker HTML report (Sberbank "Отчет брокера") from the workspace into a portfolio: positions with quantities, prices, market value, accrued interest, FIFO average buy price; cash; trades; and arguments for analyze_user_portfolio.',
    parameters: {
      path: { type: 'string', required: true, description: 'Path to the report .html file, absolute or relative to the session workspace.' },
      include_deals: { type: 'boolean', description: 'Include every trade in the result (default false: only the count and the last few).' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as unknown as string }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      const target = await ctx.fs.resolve(args.path, { ...cwd !== undefined ? { cwd } : {}, signal: exec.signal })
      const html = await ctx.fs.readText(target, exec.signal)
      if (html.length > MAX_REPORT_CHARS) throw new Error(`parse_broker_report: file is too large (${html.length} chars)`)
      const report = parseBrokerReport(html)
      const summary = formatReportSummary(report, 5)
      const data = args.include_deals === true ? report : { ...report, deals: report.deals.slice(-5) }
      return `${summary}\n\nStructured result:\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`` 
    },
  }))
}
