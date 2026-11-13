import { describe, expect, it } from 'vitest'
import { categoryLabelStep, isChartValue, linearScale, niceStep, niceTicks, seriesTotal } from '../src/chart/scales.ts'

describe('niceStep', () => {
  it('rounds up to a 1/2/5 × 10^k step at least as large as the rough step', () => {
    expect(niceStep(0.3)).toBe(0.5)
    expect(niceStep(0.5)).toBe(0.5)
    expect(niceStep(0.51)).toBe(1)
    expect(niceStep(3)).toBe(5)
    expect(niceStep(25)).toBe(50)
    expect(niceStep(1)).toBe(1)
  })

  it('falls back to 1 for non-finite or non-positive rough steps', () => {
    expect(niceStep(0)).toBe(1)
    expect(niceStep(-4)).toBe(1)
    expect(niceStep(Number.NaN)).toBe(1)
    expect(niceStep(Number.POSITIVE_INFINITY)).toBe(1)
  })
})

describe('niceTicks', () => {
  it('covers the domain with at most maxTicks+1 nice ticks', () => {
    const ticks = niceTicks(0, 100, 5)
    expect(ticks[0]).toBe(0)
    expect(ticks.at(-1)).toBe(100)
    expect(ticks.length).toBeLessThanOrEqual(6)
    expect(ticks.every((tick, index) => index === 0 || tick > ticks[index - 1]!)).toBe(true)
  })

  it('covers the domain from below without emitting ticks above the max', () => {
    // min 0, max 97, rough step 24.25 → nice step 50 → ticks [0, 50] stay under.
    expect(niceTicks(0, 97, 5)).toEqual([0, 50])
  })

  it('returns the single value for a flat domain', () => {
    expect(niceTicks(5, 5)).toEqual([5])
  })
})

describe('linearScale', () => {
  it('maps domain edges to range edges and interpolates between', () => {
    expect(linearScale(0, 10, 0, 100, 0)).toBe(0)
    expect(linearScale(0, 10, 0, 100, 10)).toBe(100)
    expect(linearScale(0, 10, 0, 100, 5)).toBe(50)
  })

  it('maps every value to the range midpoint for a flat domain', () => {
    expect(linearScale(3, 3, 10, 20, 3)).toBe(15)
  })
})

describe('categoryLabelStep', () => {
  it('shows every label below the cap and skips evenly above it', () => {
    expect(categoryLabelStep(8, 8)).toBe(1)
    expect(categoryLabelStep(9, 8)).toBe(2)
    expect(categoryLabelStep(24, 8)).toBe(3)
  })
})

describe('seriesTotal', () => {
  it('sums the values', () => {
    expect(seriesTotal([1, 2, 3])).toBe(6)
    expect(seriesTotal([])).toBe(0)
    expect(seriesTotal([-1, 1])).toBe(0)
  })
})

describe('isChartValue', () => {
  it('accepts finite numbers and rejects everything else', () => {
    expect(isChartValue(1)).toBe(true)
    expect(isChartValue(-0)).toBe(true)
    expect(isChartValue(Number.NaN)).toBe(false)
    expect(isChartValue(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isChartValue('1')).toBe(false)
    expect(isChartValue(null)).toBe(false)
  })
})
