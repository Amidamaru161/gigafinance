/**
 * Model-facing `render_widget` tool: the model returns a self-contained HTML/JS
 * snippet that a capable UI draws inside a sandboxed iframe (scripts allowed,
 * no same-origin, no network). This package owns the schema, size caps and the
 * `widget` card presentation; it never executes the HTML itself.
 * @module @deepseek-ai/dsh-tool-widget
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, JsonValue, ToolResult, WidgetResultView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-widget'

/** Services required by the widget tool. */
export const inject = ['tools', 'systemPrompt']

/** Default cap on widget HTML characters. */
export const DEFAULT_MAX_HTML_LENGTH = 100_000
/** Cap on title characters. */
export const MAX_TITLE_LENGTH = 200
/** Fixed wire-safety caps for replayed metadata. */
const META_MAX_HTML = 500_000
const META_MAX_TITLE = 512

/** Plugin config. */
export interface Config {
  /** Upper bound on HTML characters per widget. Defaults to 100000. */
  maxHtmlLength?: number
}

export const Config: z<Config> = z.object({
  maxHtmlLength: z.number().default(DEFAULT_MAX_HTML_LENGTH),
})

/** Raw `render_widget` arguments. */
export interface WidgetArgs {
  title: string
  html: string
}

/** Canonical widget value: what the tool returns and replays. */
export interface WidgetSpec {
  title: string
  html: string
}

/**
 * Validate raw arguments into the canonical spec. Errors go back to the model
 * as a failed tool result so it can retry with a fixed call.
 * @param args - schema-validated arguments.
 * @param maxHtmlLength - HTML character cap.
 * @returns the canonical widget spec.
 */
export function parseWidgetArgs(args: WidgetArgs, maxHtmlLength: number): WidgetSpec {
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (title.length === 0) throw new Error('render_widget: title must be a non-empty string')
  if (title.length > MAX_TITLE_LENGTH) {
    throw new Error(`render_widget: title must be no longer than ${MAX_TITLE_LENGTH} characters`)
  }
  const html = typeof args.html === 'string' ? args.html.trim() : ''
  if (html.length === 0) throw new Error('render_widget: html must be a non-empty string')
  if (html.length > maxHtmlLength) {
    throw new Error(`render_widget: html must be no longer than ${maxHtmlLength} characters; simplify the widget`)
  }
  if (/<!doctype/i.test(html) || /<(html|head|body)[\s>]/i.test(html)) {
    throw new Error('render_widget: pass body content only, without <!doctype>, <html>, <head>, or <body> tags')
  }
  return { title, html }
}

/**
 * Narrow opaque result metadata to a {@link WidgetSpec}.
 * @param meta - live or replayed result metadata.
 * @returns the spec, or undefined when absent or malformed.
 */
export function widgetSpecFromMeta(meta: unknown): WidgetSpec | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { title, html } = meta as Record<string, unknown>
  if (typeof title !== 'string' || title.length === 0 || title.length > META_MAX_TITLE) return undefined
  if (typeof html !== 'string' || html.length === 0 || html.length > META_MAX_HTML) return undefined
  return { title, html }
}

/**
 * Pending-call presentation: a generic card titled by the widget.
 * @param args - raw tool arguments (possibly still partial).
 * @returns the generic pending card.
 */
export function presentWidgetCall(args: WidgetArgs): GenericCallView {
  const heading = typeof args.title === 'string' && args.title.trim() !== '' ? args.title.trim() : 'building…'
  return { card: 'generic', title: `Widget: ${heading}` }
}

/**
 * Completed-call presentation: the `widget` card, or generic on error.
 * @param _args - raw tool arguments.
 * @param result - final tool result; `meta` carries the spec.
 * @returns the widget view, or undefined for the generic card.
 */
export function presentWidgetResult(_args: WidgetArgs, result: ToolResult): WidgetResultView | undefined {
  if (result.isError) return undefined
  const spec = widgetSpecFromMeta(result.meta)
  if (spec === undefined) return undefined
  return { card: 'widget', title: spec.title, html: spec.html }
}

const GUIDANCE = [
  'Prefer showing over telling: call render_widget by default, without being asked, whenever the answer contains data or structure that reads better as a visual.',
  'Always use it for: any series of numbers over time (prices, returns, drawdowns, cash flows) — draw a chart; comparisons of several items or scenarios; portfolio or budget composition; results of data/analysis tools (risk metrics, technical analysis, Monte Carlo, bond cashflows) — draw a dashboard with key-figure cards and charts; calculations with parameters the user may want to vary — make an interactive calculator with sliders; processes and structures — draw a diagram.',
  'A markdown table with more than a few numeric rows, or a list of figures the user has to compare in their head, is a signal to draw a widget instead. One widget per answer is normal; several are fine when they show different things.',
  'Skip the widget only for a short factual answer, a single number, plain conversation, or code/file work.',
  'Charts of any kind (line, bar, pie, candles) are drawn as inline SVG or canvas.',
  'html is body content only (no <!doctype>, <html>, <head>, <body>); inline <style>, <svg>, <canvas>, and <script> are allowed.',
  'The widget runs in a sandboxed iframe without network access: no fetch, no external images or fonts; external scripts may load only from https://cdnjs.cloudflare.com, https://cdn.jsdelivr.net, or https://unpkg.com.',
  'Style with the CSS variables --text, --muted, --bg, --surface, --border, --accent so the widget follows the light/dark theme; keep the page background transparent.',
  'Call window.sendPrompt(text) from a button to send a follow-up message as the user.',
  'Before calling, re-read the script: every variable must be declared before use (const/let), every element id you query must exist in the html, and the code must run without errors on load. A runtime error leaves the widget blank.',
  'After the widget is shown, add only a short explanation; do not repeat its contents in text.',
].join(' ')

/**
 * Register the `render_widget` tool and its system-prompt guidance; both are
 * effect-scoped and unregister on plugin dispose.
 * @param ctx - context with `tools` and `systemPrompt` registries.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const maxHtmlLength = config.maxHtmlLength ?? DEFAULT_MAX_HTML_LENGTH
  if (!Number.isInteger(maxHtmlLength) || maxHtmlLength < 1) {
    throw new Error('tool-widget: maxHtmlLength must be a positive integer')
  }

  ctx.systemPrompt.section({ name: 'tool:render_widget', order: 121, text: GUIDANCE })

  ctx.tools.register(defineTool({
    name: 'render_widget',
    description: 'Show an interactive HTML/SVG/JS widget (chart, dashboard, comparison, diagram, calculator, simulation, mockup) to the user inside the conversation. Use it proactively whenever the answer has numeric series, comparisons, compositions, or tool results that read better visually; skip it only for short factual answers.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short widget title.' },
      html: {
        type: 'string',
        required: true,
        description: 'Body-only HTML with optional inline <style>/<svg>/<script>; colors via CSS variables --text, --muted, --bg, --surface, --border, --accent.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          html: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Widget "${(value as unknown as WidgetSpec).title}" is shown to the user. Do not repeat its contents in text.`,
      }],
      presentationMeta: (_args, value) => value as unknown as JsonValue,
    },
    // Pure computation over the call's own arguments; no shared state.
    isConcurrencySafe: () => true,
    async execute(args) {
      return parseWidgetArgs(args, maxHtmlLength)
    },
    presentCall: presentWidgetCall,
    presentResult: (args, result) => presentWidgetResult(args, result),
  }))
}
