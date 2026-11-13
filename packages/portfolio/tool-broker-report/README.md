# @deepseek-ai/dsh-tool-broker-report

`parse_broker_report` tool: reads a Sberbank broker HTML report ("Отчет брокера") from the session workspace and returns the portfolio — positions (quantity, price, market value, accrued interest, FIFO average buy price, first buy date), cash, net deposits, trades — plus ready-made `analyzeArgs` for the moex-finance `analyze_user_portfolio` tool (shares and ETFs) and the held bond ISINs.

The parser (`@deepseek-ai/dsh-tool-broker-report/parser`) is pure string processing with no imports, so the web upload button (`ui-tool`) parses the same way in the browser. The investor's name is never extracted.
