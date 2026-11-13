/**
 * Pure derivation of the chart-card props from a frozen call slice: the
 * `card:'chart'` render intent the `plot_chart` tool declares at result time
 * arrives on the snapshot as `resultView`, and this is the one place that turns
 * it into what {@link ChartBlock} draws. Both conversation render sites (the
 * chat tool row's resident/expanded body and the details panel's Output
 * section) call this, so the spec they show is derived once.
 *
 * The chart card is result-only by contract: the tool keeps a generic pending
 * call view, so there is nothing to derive while the call is still running and
 * a running call always takes the generic path.
 * @module
 */
import type { ChartBlockProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallBlock } from './tool-call-model.ts'

/** Wire-safety cap on one chart's points and series (fixed, not deployment config). */
const META_MAX_POINTS = 2000
const META_MAX_SERIES = 16
const META_MAX_TEXT = 512

/** A finite drawable chart number (the wire can carry nothing else through JSON). */
function isChartNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Derive the chart-card props for a tool call, or null when this call is not a
 * chart card and belongs on the generic path.
 *
 * The result side supplies the whole card: the validated chart spec. Cases
 * producing null, all of them the documented generic-card default:
 *
 * - A running call (no `resultView` yet): the chart tool keeps a generic pending
 *   card, so nothing chart-shaped exists until the call settles.
 * - A settled call whose result view is not a chart card — including a `card`
 *   value this UI version does not know, which arrives over the wire and so
 *   cannot be trusted to be one of the compiled variants, and a generic result
 *   view (the tool's error path returns the generic card, whose text the
 *   generic path preserves).
 * - A chart card whose spec does not guard: every field is narrowed from the
 *   wire before it becomes SVG input, so a malformed spec renders as the
 *   generic text card rather than a broken plot.
 * @param block - RunningToolCall or ToolResultNode off the snapshot caches.
 * @returns the chart-card props, or null for the generic path.
 */
export function chartCardModel(block: ToolCallBlock): ChartBlockProps | null {
  // Running calls have no result view; the chart card is result-only.
  if (!('kind' in block)) return null
  const result = block.resultView
  if (result?.card !== 'chart') return null
  const { spec } = result
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return null
  const { chart_type, title, x_label, y_label, labels, series } = spec as unknown as Record<string, unknown>
  if (chart_type !== 'line' && chart_type !== 'bar' && chart_type !== 'scatter' && chart_type !== 'pie') return null
  if (!isOptionalChartText(title) || !isOptionalChartText(x_label) || !isOptionalChartText(y_label)) return null
  if (!Array.isArray(labels) || labels.length === 0 || labels.length > META_MAX_POINTS) return null
  if (!labels.every(label => typeof label === 'string' || isChartNumber(label))) return null
  if (!Array.isArray(series) || series.length === 0 || series.length > META_MAX_SERIES) return null
  const labelCount = labels.length
  const validSeries = series.every((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
    const { name, values } = item as Record<string, unknown>
    if (name !== undefined && (typeof name !== 'string' || name.length === 0 || name.length > META_MAX_TEXT)) return false
    return Array.isArray(values)
      && values.length === labelCount
      && values.every(value => isChartNumber(value))
  })
  if (!validSeries) return null
  return {
    chart_type,
    ...title !== undefined ? { title } : {},
    ...x_label !== undefined ? { x_label } : {},
    ...y_label !== undefined ? { y_label } : {},
    labels: labels as (string | number)[],
    series: series.map((item: unknown) => {
      const { name, values } = item as { name?: unknown; values: unknown }
      return {
        ...name !== undefined ? { name: name as string } : {},
        values: values as number[],
      }
    }),
  }
}

/** Returns whether a persisted optional display label is safe to render. */
function isOptionalChartText(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= META_MAX_TEXT)
}
