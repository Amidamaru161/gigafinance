# @deepseek-ai/dsh-tool-moex

English | [中文](README.zh.md)

The model-facing Moscow Exchange (MOEX) tool suite — `moex_securities`, `moex_security`, `moex_candles`, and `moex_marketdata` — over the public MOEX ISS JSON API. It owns tool names, JSON schemas, snake_case argument names, prompt sections, result caps, row mapping, and result formatting; a shared `MoexClient` owns the HTTP transport, timeout fusion, JSON parsing, and error translation. Requests carry no cookies or ambient credentials and read only public, subscription-free endpoints.

Each tool is registered independently; a product that wants a subset disables the rest via config (`{ securities: false }`, `{ candles: false }`, …). All four opt into concurrent scheduling because provider reads return content without mutating parent-agent state.

## Tools

| Tool | Args | Behavior |
|---|---|---|
| `moex_securities` | `query?`, `limit?` | Discovery. With `query`, searches securities by ticker, name, or ISIN and returns issuer identity; without `query`, lists the main-board (`TQBR`) shares. Capped by `maxSecurities`. |
| `moex_security` | `secid` | Reference profile: name, ISIN, instrument type/group, issue size, face value, listing level, issuer id, and primary-board metadata. |
| `moex_candles` | `secid`, `interval?`, `from?`, `till?` | Historical OHLCV candles. `interval` is one of `1`/`10`/`60` minutes, `24` day (default), `7` week, `31` month, `4` quarter. Capped to the newest `maxCandles`. |
| `moex_marketdata` | `secid` | Current main-board snapshot: last price, open/high/low, previous close, change and change %, session volume/turnover, trades, capitalization, and exchange update time. |

MOEX numeric cells are locale-formatted (comma decimal separators, `"1"`/`"0"` booleans, empty-string nulls); the package normalizes them to JSON numbers/booleans and omits absent fields. Results are the canonical tool values; Native renderers preserve a readable summary below.

## Config

| Key | Default | Meaning |
|---|---|---|
| `baseUrl` | `https://iss.moex.com/iss` | ISS base URL (validated as absolute http(s) at load). |
| `timeoutMs` | `30000` | Cooperative tool-call timeout budget (ms), attached as `ToolDefinition.timeoutMs` and fused as the client backstop. |
| `userAgent` | `deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)` | `User-Agent` header sent on every request. |
| `securities` | `true` | Register `moex_securities`. |
| `security` | `true` | Register `moex_security`. |
| `candles` | `true` | Register `moex_candles`. |
| `marketdata` | `true` | Register `moex_marketdata`. |
| `maxSecurities` | `25` | Upper bound on securities returned by one `moex_securities` call (1-100). |
| `maxCandles` | `100` | Upper bound on candles returned by one `moex_candles` call (1-1000, newest kept). |

The model-facing schemas expose no timeout — `timeoutMs` is deployment policy. `baseUrl`, `timeoutMs`, `maxSecurities`, and `maxCandles` are validated at load and fail loud on misconfiguration.

```yaml
- id: tool-moex
  name: '@deepseek-ai/dsh-tool-moex'
```

## Stable registration

Tool registration follows product **enablement**, not backend availability. A tool stays visible even when the exchange is unreachable; execution fails with a structured `MoexError` (`MOEX_HTTP_ERROR`, `MOEX_TIMEOUT`, `MOEX_BAD_RESPONSE`, …) that `ToolRuntime.execute()` turns into an error tool result the model can read. This keeps the model schema stable without making network state part of the model-facing contract. To remove a MOEX tool entirely, disable it here in config.

## Model Experience

### System prompt

#### What the model sees

Each config-enabled tool contributes its guidance section below, in registration order.

##### moex_securities guidance

```markdown
Use the moex_securities tool to find companies and securities listed on Moscow Exchange (MOEX) by ticker, name, or ISIN, or to list the main-board shares when you need a broad view. It returns each security's SECID, name, ISIN, instrument type, and (for searched securities) issuer identity.
```

##### moex_security guidance

```markdown
Use the moex_security tool to read the reference profile of one MOEX security by its SECID (for example one returned by moex_securities). It reports the name, ISIN, instrument type, issue size, face value, listing level, and primary-board metadata.
```

##### moex_candles guidance

```markdown
Use the moex_candles tool to read historical OHLCV candles for one MOEX security by its SECID. Intervals: 1, 10, 60 (minutes), 24 (day, default), 7 (week), 31 (month), 4 (quarter). Set from/till (YYYY-MM-DD) for a specific range; otherwise the newest candles are returned.
```

##### moex_marketdata guidance

```markdown
Use the moex_marketdata tool to read the current market snapshot of one MOEX security by its SECID: last price, open/high/low, previous close, change and change %, session volume and turnover, capitalization, and the exchange update time.
```

#### Token effect

Fixed guidance cost per request for each config-enabled tool.

#### KV Cache effect

Prefix-stable while enabled tools and guidance text are unchanged. Config enablement or plugin lifecycle may invalidate reuse from the first changed prompt section.

### Tool schemas

#### What the model sees

The model sees the generated [`moex_securities`, `moex_security`, `moex_candles`, and `moex_marketdata` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-moex). Timeout and result caps are deployment settings, not model arguments; `moex_candles` declares its `interval` enum to the model.

#### Token effect

Fixed schema cost per request; config disablement removes both schema and guidance.

#### KV Cache effect

Prefix-stable while definitions and visibility are unchanged. Config enablement or plugin lifecycle may invalidate reuse from the first changed schema token.

### Tool results

#### What the model sees

`moex_securities` renders `MOEX securities matching "<query>"` (or `MOEX TQBR shares` in list mode) followed by `- SECID — name · …` lines built from present fields, and a truncation note when capped. `moex_security` renders `Field: value` lines plus a `Primary board:` block. `moex_candles` renders a summary line and a `Begin | Open | High | Low | Close | Volume | Value` markdown table. `moex_marketdata` renders `Field: value` lines. Failures render `Error: <message>`.

#### Token effect

Data-dependent results are resent until compaction; `maxSecurities` and `maxCandles` bound returned rows.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Argument errors

#### What the model sees

Blank `secid`/`query` and out-of-range `limit`/`interval`/dates become exactly `Error: <field> must be …` messages listing the accepted values.

#### Token effect

Only the failing call adds these retained tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Dividends and financial statements require a MOEX subscription** — the ISS `cci` corporate-information endpoints (`/iss/cci/corp-actions/dividends`, `/iss/cci/accounting/*`, `/iss/cci/info-nsd/*`) return a subscribers-only page, so this package exposes only the public, subscription-free surface. A subscription-backed provider or a free third-party source is deferred work; the tool registry makes adding such tools independent of the current four.
- **No SSRF guard on `baseUrl`** — `baseUrl` is deployment configuration; do not point it at a host that can reach sensitive internal targets. The package follows the anonymous-fetch posture of `@deepseek-ai/dsh-web-fetch-http` and does not add private-network protection.
- **The model-facing API is minimal by design** — `limit` caps rows client-side rather than driving ISS pagination, and candles return the newest `maxCandles` rows rather than exposing cursor/`start` parameters.
