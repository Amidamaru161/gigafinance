# @deepseek-ai/dsh-tool-chart

The model-facing `plot_chart` tool: renders one line, bar, scatter, or pie chart per call from model-supplied labels and numeric series. The package owns the tool name, the JSON schema, snake_case argument names, the prompt section, validation, per-chart caps, the model-facing confirmation, and the chart-card presentation projection — `presentCall`, `presentResult` (a `card: 'chart'` result card), and the `output.presentationMeta` that persists the validated chart spec so replay reproduces the card. Drawing happens in a capable UI, never here; the tool is pure computation over its own arguments with no network, filesystem, or shared state.

## Tools

| Tool | Args | Behavior |
|---|---|---|
| `plot_chart` | `chart_type`, `labels?`, `series`, `title?`, `x_label?`, `y_label?` | Validates the data into the canonical chart spec. `chart_type` is `line`, `bar`, `scatter`, or `pie`. `labels` are category names (line/bar), slice labels (pie), or numeric x positions (scatter); required for line/bar/pie, defaulting to `0..n-1` for scatter. Each series aligns its `values` with the labels; pie takes exactly one non-negative series. |

The canonical value IS the chart spec (`{ chart_type, title?, x_label?, y_label?, labels, series }`), so Code Mode receives the validated spec as its programmatic result. A UI without the chart capability falls back to the raw `tool/result` content, which is the one-line confirmation.

## Config

| Key | Default | Meaning |
|---|---|---|
| `maxPoints` | `200` | Upper bound on labels (data points) per chart. |
| `maxSeries` | `8` | Upper bound on series per chart. |
| `maxTextLength` | `256` | Upper bound on title/label characters. |

All three are validated at load and fail loud on misconfiguration. The model-facing schema exposes no caps — they are deployment policy.

```yaml
- id: tool-chart
  name: '@deepseek-ai/dsh-tool-chart'
```

## Model Experience

### System prompt

#### What the model sees

The tool contributes one guidance section:

```markdown
Use the plot_chart tool to visualize data inside the conversation. chart_type: line, bar, scatter, or pie. Provide labels (category names for line/bar, slice labels for pie, numeric x positions for scatter) and one or more series, each with an optional name and numeric values aligned with labels. Pie takes exactly one series with non-negative values. Keep point and series counts small enough for a readable chart.
```

#### Token effect

Fixed guidance cost per request.

#### KV Cache effect

Prefix-stable while the guidance text is unchanged.

### Tool schemas

#### What the model sees

The model sees the generated [`plot_chart` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-chart): the `chart_type` enum, the optional display text, and the `series` item shape.

#### Token effect

Fixed schema cost per request.

#### KV Cache effect

Prefix-stable while the definition is unchanged.

### Tool results

#### What the model sees

`plot_chart` renders one confirmation line: `Rendered a <type> chart "<title>" with N series and M data points.` Failures render `Error: <message>`.

#### Token effect

One short line per successful call; retained until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Argument errors

#### What the model sees

Schema violations become the registry's structured `INVALID_ARGS` error; semantic violations (unknown type, missing labels, misaligned series lengths, non-finite or negative pie values, cap overruns) become `Error: plot_chart: <field> …` messages stating the exact rule.

#### Token effect

Only the failing call adds these retained tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **No animated or interactive charts** — the shipped client renders one static SVG per spec; tooltips, zoom, and pan are deferred UI work the card presentation leaves room for.
- **No raw Vega/Chart.js spec pass-through** — the tool accepts only its validated subset rather than an open third-party spec, so charts stay renderable by every capable UI without importing a rendering library's semantics.
