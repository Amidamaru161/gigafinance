// @vitest-environment jsdom
// The chart render intent on the UI side: the pure chartCardModel derivation
// over resultView, and the conversation render sites that consume it — the
// keyed ChartRow (registered under plot_chart), the GenericToolCard render-site
// fallback, and the details panel's Output section. Mirrors web-card spec:
// model derivation + null arms, the chat row's collapsed-by-default ToolRow
// card, the panel arm, and the keyed registration.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import {
  createSnapshotStore, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, RunningToolCall, SessionId, SessionListState, ToolResultNode, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { SelectionTarget } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { chartCardModel } from '../src/client/tool/models/chart-card-model.ts'
import { createChatStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stores.ts'
import { GenericToolCard } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { DetailsPanel } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/DetailsPanel.tsx'
import { ChartRow, chartToolview } from '../src/client/tool/toolviews/chart-row.tsx'
import { renderToolDetails, SessionProviderStub, toolChatSnapshot } from './tool-details-render.client.tsx'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(cleanup)

const SID = 's1' as SessionId

/** Locale seat for the card render sites (GenericToolCard, DetailsPanel), as the sibling suites build it. */
const t = makeTranslate(zh, commonZh)

const CHART_ARGS = '{"chart_type":"line","title":"Monthly sales","labels":["Jan","Feb"],"series":[{"name":"Cats","values":[1,2]}]}'

/** A chart result view; overrides tune the spec. */
type ChartResult = Extract<ToolResultView, { card: 'chart' }>

const resultChart = (over?: Partial<ChartResult>): ChartResult => ({
  card: 'chart',
  spec: {
    chart_type: 'line',
    title: 'Monthly sales',
    x_label: 'Month',
    labels: ['Jan', 'Feb'],
    series: [{ name: 'Cats', values: [1, 2] }],
  },
  ...over,
})

const runningChart = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'plot_chart', argsRaw: CHART_ARGS,
  turn: 1, step: 1, time: 1_000, callView: { card: 'generic', title: 'Chart: Monthly sales' }, subCalls: [], ...over,
})

const settledChart = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'plot_chart', argsRaw: CHART_ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'Rendered a line chart' }], isError: false,
  callView: { card: 'generic', title: 'Chart: Monthly sales' }, resultView: resultChart(), subCalls: [], ...over,
})

describe('chartCardModel', () => {
  it('derives a line chart card from the result view, projecting the spec fields', () => {
    expect(chartCardModel(settledChart())).toEqual({
      chart_type: 'line',
      title: 'Monthly sales',
      x_label: 'Month',
      labels: ['Jan', 'Feb'],
      series: [{ name: 'Cats', values: [1, 2] }],
    })
  })

  it('carries every chart type through', () => {
    for (const chart_type of ['bar', 'scatter', 'pie'] as const) {
      const model = chartCardModel(settledChart({ resultView: resultChart({ spec: { chart_type, labels: ['a'], series: [{ values: [1] }] } }) }))
      expect(model?.chart_type).toBe(chart_type)
    }
  })

  it('returns null for a running call, since the chart card is result-only', () => {
    expect(chartCardModel(runningChart())).toBeNull()
    expect(chartCardModel(runningChart({ callView: null }))).toBeNull()
  })

  it('returns null for a settled call whose result view is not a chart card', () => {
    expect(chartCardModel(settledChart({ resultView: null }))).toBeNull()
    expect(chartCardModel(settledChart({ resultView: { card: 'generic' } }))).toBeNull()
    // A card tag this UI version does not know arrives over the wire.
    const future = { card: 'venn' } as unknown as ToolResultView
    expect(chartCardModel(settledChart({ resultView: future }))).toBeNull()
  })

  it('returns null for a chart card whose spec does not guard', () => {
    const malformed = (spec: unknown) => settledChart({ resultView: { card: 'chart', spec } as unknown as ToolResultView })
    expect(chartCardModel(malformed(null))).toBeNull()
    expect(chartCardModel(malformed({ ...resultChart().spec, chart_type: 'donut' }))).toBeNull()
    expect(chartCardModel(malformed({ ...resultChart().spec, labels: [] }))).toBeNull()
    expect(chartCardModel(malformed({ ...resultChart().spec, series: [{ values: [1] }] }))).toBeNull()
    expect(chartCardModel(malformed({ ...resultChart().spec, series: [{ values: ['x', 2] }] }))).toBeNull()
    // The tool's spec is undefined on an error result, so the generic path wins.
    expect(chartCardModel(settledChart({ isError: true, resultView: { card: 'generic' } }))).toBeNull()
  })
})

