// Widget toolview registrant: the keyed toolview hole for the `render_widget`
// tool. The row keeps the shared ToolRow chrome (title, running sweep, error
// state) and, once the call settles with a `card:'widget'` result view, draws
// the model's HTML underneath in a sandboxed iframe.
//
// Security model — the HTML is untrusted model output:
// - `sandbox="allow-scripts"` WITHOUT `allow-same-origin`: scripts run in an
//   opaque origin with no access to this app's DOM, cookies, or storage.
// - A CSP meta tag blocks every network request except script CDNs, so the
//   widget cannot exfiltrate data.
// - The parent accepts only `resize` / `sendPrompt` messages, and only from
//   this iframe's own window; height and prompt length are capped.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import type { ToolCallBlock } from '../models/tool-call-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Wire-safety caps (fixed, not deployment config). */
const META_MAX_HTML = 500_000
const MAX_HEIGHT = 2000
const MIN_HEIGHT = 40
const MAX_PROMPT = 2000

/** The drawable widget derived from a settled call. */
export interface WidgetCardModel {
  title: string
  html: string
}

/**
 * Derive the widget card from a call, or null for the generic path (running
 * call, error, unknown card, or malformed wire data).
 * @param block - running call or settled result node.
 * @returns the widget model, or null.
 */
export function widgetCardModel(block: ToolCallBlock): WidgetCardModel | null {
  if (!('kind' in block)) return null
  const result = block.resultView as { card?: unknown; title?: unknown; html?: unknown } | null | undefined
  if (result?.card !== 'widget') return null
  const { title, html } = result
  if (typeof html !== 'string' || html.length === 0 || html.length > META_MAX_HTML) return null
  return { title: typeof title === 'string' ? title : 'Widget', html }
}

/** App theme tokens mapped onto the small variable set the model is told to use. */
const THEME_VARS: Record<string, string> = {
  '--text': '--dsw-alias-label-primary',
  '--muted': '--dsw-alias-label-secondary',
  '--bg': '--dsw-alias-bg-base',
  '--surface': '--dsw-alias-bg-layer-1',
  '--border': '--dsw-alias-border-l1',
  '--accent': '--dsw-alias-brand-primary',
}
const THEME_FALLBACK: Record<string, string> = {
  '--text': '#1f2328', '--muted': '#656d76', '--bg': '#ffffff',
  '--surface': '#f6f8fa', '--border': '#d0d7de', '--accent': '#4d6bfe',
}

/** Resolve the current theme into a `:root{...}` declaration list. */
function themeCss(): string {
  const style = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement)
  return Object.entries(THEME_VARS).map(([name, source]) => {
    const value = style?.getPropertyValue(source).trim() || THEME_FALLBACK[name]
    return `${name}:${value};`
  }).join('')
}

/** Re-render on theme switches (class/attribute changes on <html> or <body>). */
function useThemeCss(): string {
  const [css, setCss] = useState(themeCss)
  useEffect(() => {
    const update = () => setCss(prev => {
      const next = themeCss()
      return next === prev ? prev : next
    })
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true })
    observer.observe(document.body, { attributes: true })
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener?.('change', update)
    return () => {
      observer.disconnect()
      media?.removeEventListener?.('change', update)
    }
  }, [])
  return css
}

const CDN = 'https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com'

