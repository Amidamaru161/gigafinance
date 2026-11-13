// ChartBlock: the surface for a completed `plot_chart` call. One component
// draws the four kinds of the `chart` render intent, discriminated by
// `chart_type`: a `line`/`bar`/`scatter` plot shares one category-or-numeric x
// axis with a nice-tick y scale, and a `pie` draws a donut with an HTML legend
// beside it. The component renders a static, plain SVG — no scripts, no
// foreignObject, no raw text interpolation — from the validated spec, so a
// hostile or malformed wire spec can only produce bounded markup: every string
// is a React text node, every number is checked finite before it becomes an
// attribute, and the spec shape is guarded before any element is drawn. Colors
// come only from `--dsw-*` theme tokens through CSS classes; geometry mirrors
// the code/terminal/web card family so a chart card reads as one of them.

import clsx from 'clsx'
import type { ReactNode } from 'react'
import { categoryLabelStep, isChartValue, linearScale, niceTicks, seriesTotal } from './scales.ts'
import css from './ChartBlock.module.css'

/** One data series drawn in the chart, the projection of the contract's `ChartSeries`. */
export interface ChartBlockSeries {
  /** Series display name, shown in the legend when present. */
  name?: string | undefined
  /** The series' numeric values, aligned with `labels`. */
  values: number[]
}

/**
 * A chart card's props: the validated chart spec plus the callers' position
 * class. The component is a pure function of these props.
 */
export interface ChartBlockProps {
  /** Chart type: which plot to draw. */
  chart_type: 'line' | 'bar' | 'scatter' | 'pie'
  /** Chart title, rendered above the plot when present. */
  title?: string | undefined
  /** x-axis label, rendered under the axis when present. */
  x_label?: string | undefined
  /** y-axis label, rendered beside the axis when present. */
  y_label?: string | undefined
  /** Category labels or numeric x positions, one per point. */
  labels: (string | number)[]
  /** The data series; one for pie, one or more for the other types. */
  series: ChartBlockSeries[]
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}

/** SVG viewBox geometry. */
const VIEW_W = 720
const VIEW_H = 360
/** Plot-area padding: room for y ticks, x labels, and axis captions. */
const PAD = { left: 52, right: 14, top: 14, bottom: 46 }
/** How many series colors the palette provides before cycling. */
const PALETTE_SIZE = 5
/** Pie ring geometry. */
const PIE_CX = 230
const PIE_CY = 180
const PIE_R = 118
const PIE_STROKE = 46
/** Longest category label drawn on the x axis before truncation. */
const LABEL_MAX_CHARS = 14
/** Category tick labels rendered on the axis at once (the rest are skipped). */
const MAX_CATEGORY_LABELS = 8

/**
 * Format one y-axis tick: up to six significant digits with trailing zeros
 * stripped, so ticks stay readable without floating-point noise.
 * @param value - the tick value.
 * @returns its display text.
 */
function formatTick(value: number): string {
  return Number(value.toPrecision(6)).toString()
}

/**
 * Truncate one category label to the axis budget, marking the cut with an
 * ellipsis.
 * @param label - the raw label (string or number).
 * @returns the display text.
 */
function labelText(label: string | number): string {
  const text = String(label)
  return text.length <= LABEL_MAX_CHARS ? text : `${text.slice(0, LABEL_MAX_CHARS - 1)}…`
}

/** The CSS class of one series' palette color, cycling past the palette size. */
function seriesClass(index: number): string {
  const slot = index % PALETTE_SIZE
  const classes: Record<number, string> = {
    0: css.series0!,
    1: css.series1!,
    2: css.series2!,
    3: css.series3!,
    4: css.series4!,
  }
  return classes[slot] ?? css.series0!
}

