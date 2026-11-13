/**
 * The model-facing `plot_chart` tool: validates model-supplied data into one
 * canonical chart spec, formats the model-facing confirmation, and declares the
 * chart-card render intent a capable UI draws. This module owns schemas,
 * validation, caps, formatting, and presentation; drawing happens in a UI,
 * never here. No network or filesystem access — the tool is pure computation.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ChartResultView, ChartSpec, GenericCallView, JsonValue, ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Chart types `plot_chart` renders. */
export const CHART_TYPES = ['line', 'bar', 'scatter', 'pie'] as const

/** Chart types whose category labels are required (scatter defaults to 0..n-1). */
const CATEGORY_CHARTS: readonly string[] = ['line', 'bar', 'pie']

/** Default cap on data points (labels) per chart. */
export const DEFAULT_MAX_POINTS = 200

/** Default cap on series per chart. */
export const DEFAULT_MAX_SERIES = 8

/** Default cap on title and label characters. */
export const DEFAULT_MAX_TEXT_LENGTH = 256

/** Wire-safety caps the replay meta guard accepts, independent of deployment config. */
const META_MAX_POINTS = 2000
const META_MAX_SERIES = 16
const META_MAX_TEXT = 512

/**
 * Validated `plot_chart` arguments: one of the four chart types, optional
 * display text, the category/x labels, and the numeric series.
 */
export interface PlotArgs {
  /** Chart type: which plot the UI draws. */
  chart_type: string
  /** Chart title, shown above the plot when present. */
  title?: string
  /** x-axis label (line/bar/scatter). */
  x_label?: string
  /** y-axis label (line/bar/scatter). */
  y_label?: string
  /**
   * Category labels (line/bar/pie) or numeric x positions (scatter). Required
   * for line/bar/pie; scatter defaults to 0..n-1 when omitted.
   */
  labels?: (string | number)[]
  /** The data series; exactly one for pie, one or more for the other types. */
  series: { name?: string; values: number[] }[]
}

/** A finite JSON number, excluding negative zero (lossless-JSON invalid). */
function isChartNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
}

/** A bounded optional display label accepted from persisted chart metadata. */
function isOptionalChartText(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= META_MAX_TEXT)
}

/**
 * Trim and bound one optional text field: blank-after-trim and over-length
 * values reject, so the canonical spec never carries padding or unbounded text.
 * @param value - the raw field value, if supplied.
 * @param maxLength - the character cap.
 * @param name - the field name for diagnostics.
 * @returns the trimmed text, or undefined when the field was omitted.
 */
function cleanText(value: string | undefined, maxLength: number, name: string): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`plot_chart: ${name} must be a non-empty string`)
  if (trimmed.length > maxLength) throw new Error(`plot_chart: ${name} must be no longer than ${maxLength} characters`)
  return trimmed
}

/**
 * Validate one label entry: a trimmed, bounded non-empty string or a finite
 * non-negative-zero number.
 * @param label - the raw label entry.
 * @param maxLength - the string character cap.
 * @param name - the field name for diagnostics.
 * @returns the normalized label.
 */
function cleanLabel(label: string | number, maxLength: number, name: string): string | number {
  if (typeof label === 'string') {
    const trimmed = label.trim()
    if (trimmed.length === 0) throw new Error(`plot_chart: ${name} entries must be non-empty strings or numbers`)
    if (trimmed.length > maxLength) throw new Error(`plot_chart: ${name} entries must be no longer than ${maxLength} characters`)
    return trimmed
  }
  if (!isChartNumber(label)) throw new Error(`plot_chart: ${name} entries must be finite numbers`)
  return label
}

/**
 * Validate one series entry against the resolved label count: an optional
 * trimmed bounded name and values aligned with the labels.
 * @param item - the raw series entry.
 * @param labelCount - the resolved label count every series must match.
 * @param maxLength - the name character cap.
 * @param index - the series position, for diagnostics.
 * @returns the normalized series.
 */
function cleanSeries(
  item: { name?: string; values: number[] },
  labelCount: number,
  maxLength: number,
  index: number,
): { name?: string; values: number[] } {
  const name = cleanText(item.name, maxLength, `series[${index}].name`)
  if (!Array.isArray(item.values) || item.values.length !== labelCount) {
    throw new Error(`plot_chart: series[${index}].values must have exactly ${labelCount} entries (one per label)`)
  }
  for (let i = 0; i < item.values.length; i++) {
    if (!isChartNumber(item.values[i])) {
      throw new Error(`plot_chart: series[${index}].values[${i}] must be a finite number`)
    }
  }
  return {
    ...name !== undefined ? { name } : {},
    values: item.values,
  }
}

