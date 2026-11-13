/**
 * Host half of the broker-report attachment: the web composer uploads a parsed
 * portfolio summary for one session, and this plugin injects it into that
 * session's next model request as plugin-sourced context (a "Context
 * injection" row), so the report never becomes chat text. Root-level plugin:
 * it owns one HTTP route and one in-memory store for the whole Host.
 * @module @deepseek-ai/dsh-tool-broker-report/context
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Cordis plugin name; also the context source shown in the chat. */
export const name = 'portfolio-context'

/** Services required: the HTTP carrier. Agent events arrive on the root context. */
export const inject = ['webServer']

/** Route the composer button talks to. */
export const PORTFOLIO_CONTEXT_PATH = '/portfolio/context'

const MAX_BODY_BYTES = 200_000
const MAX_FILE_NAME = 200
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/

interface Attachment {
  fileName: string
  text: string
  /** False until the summary has entered the session as context. */
  injected: boolean
}

/** Loopback Host + same-origin only (mirrors the /api browser-trust fence). */
function isTrusted(req: IncomingMessage): boolean {
  const host = req.headers.host
  if (host === undefined) return false
  const hostname = host.replace(/:\d+$/, '')
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Register the route and the pre-step injection.
 * @param ctx - root Host context.
 */
export function apply(ctx: Context): void {
  const store = new Map<string, Attachment>()

  const view = (sessionId: string) => {
    const entry = store.get(sessionId)
    return entry === undefined ? { attached: false } : { attached: true, fileName: entry.fileName, injected: entry.injected }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PORTFOLIO_CONTEXT_PATH,
    handler: (req, res) => {
      void (async () => {
        if (!isTrusted(req)) return send(res, 403, { error: 'forbidden' })
        const sessionId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('sessionId') ?? ''
        if (!SESSION_ID.test(sessionId)) return send(res, 400, { error: 'bad sessionId' })
        if (req.method === 'GET') return send(res, 200, view(sessionId))
        if (req.method === 'DELETE') {
          // Only a not-yet-injected attachment can be withdrawn; injected context is session history.
          if (store.get(sessionId)?.injected === false) store.delete(sessionId)
          return send(res, 200, view(sessionId))
        }
        if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
        if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'json only' })
        const body = await readJson(req) as { fileName?: unknown; text?: unknown }
        if (typeof body.text !== 'string' || body.text.trim() === '' || typeof body.fileName !== 'string') {
          return send(res, 400, { error: 'fileName and text are required' })
        }
        store.set(sessionId, { fileName: body.fileName.slice(0, MAX_FILE_NAME), text: body.text, injected: false })
        return send(res, 200, view(sessionId))
      })().catch((error: unknown) => {
        if (!res.headersSent) send(res, 400, { error: error instanceof Error ? error.message : 'bad request' })
        else res.destroy()
      })
    },
  }), 'portfolio-context: /portfolio/context route')

  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const entry = store.get(String(agent.session.id))
    if (entry === undefined || entry.injected) return decision
    entry.injected = true
    const text = `The user attached a broker report "${entry.fileName}" as context. It was parsed into this portfolio; `
      + 'treat it as the user\'s current portfolio and use it when they ask about their holdings.\n\n'
      + entry.text
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
        }),
      ],
    }
  }, { prepend: true })
}