/**
 * Guard the wire spec into a drawable shape: every series value finite, every
 * series aligned with the labels, at least one point per series. The card
 * model already narrowed the shape; this keeps drawing total for malformed
 * values the wire can still carry (non-finite numbers fail JSON round-trips
 * but arrive here from an in-memory projection).
 * @param props - the incoming props.
 * @returns false when nothing drawable remains.
 */
function drawable(props: ChartBlockProps): boolean {
  if (!(props.labels.length > 0)) return false
  if (!(props.series.length > 0)) return false
  return props.series.every(series =>
    Array.isArray(series.values)
    && series.values.length === props.labels.length
    && series.values.every(isChartValue))
}

/** The finite y domain of all series, with a flat-domain pad so a plot never divides by zero. */
function yDomain(series: readonly ChartBlockSeries[], includeZero: boolean): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const item of series) {
    for (const value of item.values) {
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  if (!Number.isFinite(min)) return [0, 1]
  if (min === max) {
    const pad = Math.abs(min) === 0 ? 1 : Math.abs(min) * 0.1
    return [min - pad, max + pad]
  }
  if (includeZero) {
    min = Math.min(0, min)
    max = Math.max(0, max)
  }
  const pad = (max - min) * 0.05
  return [min - pad, max + pad]
}

/** The finite x domain of a scatter chart's numeric labels. */
function xDomain(labels: readonly (string | number)[]): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const label of labels) {
    if (typeof label !== 'number' || !Number.isFinite(label)) continue
    if (label < min) min = label
    if (label > max) max = label
  }
  if (!Number.isFinite(min)) return [0, 1]
  if (min === max) return [min - 1, max + 1]
  const pad = (max - min) * 0.05
  return [min - pad, max + pad]
}

/**
 * The shared numeric y axis: a tick label, the gridline, and the baseline.
 * @param props.ticks - the tick values.
 * @param props.yOf - domain-to-pixel mapping for the y axis.
 * @param props.plot - the plot rectangle.
 * @returns the axis group.
 */
function YAxis({ ticks, yOf, plot }: { ticks: number[]; yOf: (value: number) => number; plot: { x0: number; w: number } }) {
  return (
    <g>
      {ticks.map(tick => (
        <g key={tick}>
          <line
            className={css.grid}
            x1={plot.x0}
            x2={plot.x0 + plot.w}
            y1={yOf(tick)}
            y2={yOf(tick)}
          />
          <text className={css.axisText} x={plot.x0 - 8} y={yOf(tick)} textAnchor="end" dominantBaseline="middle">
            {formatTick(tick)}
          </text>
        </g>
      ))}
    </g>
  )
}

/**
 * The category x axis for line/bar charts: every {@link step}-th label, the
 * axis line, and the optional x caption.
 * @param props.labels - the category labels.
 * @param props.xOf - index-to-pixel mapping.
 * @param props.step - the label skip factor.
 * @param props.plot - the plot rectangle.
 * @returns the axis group.
 */
function CategoryAxis({ labels, xOf, step, plot }: { labels: (string | number)[]; xOf: (index: number) => number; step: number; plot: { x0: number; y1: number; w: number } }) {
  const ticks = []
  for (let index = 0; index < labels.length; index += step) {
    ticks.push(
      <text key={index} className={css.axisText} x={xOf(index)} y={plot.y1 + 18} textAnchor="middle">
        {labelText(labels[index] ?? '')}
      </text>,
    )
  }
  return (
    <g>
      <line className={css.axisLine} x1={plot.x0} x2={plot.x0 + plot.w} y1={plot.y1} y2={plot.y1} />
      {ticks}
    </g>
  )
}

/** One palette-colored legend chip for a series. */
function LegendChip({ name, index }: { name: string; index: number }) {
  return (
    <span className={css.legendItem}>
      <span className={clsx(css.legendDot, seriesClass(index))} aria-hidden />
      <span className={css.legendName}>{name}</span>
    </span>
  )
}

