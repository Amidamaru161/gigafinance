/**
 * Pure numeric helpers for {@link ChartBlock}'s SVG scales: nice tick steps,
 * tick generation, and the category tick skip factor. No DOM, no React — plain
 * functions so they test without a renderer.
 * @module
 */

/**
 * The smallest "nice" step (1/2/5 × 10^k) at least as large as the rough step.
 * @param rough - the minimum acceptable step size.
 * @returns the nice step.
 */
export function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  for (const factor of [1, 2, 5, 10]) {
    const step = factor * magnitude
    if (step >= rough) return step
  }
  /* v8 ignore next -- the factor loop always terminates at 10 * magnitude >= rough. */
  return 10 * magnitude
}

/**
 * Nice tick values covering `[min, max]` inclusive, at most `maxTicks` steps
 * apart, expanded so the first and last tick sit on nice multiples.
 * @param min - the domain minimum (finite).
 * @param max - the domain maximum (finite, >= min).
 * @param maxTicks - the target tick count (>= 2).
 * @returns ascending tick values; `[min]`-style single values only for a flat domain.
 */
export function niceTicks(min: number, max: number, maxTicks = 5): number[] {
  if (min === max) return [min]
  const step = niceStep((max - min) / Math.max(1, maxTicks - 1))
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let value = start; value <= max + step * 1e-9; value += step) {
    // A tick exactly at the domain max may drift past it by floating error; clamp it back.
    ticks.push(value > max ? max : value)
    if (ticks.length >= 2 * maxTicks) break
  }
  return ticks
}

/**
 * Linear mapping of one value from a domain to a pixel range.
 * @param domainMin - the domain minimum.
 * @param domainMax - the domain maximum (> domainMin).
 * @param rangeMin - the range start in pixels.
 * @param rangeMax - the range end in pixels.
 * @param value - the value to map.
 * @returns the mapped pixel position.
 */
export function linearScale(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number, value: number): number {
  if (domainMax === domainMin) return (rangeMin + rangeMax) / 2
  return rangeMin + ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin)
}

/**
 * The step between shown category tick labels, so at most `maxLabels` labels
 * render for a category axis: 1 (every label), 2 (every other), and so on.
 * @param count - the category count.
 * @param maxLabels - the target maximum of rendered labels.
 * @returns the skip factor (>= 1).
 */
export function categoryLabelStep(count: number, maxLabels = 8): number {
  if (count <= maxLabels) return 1
  return Math.ceil(count / maxLabels)
}

/**
 * Total numeric values of one chart series.
 * @param values - the series values.
 * @returns their sum.
 */
export function seriesTotal(values: readonly number[]): number {
  let total = 0
  for (const value of values) total += value
  return total
}

/**
 * Whether a candidate number is a drawable finite chart value.
 * @param value - the candidate value.
 * @returns true for finite numbers (negative zero included; drawing treats it as 0).
 */
export function isChartValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
