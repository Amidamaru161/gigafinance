import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as ToolChart from '@deepseek-ai/dsh-tool-chart'
import {
  formatChartOutput,
  parsePlotArgs,
  plotMetaFromValue,
  plotSpecFromMeta,
  presentPlotCall,
  presentPlotResult,
} from '@deepseek-ai/dsh-tool-chart'

const testToolSignal = new AbortController().signal

const MAX_POINTS = 200
const MAX_SERIES = 8
const MAX_TEXT = 256

/** Mount the real registries and the chart tool; return an executor helper. */
async function mount(opts: { config?: ToolChart.Config } = {}): Promise<{
  ctx: Context
  fiber: Awaited<ReturnType<Context['plugin']>>
  call: (name: string, args: unknown) => Promise<ToolExecutionResult>
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(ToolChart, opts.config ?? {})
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

/** A valid two-series line chart argument set. */
const lineArgs = {
  chart_type: 'line',
  title: 'Monthly sales',
  x_label: 'Month',
  y_label: 'Revenue',
  labels: ['Jan', 'Feb', 'Mar'],
  series: [
    { name: 'Cats', values: [1, 2, 3] },
    { name: 'Dogs', values: [4, 5, 6] },
  ],
}

describe('argument validation', () => {
  it('validates a line chart and trims display text', () => {
    expect(parsePlotArgs({ ...lineArgs, title: '  Monthly sales  ', x_label: '  Month ' }, MAX_POINTS, MAX_SERIES, MAX_TEXT)).toEqual({
      chart_type: 'line',
      title: 'Monthly sales',
      x_label: 'Month',
      y_label: 'Revenue',
      labels: ['Jan', 'Feb', 'Mar'],
      series: [
        { name: 'Cats', values: [1, 2, 3] },
        { name: 'Dogs', values: [4, 5, 6] },
      ],
    })
  })

  it('rejects an unknown chart type', () => {
    expect(() => parsePlotArgs({ chart_type: 'donut', series: [{ values: [1] }] }, MAX_POINTS, MAX_SERIES, MAX_TEXT))
      .toThrow(/chart_type must be one of/)
  })

  it('requires labels for line, bar, and pie charts', () => {
    for (const chart_type of ['line', 'bar', 'pie']) {
      expect(() => parsePlotArgs({ chart_type, series: [{ values: [1] }] }, MAX_POINTS, MAX_SERIES, MAX_TEXT))
        .toThrow(`labels are required for ${chart_type} charts`)
    }
  })

  it('defaults scatter labels to 0..n-1 and requires numeric labels when supplied', () => {
    expect(parsePlotArgs({ chart_type: 'scatter', series: [{ values: [5, 6] }] }, MAX_POINTS, MAX_SERIES, MAX_TEXT))
      .toEqual({ chart_type: 'scatter', labels: [0, 1], series: [{ values: [5, 6] }] })
    expect(() => parsePlotArgs({ chart_type: 'scatter', labels: ['a', 'b'], series: [{ values: [5, 6] }] }, MAX_POINTS, MAX_SERIES, MAX_TEXT))
      .toThrow(/scatter labels must be numbers/)
  })

  it('rejects blank, over-length, and non-finite values and labels', () => {
    expect(() => parsePlotArgs({ ...lineArgs, title: '   ' }, MAX_POINTS, MAX_SERIES, MAX_TEXT)).toThrow(/title must be a non-empty string/)
    expect(() => parsePlotArgs({ ...lineArgs, title: 'x'.repeat(257) }, MAX_POINTS, MAX_SERIES, MAX_TEXT)).toThrow(/no longer than 256 characters/)
    expect(() => parsePlotArgs({ ...lineArgs, labels: ['', 'Feb', 'Mar'] }, MAX_POINTS, MAX_SERIES, MAX_TEXT)).toThrow(/labels entries must be non-empty/)
    expect(() => parsePlotArgs({ ...lineArgs, labels: [NaN, 'Feb', 'Mar'] }, MAX_POINTS, MAX_SERIES, MAX_TEXT)).toThrow(/labels entries must be finite numbers/)
    expect(() => parsePlotArgs({ ...lineArgs, series: [{ values: [1, Infinity, 3] }] }, MAX_POINTS, MAX_SERIES, MAX_TEXT)).toThrow(/must be a finite number/)
  })

  it('enforces series count, value alignment, and the pie single-series rule', () => {
    expect(() => parsePlotArgs({ ...lineArgs, series: [] }, MAX_POINTS, MAX_SERIES, MAX_TEXT)).toThrow(/series must contain between 1 and 8/)
    expect(() => parsePlotArgs({ ...lineArgs, series: [{ values: [1, 2] }] }, MAX_POINTS, MAX_SERIES, MAX_TEXT)).toThrow(/exactly 3 entries/)
    expect(() => parsePlotArgs({ chart_type: 'pie', labels: ['a', 'b'], series: [{ values: [1, 2] }, { values: [1, 2] }] }, MAX_POINTS, MAX_SERIES, MAX_TEXT))
      .toThrow(/pie charts take exactly one series/)
    expect(() => parsePlotArgs({ chart_type: 'pie', labels: ['a', 'b'], series: [{ values: [1, -2] }] }, MAX_POINTS, MAX_SERIES, MAX_TEXT))
      .toThrow(/pie values must be non-negative/)
  })

  it('enforces the configured caps', () => {
    expect(() => parsePlotArgs({ ...lineArgs, labels: ['a', 'b', 'c', 'd'] }, 3, MAX_SERIES, MAX_TEXT)).toThrow(/labels must contain between 1 and 3/)
    expect(() => parsePlotArgs({ ...lineArgs }, MAX_POINTS, 1, MAX_TEXT)).toThrow(/series must contain between 1 and 1/)
  })
})

describe('formatting', () => {
  it('formats the model-facing confirmation', () => {
    expect(formatChartOutput({
      chart_type: 'bar',
      title: 'Monthly sales',
      labels: ['Jan', 'Feb', 'Mar'],
      series: [{ name: 'Cats', values: [1, 2, 3] }],
    })).toBe('Rendered a bar chart "Monthly sales" with 1 series and 3 data points.')
    expect(formatChartOutput({ chart_type: 'pie', labels: ['a'], series: [{ values: [1] }] }))
      .toBe('Rendered a pie chart with 1 series and 1 data points.')
  })
})

describe('presentation', () => {
  it('declares a generic pending card titled by the chart', () => {
    expect(presentPlotCall(lineArgs)).toEqual({
      card: 'generic',
      title: 'Chart: Monthly sales',
      rawInput: { chart_type: 'line', series: 2, labels: 3 },
    })
    expect(presentPlotCall({ chart_type: 'pie', series: [{ values: [1] }] })).toEqual({
      card: 'generic',
      title: 'Chart: pie',
      rawInput: { chart_type: 'pie', series: 1, labels: 0 },
    })
  })

  it('round-trips the canonical value through meta into the chart result card', () => {
    const spec = parsePlotArgs(lineArgs, MAX_POINTS, MAX_SERIES, MAX_TEXT)
    const meta = plotMetaFromValue(spec)
    expect(plotSpecFromMeta(meta)).toEqual(spec)
    const view = presentPlotResult(lineArgs, { content: [], isError: false, meta })
    expect(view).toEqual({ card: 'chart', title: 'Chart: Monthly sales', spec })
  })

  it('falls back to the generic card on failure or malformed meta', () => {
    expect(presentPlotResult(lineArgs, { content: [], isError: true })).toBeUndefined()
    expect(presentPlotResult(lineArgs, { content: [], isError: false })).toBeUndefined()
    expect(presentPlotResult(lineArgs, { content: [], isError: false, meta: { chart_type: 'line', labels: [], series: [] } })).toBeUndefined()
    expect(presentPlotResult(lineArgs, { content: [], isError: false, meta: { ...lineArgs, series: [{ values: [1, 2] }] } })).toBeUndefined()
    expect(plotSpecFromMeta(null)).toBeUndefined()
    expect(plotSpecFromMeta('chart')).toBeUndefined()
    expect(plotSpecFromMeta({ ...lineArgs, chart_type: 'donut' })).toBeUndefined()
  })
})

describe('registration', () => {
  it('registers the tool, its prompt section, and proves disposal', async () => {
    const { ctx, fiber } = await mount()
    expect(ctx.tools.schemas().map(s => s.name)).toContain('plot_chart')
    // The wrapped classifier is fail-closed: schema-valid args classify parallel.
    expect(ctx.tools.get('plot_chart')?.isConcurrencySafe?.(lineArgs)).toBe(true)
    const prompt = await ctx.systemPrompt.assemble()
    expect(prompt.sections.map(s => s.text).join('\n')).toContain('Use the plot_chart tool to visualize data inside the conversation')
    await fiber.dispose()
    expect(ctx.tools.schemas().map(s => s.name)).not.toContain('plot_chart')
  })

  it('rejects invalid config loudly', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await expect(ctx.plugin(ToolChart, { maxPoints: 0 })).rejects.toThrow(/maxPoints must be a positive integer/)
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in ToolChart).toBe(false)
  })
})