/**
 * Validate raw `plot_chart` arguments into the canonical {@link ChartSpec}.
 * Cross-field rules the JSON schema cannot express — label alignment, per-type
 * label requirements, the pie single-series rule — are enforced here.
 * @param args - the schema-validated arguments.
 * @param maxPoints - the label-count cap.
 * @param maxSeries - the series-count cap.
 * @param maxTextLength - the title/label character cap.
 * @returns the validated canonical chart spec.
 */
export function parsePlotArgs(args: PlotArgs, maxPoints: number, maxSeries: number, maxTextLength: number): ChartSpec {
  if (!(CHART_TYPES as readonly string[]).includes(args.chart_type)) {
    throw new Error(`plot_chart: chart_type must be one of ${CHART_TYPES.join(', ')}`)
  }
  const title = cleanText(args.title, maxTextLength, 'title')
  const x_label = cleanText(args.x_label, maxTextLength, 'x_label')
  const y_label = cleanText(args.y_label, maxTextLength, 'y_label')
  if (!Array.isArray(args.series) || args.series.length < 1 || args.series.length > maxSeries) {
    throw new Error(`plot_chart: series must contain between 1 and ${maxSeries} entries`)
  }
  if (args.chart_type === 'pie' && args.series.length !== 1) {
    throw new Error('plot_chart: pie charts take exactly one series')
  }
  let labels: (string | number)[]
  if (args.labels === undefined) {
    if (CATEGORY_CHARTS.includes(args.chart_type)) {
      throw new Error(`plot_chart: labels are required for ${args.chart_type} charts`)
    }
    const count = args.series[0]?.values.length ?? 0
    if (count < 1) throw new Error('plot_chart: series values must contain at least 1 entry')
    labels = Array.from({ length: count }, (_, i) => i)
  } else {
    if (!Array.isArray(args.labels) || args.labels.length < 1 || args.labels.length > maxPoints) {
      throw new Error(`plot_chart: labels must contain between 1 and ${maxPoints} entries`)
    }
    labels = args.labels.map(label => cleanLabel(label, maxTextLength, 'labels'))
  }
  if (args.chart_type === 'scatter' && !labels.every(label => typeof label === 'number')) {
    throw new Error('plot_chart: scatter labels must be numbers (x positions)')
  }
  const series = args.series.map((item, index) => cleanSeries(item, labels.length, maxTextLength, index))
  if (args.chart_type === 'pie' && series[0] !== undefined && !series[0].values.every(value => value >= 0)) {
    throw new Error('plot_chart: pie values must be non-negative')
  }
  return {
    chart_type: args.chart_type as ChartSpec['chart_type'],
    ...title !== undefined ? { title } : {},
    ...x_label !== undefined ? { x_label } : {},
    ...y_label !== undefined ? { y_label } : {},
    labels,
    series,
  }
}

/**
 * Format the model-facing confirmation of one rendered chart.
 * @param spec - the validated canonical chart spec.
 * @returns the one-line summary the model reads back.
 */
export function formatChartOutput(spec: ChartSpec): string {
  const title = spec.title !== undefined ? ` "${spec.title}"` : ''
  return `Rendered a ${spec.chart_type} chart${title} with ${spec.series.length} series and ${spec.labels.length} data points.`
}

/**
 * Pending-call presentation: a generic card titled by the chart.
 * @param args - the raw tool arguments.
 * @returns the generic card view shown while the call runs.
 */
export function presentPlotCall(args: PlotArgs): GenericCallView {
  const heading = args.title?.trim() || args.chart_type
  return {
    card: 'generic',
    title: `Chart: ${heading}`,
    rawInput: {
      chart_type: args.chart_type,
      series: args.series.length,
      labels: args.labels?.length ?? 0,
    },
  }
}

/**
 * Narrow opaque live or replayed result metadata to a {@link ChartSpec}.
 * Malformed metadata returns `undefined` so presentation can fall back to the
 * generic card instead of throwing during replay. The bounds are fixed
 * wire-safety constants, not deployment config.
 * @param meta - result metadata.
 * @returns the validated chart spec, or `undefined` for absent or malformed data.
 */
