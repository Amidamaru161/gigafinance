/**
 * Model-facing `plot_chart` tool: renders one line/bar/scatter/pie chart per
 * call from model-supplied labels and numeric series. This package owns the
 * schema, validation, caps, model-facing formatting, and the chart-card
 * presentation; drawing happens in a capable UI. The tool is pure computation
 * — no network, filesystem, or shared state.
 * @module @deepseek-ai/dsh-tool-chart
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  applyPlotTool,
  DEFAULT_MAX_POINTS,
  DEFAULT_MAX_SERIES,
  DEFAULT_MAX_TEXT_LENGTH,
} from './plot.ts'

export {
  CHART_TYPES,
  DEFAULT_MAX_POINTS,
  DEFAULT_MAX_SERIES,
  DEFAULT_MAX_TEXT_LENGTH,
  applyPlotTool,
  formatChartOutput,
  parsePlotArgs,
  plotMetaFromValue,
  plotSpecFromMeta,
  presentPlotCall,
  presentPlotResult,
} from './plot.ts'
export type { PlotArgs } from './plot.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-chart'

/** Services required by the chart tool suite. */
export const inject = ['tools', 'systemPrompt']

/** Plugin config: the per-chart data and text caps. */
export interface Config {
  /** Upper bound on labels (data points) per chart. Defaults to 200. */
  maxPoints?: number
  /** Upper bound on series per chart. Defaults to 8. */
  maxSeries?: number
  /** Upper bound on title/label characters. Defaults to 256. */
  maxTextLength?: number
}

export const Config: z<Config> = z.object({
  maxPoints: z.number().default(DEFAULT_MAX_POINTS),
  maxSeries: z.number().default(DEFAULT_MAX_SERIES),
  maxTextLength: z.number().default(DEFAULT_MAX_TEXT_LENGTH),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/** Configured caps must be positive integers. */
function assertPositiveInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-chart: ${field} must be a positive integer`)
  }
}

/**
 * Register the `plot_chart` tool. The registration is effect-scoped: disposing
 * the plugin fiber unregisters the tool and its system-prompt section.
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the registrations.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxPoints', resolved.maxPoints)
  assertPositiveInteger('maxSeries', resolved.maxSeries)
  assertPositiveInteger('maxTextLength', resolved.maxTextLength)
  applyPlotTool(ctx, resolved.maxPoints, resolved.maxSeries, resolved.maxTextLength)
}
