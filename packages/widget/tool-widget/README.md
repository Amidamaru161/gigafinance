# @deepseek-ai/dsh-tool-widget

Model-facing `render_widget` tool. The model passes `{ title, html }`; the tool
validates and caps it (errors return to the model so it retries) and declares a
`card: 'widget'` result view. The web UI (`ui-tool`) draws it in a sandboxed
iframe: `sandbox="allow-scripts"` without `allow-same-origin`, a CSP with no
network except script CDNs, theme via CSS variables, auto-resize and
`window.sendPrompt()` over `postMessage`.

Charts are drawn with this tool too (inline SVG or canvas); the standard
preset no longer mounts `plot_chart`.