/**
 * The shared block wrapper: title, the SVG plot, the x/y captions, and the
 * legend. `data-chart` carries the type for tests and styling. For a pie the
 * legend lists the slice labels (one per value index); for the cartesian types
 * it lists the named series (series index colors the dot).
 */
function ChartFrame({ props, plot }: { props: ChartBlockProps; plot: ReactNode }) {
  const plotArea = { x0: PAD.left, y0: PAD.top, y1: VIEW_H - PAD.bottom, w: VIEW_W - PAD.left - PAD.right, h: VIEW_H - PAD.top - PAD.bottom }
  const pieLegend = props.chart_type === 'pie'
  const legendItems = pieLegend
    ? props.labels.map((label, index) => ({ name: labelText(label), index }))
    : props.series
      .map((series, index) => ({ name: (series.name ?? '').trim(), index }))
      .filter(item => item.name !== '')
  return (
    <div className={clsx(css.block, props.className)} data-chart={props.chart_type}>
      {props.title !== undefined && props.title !== '' && (
        <div className={css.title}>{props.title}</div>
      )}
      <div className={css.plotRow}>
        <svg
          className={css.svg}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={props.title ?? `${props.chart_type} chart`}
        >
          {props.y_label !== undefined && props.y_label !== '' && (
            <text
              className={css.axisCaption}
              x={14}
              y={plotArea.y0 + plotArea.h / 2}
              textAnchor="middle"
              transform={`rotate(-90 14 ${plotArea.y0 + plotArea.h / 2})`}
            >
              {props.y_label}
            </text>
          )}
          {plot}
          {props.x_label !== undefined && props.x_label !== '' && (
            <text
              className={css.axisCaption}
              x={plotArea.x0 + plotArea.w / 2}
              y={VIEW_H - 8}
              textAnchor="middle"
            >
              {props.x_label}
            </text>
          )}
        </svg>
        {pieLegend && legendItems.length > 0 && (
          <div className={css.legend}>
            {legendItems.map(({ name, index }) => <LegendChip key={index} name={name} index={index} />)}
          </div>
        )}
      </div>
      {!pieLegend && legendItems.length > 0 && (
        <div className={css.legend}>
          {legendItems.map(({ name, index }) => <LegendChip key={index} name={name} index={index} />)}
        </div>
      )}
    </div>
  )
}