describe('execution through the real registry', () => {
  it('executes a valid line chart and returns the canonical spec', async () => {
    const { fiber, call } = await mount()
    const out = await call('plot_chart', lineArgs)
    expect(out.isError).toBe(false)
    expect(out.value).toEqual({
      chart_type: 'line',
      title: 'Monthly sales',
      x_label: 'Month',
      y_label: 'Revenue',
      labels: ['Jan', 'Feb', 'Mar'],
      series: [
        { name: 'Cats', values: [1, 2, 3] },
        { name: 'Dogs', values: [4, 5, 6] },
      ],
    })
    expect(textOf(out.content)).toContain('Rendered a line chart "Monthly sales" with 2 series and 3 data points.')
    expect(out.meta).toEqual(out.value)
    await fiber.dispose()
  })

  it('executes a pie chart with omitted optional text', async () => {
    const { fiber, call } = await mount()
    const out = await call('plot_chart', { chart_type: 'pie', labels: ['a', 'b'], series: [{ values: [3, 4] }] })
    expect(out.isError).toBe(false)
    expect(out.value).toEqual({ chart_type: 'pie', labels: ['a', 'b'], series: [{ values: [3, 4] }] })
    await fiber.dispose()
  })

  it('rejects schema-invalid arguments with a structured INVALID_ARGS error', async () => {
    const { fiber, call } = await mount()
    const out = await call('plot_chart', { chart_type: 'donut', series: [{ values: [1] }] })
    expect(out.isError).toBe(true)
    expect(out.error?.info?.code).toBe('INVALID_ARGS')
    await fiber.dispose()
  })

  it('surfaces semantic argument errors as tool failures', async () => {
    const { fiber, call } = await mount()
    const out = await call('plot_chart', { chart_type: 'pie', labels: ['a'], series: [{ values: [1, 2] }] })
    expect(out.isError).toBe(true)
    expect(out.error?.message).toBe('plot_chart: series[0].values must have exactly 1 entries (one per label)')
    await fiber.dispose()
  })
})
