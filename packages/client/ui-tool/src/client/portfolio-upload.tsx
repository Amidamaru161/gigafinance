// Composer control: attach a broker HTML report to the session as context.
// The file is parsed in the browser with the shared dependency-free parser;
// only the compact portfolio summary goes to the Host (POST /portfolio/context),
// which injects it into the session's next model request as a "Context
// injection" row. Nothing is written into the draft or the chat text.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { IconChartBarOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatReportSummary, parseBrokerReport } from '@deepseek-ai/dsh-tool-broker-report/parser'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Reports above this size are not broker reports. */
const MAX_FILE_BYTES = 20 * 1024 * 1024
const ENDPOINT = '/portfolio/context'

/** Decode report bytes: UTF-8, falling back to Windows-1251 for older exports. */
export function decodeReport(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  const broken = (utf8.match(/�/g) ?? []).length
  if (broken > 20 && broken > utf8.length / 1000) return new TextDecoder('windows-1251').decode(bytes)
  return utf8
}

/** Attachment state as the Host reports it. */
interface AttachmentView {
  attached: boolean
  fileName?: string
  /** True once the summary has entered the session as context. */
  injected?: boolean
}

async function call(sessionId: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<AttachmentView> {
  const response = await fetch(`${ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`, {
    method,
    ...body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  })
  if (!response.ok) throw new Error(`Не удалось прикрепить отчёт (HTTP ${response.status}).`)
  return await response.json() as AttachmentView
}

interface UploadProps {
  sessionId?: string
  input?: { draft: string; phase: string }
}

const chipStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 8px',
  borderRadius: 8, border: 0, fontSize: 12, background: 'transparent',
} as const

/** Composer control: pick a broker report and attach it to the session as context. */
export function PortfolioUploadButton({ sessionId, input }: UploadProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<AttachmentView>({ attached: false })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    if (sessionId === undefined) return
    call(sessionId, 'GET').then(setView).catch(() => {})
  }, [sessionId])

  // Initial state, and again after each send (the Host marks the attachment injected).
  const idle = input?.phase === 'plain' && input.draft === ''
  useEffect(() => {
    refresh()
    if (!idle) return
    const timer = setTimeout(refresh, 1500)
    return () => clearTimeout(timer)
  }, [refresh, idle])

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined || sessionId === undefined) return
    setError(null)
    if (file.size > MAX_FILE_BYTES) {
      setError('Файл слишком большой для отчёта брокера.')
      return
    }
    setBusy(true)
    try {
      const report = parseBrokerReport(decodeReport(await file.arrayBuffer()))
      setView(await call(sessionId, 'POST', { fileName: file.name, text: formatReportSummary(report, 5) }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const detach = () => {
    if (sessionId === undefined) return
    call(sessionId, 'DELETE').then(setView).catch(() => {})
  }

  const tip = error
    ?? (!view.attached
      ? 'Прикрепить отчёт брокера (HTML) как контекст'
      : view.injected === true
        ? `«${view.fileName ?? ''}» уже в контексте сессии. Нажмите, чтобы заменить отчёт.`
        : `«${view.fileName ?? ''}» прикреплён и уйдёт модели со следующим сообщением. Нажмите, чтобы заменить.`)

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <Tooltip label={tip} side="top" maxWidth={320}>
        <button
          type="button"
          aria-label={view.attached ? `Отчёт брокера прикреплён: ${view.fileName ?? ''}` : 'Прикрепить отчёт брокера'}
          disabled={busy || sessionId === undefined}
          onClick={() => fileRef.current?.click()}
          style={{
            ...chipStyle,
            cursor: 'pointer',
            maxWidth: 220,
            ...view.attached ? { background: 'var(--dsw-alias-interactive-bg-active)' } : {},
            color: error !== null
              ? 'var(--dsw-alias-state-error-primary, #dc2626)'
              : view.attached ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
          }}
        >
          <IconChartBarOutline16 size={14} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {busy ? 'Читаю…' : view.attached ? `${view.fileName ?? 'Отчёт'}${view.injected === true ? ' · в контексте' : ''}` : 'Портфель'}
          </span>
        </button>
      </Tooltip>
      {view.attached && view.injected !== true
        ? (
            <button
              type="button"
              aria-label="Открепить отчёт брокера"
              onClick={detach}
              style={{ ...chipStyle, padding: '0 6px', cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)' }}
            >
              ✕
            </button>
          )
        : null}
      <input ref={fileRef} type="file" accept=".html,.htm,text/html" hidden onChange={event => void onFile(event)} />
    </span>
  )
}

/** Registers the control in the composer's left tool row. */
export const portfolioUpload = {
  name: 'portfolio-upload',
  inject: ['slots'],
  /**
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
      name: 'conversation.input.left',
      id: 'portfolio-upload',
      order: 50,
    }, PortfolioUploadButton))
  },
}