export function plotSpecFromMeta(meta: unknown): ChartSpec | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { chart_type, title, x_label, y_label, labels, series } = meta as Record<string, unknown>
  if (!(CHART_TYPES as readonly unknown[]).includes(chart_type)) return undefined
  if (!isOptionalChartText(title) || !isOptionalChartText(x_label) || !isOptionalChartText(y_label)) return undefined
  if (!Array.isArray(labels) || labels.length === 0 || labels.length > META_MAX_POINTS) return undefined
  if (!labels.every(label => typeof label === 'string' || isChartNumber(label))) return undefined
  if (!Array.isArray(series) || series.length === 0 || series.length > META_MAX_SERIES) return undefined
  const labelCount = labels.length
  const validSeries = series.every((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
    const { name, values } = item as Record<string, unknown>
    if (name !== undefined && (typeof name !== 'string' || name.length === 0 || name.length > META_MAX_TEXT)) return false
    return Array.isArray(values)
      && values.length === labelCount
      && values.every(value => isChartNumber(value))
  })
  if (!validSeries) return undefined
  return {
    chart_type: chart_type as ChartSpec['chart_type'],
    ...title !== undefined ? { title } : {},
    ...x_label !== undefined ? { x_label } : {},
    ...y_label !== undefined ? { y_label } : {},
    labels: labels as (string | number)[],
    series: series as ChartSpec['series'],
  }
}

/**
 * Project a validated canonical value into its replayable presentation meta.
 * The value IS the chart spec, so the projection is the identity after the
 * registry's schema validation.
 * @param value - the canonical `plot_chart` output value.
 * @returns the chart spec as opaque JSON.
 */
export function plotMetaFromValue(value: ChartSpec): JsonValue {
  return value as unknown as JsonValue
}

/**
 * Completed-call presentation: a `chart` result card carrying the validated
 * spec. It sets no `content` copy — a UI without the chart capability falls
 * back to the raw `tool/result` content.
 * @param args - the raw tool arguments; `title`/`chart_type` feed the result-state title.
 * @param result - the final model-facing tool result; `meta` carries the spec.
 * @returns the chart result view, or `undefined` (generic card) on failure or
 *   malformed meta.
 */
export function presentPlotResult(_args: PlotArgs, result: ToolResult): ChartResultView | undefined {
  if (result.isError) return undefined
  const spec = plotSpecFromMeta(result.meta)
  if (spec === undefined) return undefined
  return {
    card: 'chart',
    title: `Chart: ${spec.title ?? spec.chart_type}`,
    spec,
  }
}

/**
 * Register the `plot_chart` tool and its system-prompt guidance.
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the
 *   registrations; both are effect-scoped and unregister on plugin dispose.
 * @param maxPoints - the label-count cap (validated config).
 * @param maxSeries - the series-count cap (validated config).
 * @param maxTextLength - the title/label character cap (validated config).
 */
export function applyPlotTool(ctx: Context, maxPoints: number, maxSeries: number, maxTextLength: number): void {
  ctx.systemPrompt.section({
    name: 'tool:plot_chart',
    order: 120,
    text: 'Use the plot_chart tool to visualize data inside the conversation. chart_type: line, bar, scatter, or pie. Provide labels (category names for line/bar, slice labels for pie, numeric x positions for scatter) and one or more series, each with an optional name and numeric values aligned with labels. Pie takes exactly one series with non-negative values. Keep point and series counts small enough for a readable chart.',
  })

  ctx.tools.register(defineTool({
    name: 'plot_chart',
    description: 'Render a line, bar, scatter, or pie chart in the conversation from labels and numeric series data.',
    parameters: {
      chart_type: {
        type: 'string',
        required: true,
        enum: CHART_TYPES,
        description: 'Chart type: line, bar, scatter, or pie.',
      },
      title: { type: 'string', description: 'Optional chart title.' },
      x_label: { type: 'string', description: 'Optional x-axis label (line/bar/scatter).' },
      y_label: { type: 'string', description: 'Optional y-axis label (line/bar/scatter).' },
      labels: {
        type: 'array',
        description: 'Category labels (line/bar/pie) or numeric x positions (scatter). Required for line/bar/pie; scatter defaults to 0..n-1 when omitted.',
        items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      },
      series: {
        type: 'array',
        required: true,
        description: 'One or more data series; exactly one for pie.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: 'Optional series name for the legend.' },
            values: {
              type: 'array',
              required: true,
              description: 'Numeric values, one per label.',
              items: { type: 'number' },
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chart_type: { type: 'string', required: true },
          title: { type: 'string' },
          x_label: { type: 'string' },
          y_label: { type: 'string' },
          labels: {
            type: 'array',
            required: true,
            items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          },
          series: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                values: {
                  type: 'array',
                  required: true,
                  items: { type: 'number' },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatChartOutput(value as unknown as ChartSpec) }],
      presentationMeta: (_args, value) => plotMetaFromValue(value as unknown as ChartSpec),
    },
    // Pure computation over the call's own arguments; no shared state.
    isConcurrencySafe: () => true,
    async execute(args) {
      return parsePlotArgs(args, maxPoints, maxSeries, maxTextLength)
    },
    presentCall: presentPlotCall,
    presentResult: (args, result) => presentPlotResult(args, result),
  }))
}