describe('chat row chart body', () => {
  const ownerProps = (block: RunningToolCall | ToolResultNode, toolName: string): ToolCallOwnerProps => ({
    callId: block.callId, toolName, block, openFile: vi.fn(),
  })
  const rowProps = (block: RunningToolCall | ToolResultNode, toolName: string): Parameters<typeof ChartRow>[0] =>
    ({ ...ownerProps(block, toolName), t } as unknown as Parameters<typeof ChartRow>[0])

  const toggleRow = (view: { container: HTMLElement }) => {
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
  }

  it('the ChartRow collapses to the summary row, expanding to the full plot', () => {
    const view = render(<ChartRow {...rowProps(settledChart(), 'plot_chart')} />)
    expect(view.getByText('Chart')).toBeTruthy()
    expect(view.container.querySelector('[data-chart]')).toBeNull()
    toggleRow(view)
    expect(view.container.querySelector('[data-chart="line"]')).not.toBeNull()
    expect(view.getByText('Monthly sales')).toBeTruthy()
  })

  it('a running chart call is the summary row alone, with nothing to expand', () => {
    const view = render(<ChartRow {...rowProps(runningChart(), 'plot_chart')} />)
    expect(view.getByText('Chart')).toBeTruthy()
    expect(view.container.querySelector('[data-expandable]')).toBeNull()
    expect(view.container.querySelector('[data-chart]')).toBeNull()
  })

  it('a failed chart call keeps the summary row without the card', () => {
    const view = render(<ChartRow {...rowProps(settledChart({
      isError: true, resultView: { card: 'generic' },
    }), 'plot_chart')} />)
    expect(view.getByText('Chart')).toBeTruthy()
    expect(view.container.querySelector('[data-chart]')).toBeNull()
    expect(view.container.querySelector('[data-state="error"]')).not.toBeNull()
  })

  it('the GenericToolCard fallback also expands to a chart card for a chart-declaring tool', () => {
    const view = render(<GenericToolCard {...ownerProps(settledChart({
      call: { name: 'plot_chart', argsRaw: CHART_ARGS },
    }), 'plot_chart')} t={t} />)
    expect(view.container.querySelector('[data-chart]')).toBeNull()
    toggleRow(view)
    expect(view.container.querySelector('[data-chart="line"]')).not.toBeNull()
  })
})

describe('DetailsPanel chart Output section', () => {
  function mount(snapshot: ConversationSnapshot, selection: SelectionTarget | null) {
    localStorage.clear()
    const chat = createChatStore().create()
    if (selection !== null) chat.actions.select(selection)
    const sessions = createSnapshotStore<SessionListState>({
      ids: [], byId: {}, current: undefined, phase: 'ready',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    })
    const workspaces = createSnapshotStore<WorkspaceListState>({
      items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      baselinesReady: true, recentWorkspaceId: undefined,
    })
    return render(
      <DetailsPanel
        SessionProvider={SessionProviderStub}
        renderSlot={renderToolDetails(t)}
        sessionId={SID}
        useSession={bindSnapshotSelector({ getSnapshot: () => snapshot, subscribe: () => () => {} })}
        useSessions={bindSnapshotSelector(sessions)}
        useWorkspaces={bindSnapshotSelector(workspaces)}
        useInput={(() => { throw new Error('unused') })}
        inputActions={{
          setDraft: () => {},
          addImages: () => true,
          removeImage: () => {},
          pruneImages: () => {},
          submit: () => {},
        }}
        useProjection={(() => undefined)}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeDetails={vi.fn()}
        t={t}
      />,
    )
  }

  function snapshot(over: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
    const nodes = over.nodes ?? []
    const runningCalls = over.runningCalls ?? []
    return {
      sessionId: SID, views: EMPTY_CONVERSATION_VIEWS,
      chat: over.chat ?? toolChatSnapshot(nodes, runningCalls),
      nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
      pending: [], queue: [], running: false, composerPhase: 'active', removed: false,
      openState: 'open', openError: null, hasMore: false, loadingOlder: false,
      promptError: null, blank: false, subagent: null, lastAgentError: null, ...over,
    }
  }

  it('renders the chart card at full spec allowance', () => {
    const view = mount(snapshot({ nodes: [settledChart()] }), { turnSeq: 10, callId: 'c1', toolName: 'plot_chart' })
    expect(view.container.querySelector('[data-chart="line"]')).not.toBeNull()
    // The Input JSON section survives beside it.
    expect(view.getByText(/"chart_type"/)).toBeTruthy()
  })

  it('keeps the model-facing confirmation text below the card', () => {
    const view = mount(snapshot({ nodes: [settledChart()] }), { turnSeq: 10, callId: 'c1', toolName: 'plot_chart' })
    const output = view.getByText('输出').closest('section')
    expect(output?.querySelector('pre')?.textContent).toContain('Rendered a line chart')
  })

  it('a non-chart result keeps the flattened pre form', () => {
    const view = mount(snapshot({
      nodes: [settledChart({ callView: null, resultView: null })],
    }), { turnSeq: 10, callId: 'c1', toolName: 'plot_chart' })
    expect(view.container.querySelector('[data-chart]')).toBeNull()
    const output = view.getByText('输出').closest('section')
    expect(output?.querySelector('pre')?.textContent).toContain('Rendered a line chart')
  })
})

describe('chart toolview registration', () => {
  it('registers one ChartRow under plot_chart', () => {
    const registered: { key: string; locale: unknown; component: unknown }[] = []
    const ctx = {
      slots: {
        inject: (_name: string, callback: () => Iterable<() => void>) => {
          for (const _dispose of callback()) { /* exhaust transactional setup */ }
          return () => undefined
        },
        register: (options: { name: string; key: string; locale?: string }, component: unknown) => {
          registered.push({ key: options.key, locale: options.locale, component })
          return () => {}
        },
      },
    } as unknown as import('@deepseek-ai/cordis').Context
    chartToolview.apply(ctx)
    expect(registered.map(r => r.key)).toEqual(['plot_chart'])
    expect(registered.map(r => r.locale)).toEqual(['conversation'])
    expect(registered[0]?.component).toBe(ChartRow)
    expect(chartToolview.inject).toEqual(['slots'])
  })
})