/** One category/cartesian plot: line, bar, or scatter body. */
function CartesianPlot({ props }: { props: ChartBlockProps }) {
  const plot = { x0: PAD.left, y0: PAD.top, y1: VIEW_H - PAD.bottom, w: VIEW_W - PAD.left - PAD.right, h: VIEW_H - PAD.top - PAD.bottom }
  const includeZero = props.chart_type === 'bar'
  const [domainMin, domainMax] = yDomain(props.series, includeZero)
  const ticks = niceTicks(domainMin, domainMax, 5)
  const yOf = (value: number) => linearScale(domainMin, domainMax, plot.y1, plot.y0, value)
  const category = props.chart_type !== 'scatter'
  const xOfCategory = (index: number) => linearScale(0, Math.max(1, props.labels.length - 1), plot.x0, plot.x0 + plot.w, index)
  const [xMin, xMax] = xDomain(props.labels)
  const xOfNumeric = (value: number) => linearScale(xMin, xMax, plot.x0, plot.x0 + plot.w, value)
  const band = plot.w / Math.max(1, props.labels.length)
  const barWidth = band * 0.72 / Math.max(1, props.series.length)
  const step = categoryLabelStep(props.labels.length, MAX_CATEGORY_LABELS)
  return (
    <ChartFrame props={props} plot={(
      <>
        <YAxis ticks={ticks} yOf={yOf} plot={plot} />
        {props.chart_type === 'line' && props.series.map((series, s) => (
          <polyline
            key={s}
            className={clsx(css.line, seriesClass(s))}
            fill="none"
            strokeWidth={2}
            points={series.values.map((value, index) => `${xOfCategory(index)},${yOf(value)}`).join(' ')}
          />
        ))}
        {props.chart_type === 'bar' && props.series.map((series, s) => (
          <g key={s} className={seriesClass(s)}>
            {series.values.map((value, index) => {
              const y = yOf(Math.max(0, value))
              const zero = yOf(Math.min(0, value))
              return (
                <rect
                  key={index}
                  className={css.bar}
                  x={xOfCategory(index) - band * 0.36 + s * barWidth + (band * 0.72 - barWidth * props.series.length) / 2}
                  y={Math.min(y, zero)}
                  width={barWidth}
                  height={Math.max(1, Math.abs(y - zero))}
                />
              )
            })}
          </g>
        ))}
        {props.chart_type === 'scatter' && props.series.map((series, s) => (
          <g key={s} className={seriesClass(s)}>
            {series.values.map((value, index) => {
              const x = props.labels[index]
              if (typeof x !== 'number' || !Number.isFinite(x)) return null
              return <circle key={index} className={css.point} cx={xOfNumeric(x)} cy={yOf(value)} r={3.5} />
            })}
          </g>
        ))}
        {category
          ? <CategoryAxis labels={props.labels} xOf={xOfCategory} step={step} plot={plot} />
          : (
            <g>
              <line className={css.axisLine} x1={plot.x0} x2={plot.x0 + plot.w} y1={plot.y1} y2={plot.y1} />
              {niceTicks(xMin, xMax, 8).map(tick => (
                <text key={tick} className={css.axisText} x={xOfNumeric(tick)} y={plot.y1 + 18} textAnchor="middle">
                  {formatTick(tick)}
                </text>
              ))}
            </g>
          )}
      </>
    )} />
  )
}

/** The donut body for a pie chart: one arc per non-zero value. */
function PiePlot({ props }: { props: ChartBlockProps }) {
  const [series] = props.series
  const values = series?.values ?? []
  const total = seriesTotal(values)
  const drawn = total > 0 ? values.map(value => value / total) : values.map(() => 0)
  const single = drawn.length === 1
  return (
    <ChartFrame props={props} plot={(
      <g>
        {single && (
          <circle
            className={seriesClass(0)}
            cx={PIE_CX}
            cy={PIE_CY}
            r={PIE_R}
            fill="none"
            strokeWidth={PIE_STROKE}
          />
        )}
        {!single && drawn.map((fraction, index) => {
          if (fraction <= 0) return null
          const startAngle = index === 0 ? 0 : 2 * Math.PI * drawn.slice(0, index).reduce((sum, f) => sum + f, 0)
          const endAngle = startAngle + 2 * Math.PI * fraction
          const largeArc = fraction > 0.5 ? 1 : 0
          const x1 = PIE_CX + PIE_R * Math.cos(startAngle)
          const y1 = PIE_CY + PIE_R * Math.sin(startAngle)
          const x2 = PIE_CX + PIE_R * Math.cos(endAngle)
          const y2 = PIE_CY + PIE_R * Math.sin(endAngle)
          return (
            <path
              key={index}
              className={seriesClass(index)}
              d={`M ${x1} ${y1} A ${PIE_R} ${PIE_R} 0 ${largeArc} 1 ${x2} ${y2}`}
              fill="none"
              strokeWidth={PIE_STROKE}
            />
          )
        })}
      </g>
    )} />
  )
}

/**
 * Render a completed chart as a static SVG plot.
 * @param props - see {@link ChartBlockProps}; `chart_type` selects the plot body.
 * @returns the chart card element.
 */
export function ChartBlock(props: ChartBlockProps) {
  if (!drawable(props)) {
    return (
      <div className={clsx(css.block, props.className)} data-chart="empty">
        <div className={css.empty}>无法绘制图表</div>
      </div>
    )
  }
  return props.chart_type === 'pie'
    ? <PiePlot props={props} />
    : <CartesianPlot props={props} />
}