/** Build the sandboxed document around the model's body HTML. */
function buildDocument(html: string, theme: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${CDN}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:">
<style>:root{${theme}color-scheme:light dark}html,body{margin:0;background:transparent}body{padding:4px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text)}*{box-sizing:border-box}</style>
<script>
(function(){
  var post=function(m){parent.postMessage(m,"*")};
  window.sendPrompt=function(t){post({type:"sendPrompt",text:String(t)})};
  var report=function(){post({type:"resize",height:Math.ceil(document.documentElement.scrollHeight)})};
  var sent=0;
  var fail=function(msg){if(sent++<5)post({type:"error",message:String(msg).slice(0,500)})};
  addEventListener("error",function(e){fail((e.message||"Script error")+(e.lineno?" (line "+e.lineno+")":""))});
  addEventListener("unhandledrejection",function(e){var r=e.reason;fail("Unhandled promise rejection: "+(r&&r.message?r.message:r))});
  addEventListener("load",report);
  addEventListener("DOMContentLoaded",function(){new ResizeObserver(report).observe(document.body);report()});
})();
</script></head><body>${html}</body></html>`
}

/** Props for the sandboxed frame. */
interface SandboxFrameProps {
  html: string
  title: string
  onPrompt?: ((text: string) => void) | undefined
}

/** The sandboxed iframe: auto-height, theme-aware, sendPrompt bridge. */
export function SandboxFrame({ html, title, onPrompt }: SandboxFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(150)
  const [errors, setErrors] = useState<string[]>([])
  const theme = useThemeCss()
  const doc = useMemo(() => buildDocument(html, theme), [html, theme])
  const onPromptRef = useRef(onPrompt)
  onPromptRef.current = onPrompt

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return
      const data = event.data as { type?: unknown; height?: unknown; text?: unknown } | null
      if (data === null || typeof data !== 'object') return
      // A 0 height comes from a not-yet-laid-out (e.g. background) frame: keep the last size.
      if (data.type === 'resize' && typeof data.height === 'number' && Number.isFinite(data.height) && data.height > 0) {
        setHeight(Math.max(MIN_HEIGHT, Math.min(Math.ceil(data.height), MAX_HEIGHT)))
      } else if (data.type === 'sendPrompt' && typeof data.text === 'string') {
        const text = data.text.trim().slice(0, MAX_PROMPT)
        if (text !== '') onPromptRef.current?.(text)
      } else if (data.type === 'error' && typeof (data as { message?: unknown }).message === 'string') {
        const message = ((data as { message: string }).message).slice(0, 500)
        if (message !== '') setErrors(prev => (prev.includes(message) || prev.length >= 5 ? prev : [...prev, message]))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // A new document (new html or theme) starts with a clean error list.
  useEffect(() => setErrors([]), [doc])

  const askFix = () => onPromptRef.current?.(
    [`Виджет «${title}» упал с ошибкой JavaScript:`, ...errors, 'Исправь код и перерисуй виджет через render_widget.']
      .join(String.fromCharCode(10))
      .slice(0, MAX_PROMPT),
  )

  return (
    <>
      <iframe
        ref={ref}
        title={title}
        sandbox="allow-scripts"
        srcDoc={doc}
        style={{ display: 'block', width: '100%', height, border: 0, background: 'transparent', marginTop: 6 }}
      />
      {errors.length > 0
        ? (
            <div
              role="alert"
              style={{
                marginTop: 6, padding: '8px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.45,
                color: 'var(--dsw-alias-state-error-primary, #dc2626)',
                background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #dc2626) 8%, transparent)',
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}
            >
              <div style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                <strong>Ошибка в виджете:</strong>
                {errors.map(error => <div key={error}>{error}</div>)}
              </div>
              {onPrompt !== undefined
                ? (
                    <button
                      type="button"
                      onClick={askFix}
                      style={{
                        flexShrink: 0, cursor: 'pointer', borderRadius: 6, padding: '4px 10px', fontSize: 12,
                        border: '1px solid currentColor', background: 'transparent', color: 'inherit',
                      }}
                    >
                      Попросить исправить
                    </button>
                  )
                : null}
            </div>
          )
        : null}
    </>
  )
}

/** Full row props: toolview runtime share, session input actions, locale seat. */
type WidgetRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/** Widget row: ToolRow chrome plus the always-visible sandboxed widget. */
export function WidgetRow(props: WidgetRowProps) {
  const { toolName, block, inspect, t } = props
  const inputActions = (props as { inputActions?: { setDraft(text: string): void; submit(): void } }).inputActions
  const model = toolRowModel(toolName, block)
  const widget = widgetCardModel(block)
  const send = inputActions === undefined
    ? undefined
    : (text: string) => {
        inputActions.setDraft(text)
        inputActions.submit()
      }
  return (
    <div>
      <ToolRow
        t={t}
        variant={model.variant}
        toolName={toolName}
        icon={<IconSparkle16 size={14} />}
        title="Widget"
        summary={widget?.title ?? model.summary}
        body={null}
        output={widget === null ? model.output : undefined}
        errorSummary={model.errorSummary}
        state={model.state}
        inspect={inspect}
      />
      {widget !== null ? <SandboxFrame html={widget.html} title={widget.title} onPrompt={send} /> : null}
    </div>
  )
}

/** Registered under the `render_widget` tool name's keyed toolview hole. */
export const widgetToolview = {
  name: 'widget-toolview',
  inject: ['slots'],
  /**
   * Register the widget row.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', function* () {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'render_widget', locale: NS }, WidgetRow)
    })
  },
}
