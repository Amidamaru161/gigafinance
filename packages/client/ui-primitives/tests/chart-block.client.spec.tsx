// @vitest-environment jsdom
// The chart render intent on the client side: the pure ChartBlock SVG primitive
// (the four chart types, the empty/degenerate arms, and the caption/legend
// chrome) fed with realistic validated specs. The suite renders the component
// directly — no cordis — and asserts user-visible structure, not color classes.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ChartBlock } from '../src/chart/ChartBlock.tsx'

afterEach(cleanup)

/** A valid two-series line chart spec. */
const line = {
  chart_type: 'line' as const,
  title: 'Monthly sales',
  x_label: 'Month',
  y_label: 'Revenue',
  labels: ['Jan', 'Feb', 'Mar', 'Apr'],
  series: [
    { name: 'Cats', values: [1, 2, 3, 4] },
    { name: 'Dogs', values: [4, 3, 2, 1] },
  ],
}

describe('ChartBlock', () => {
  it('renders a title, the plot SVG, and named-series legend for a line chart', () => {
    const { container } = render(<ChartBlock {...line} />)
    expect(container.querySelector('[data-chart="line"]')).not.toBeNull()
    expect(container.textContent).toContain('Monthly sales')
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelectorAll('polyline')).toHaveLength(2)
    expect(container.textContent).toContain('Cats')
    expect(container.textContent).toContain('Dogs')
  })

  it('renders bar rects counting every series value', () => {
    const { container } = render(<ChartBlock chart_type="bar" labels={['a', 'b']} series={[{ values: [1, 2] }, { values: [3, 4] }]} />)
    expect(container.querySelector('[data-chart="bar"]')).not.toBeNull()
    expect(container.querySelectorAll('rect')).toHaveLength(4)
  })

  it('renders one point per scatter value and a numeric x axis', () => {
    const { container } = render(<ChartBlock chart_type="scatter" labels={[0, 1, 2]} series={[{ values: [5, 6, 7] }]} />)
    expect(container.querySelector('[data-chart="scatter"]')).not.toBeNull()
    expect(container.querySelectorAll('circle[class]')).toHaveLength(3)
  })

  it('renders a pie donut with a slice legend from the labels', () => {
    const { container } = render(<ChartBlock chart_type="pie" labels={['Cats', 'Dogs', 'Birds']} series={[{ values: [1, 2, 3] }]} />)
    expect(container.querySelector('[data-chart="pie"]')).not.toBeNull()
    expect(container.querySelectorAll('path')).toHaveLength(3)
    expect(container.textContent).toContain('Cats')
    expect(container.textContent).toContain('Dogs')
    expect(container.textContent).toContain('Birds')
  })

  it('renders a full ring for a single all-negative-safe slice list', () => {
    const { container } = render(<ChartBlock chart_type="pie" labels={['Only']} series={[{ values: [7] }]} />)
    expect(container.querySelectorAll('circle')).toHaveLength(1)
  })

  it('skips zero-value pie slices and still renders the remaining arcs', () => {
    const { container } = render(<ChartBlock chart_type="pie" labels={['a', 'b']} series={[{ values: [0, 5] }]} />)
    // One zero slice is skipped; one non-zero arc remains.
    expect(container.querySelectorAll('path')).toHaveLength(1)
  })

  it('renders the empty-card arm for a chart with nothing drawable', () => {
    const { container } = render(<ChartBlock chart_type="line" labels={[]} series={[]} />)
    expect(container.querySelector('[data-chart="empty"]')).not.toBeNull()
    expect(container.textContent).toContain('无法绘制图表')
    // Misaligned series values also fail the guard rather than drawing.
    const misaligned = render(<ChartBlock chart_type="line" labels={['a', 'b']} series={[{ values: [1] }]} />)
    expect(misaligned.container.querySelector('[data-chart="empty"]')).not.toBeNull()
    cleanup()
  })

  it('omits the y-axis caption label when absent and includes it when present', () => {
    const without = render(<ChartBlock chart_type="line" labels={['a', 'b']} series={[{ values: [1, 2] }]} />)
    expect(without.container.textContent).not.toContain('Revenue')
    const withLabels = render(<ChartBlock {...line} />)
    expect(withLabels.container.querySelectorAll('text')).not.toHaveLength(0)
    expect(withLabels.container.textContent).toContain('Month')
    expect(withLabels.container.textContent).toContain('Revenue')
  })

  it('renders tick labels on the y axis for each nice tick', () => {
    const { container } = render(<ChartBlock chart_type="bar" labels={['a', 'b']} series={[{ values: [0, 100] }]} />)
    const texts = Array.from(container.querySelectorAll('text')).map(node => node.textContent)
    // The y axis always shows a tick at the domain minimum (0) and top (100).
    expect(texts).toContain('100')
  })
})
