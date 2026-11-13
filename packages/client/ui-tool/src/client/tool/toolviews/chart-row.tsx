// Chart toolview registrant: the keyed toolview hole for the `plot_chart` tool.
// The row composes the shared ToolRow (chrome, running sweep, whole-row expand)
// and feeds it the completed chart as ToolRow's `chart` card material, so it
// renders through ChartBlock in the collapsed-by-default expanded body — the
// same unified interaction every other card row has. Until the call settles
// there is no chart card (the tool keeps a generic pending view), so a running
// row is the summary line alone.

import type { Context } from '@deepseek-ai/cordis'
import { IconChartBarOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { chartCardModel } from '../models/chart-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Full row props: the toolview runtime share plus the standard locale seat. */
type ChartRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/**
 * Chart row: icon + Chart · {summary} in the shared ToolRow chrome, with the
 * completed chart's card as the row's collapsed-by-default card body.
 */
export function ChartRow({ toolName, block, inspect, t }: ChartRowProps) {
  const model = toolRowModel(toolName, block)
  const chart = chartCardModel(block)
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconChartBarOutline16 size={14} />}
      title="Chart"
      summary={model.summary}
      body={null}
      output={model.output}
      errorSummary={model.errorSummary}
      chart={chart}
      state={model.state}
      inspect={inspect}
    />
  )
}

/**
 * The chart row follows the atomic Tool-view declaration across activation and
 * reload: registered under the `plot_chart` tool name's keyed toolview hole.
 */
export const chartToolview = {
  name: 'chart-toolview',
  inject: ['slots'],
  /**
   * Register the chart row under the `plot_chart` tool name's keyed toolview hole.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', function* () {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'plot_chart', locale: NS }, ChartRow)
    })
  },
}
