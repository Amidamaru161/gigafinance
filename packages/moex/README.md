# moex/ — Moscow Exchange (MOEX) data family

English | [中文](README.zh.md)

This family provides model-facing tools over the public Moscow Exchange ISS JSON API (`iss.moex.com`). It reads only public, subscription-free endpoints.

| Package | Role | ctx key |
|---|---|---|
| [`tool-moex/`](tool-moex/README.md) | Exposes MOEX securities, security profile, candles, and market data to the model | registers on `ctx.tools` |

Dividends, financial statements, and credit ratings are MOEX CCI (corporate information) endpoints gated behind a paid subscription; they are documented as deferred in the package README rather than exposed as always-failing tools.
