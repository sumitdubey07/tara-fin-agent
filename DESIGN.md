# Design Document — Tara Finance Agent

## Schema

### transactions
Stores all spending rows. Key column: `canonical_merchant` (normalized merchant name computed at ingest).
Indexes on: date, category, merchant.

### funds
One row per mutual fund (id, name, category).

### fund_nav
NAV history — one row per (fund_id, date). Primary key is both columns.

### holdings
What the user owns: units, purchase_date, purchase_nav. Links to funds via fund_id.

## Tools

Two tools handle all questions:

**query_transactions** — all spending questions. Parameters: category, merchant_search, date range, aggregate type (total/by_month/by_category/top_merchants/recurring).

**query_funds** — all investment questions. Mode parameter: period_return, all_funds_return, holding_return, portfolio_value, list_funds.

## Formulas

**Spend:** `SUM(amount) WHERE category != 'transfer'`

**Net spend (after refunds):** `SUM(amount)` includes negatives

**Merchant normalization:** uppercase → strip *ORDER, *BOOKING, city names, .COM → first 2 tokens

**Fund period return:** `(nav_end - nav_start) / nav_start * 100`

**Holding realised return:** `(units * current_nav - units * purchase_nav) / (units * purchase_nav) * 100`

## Grounding
Every number comes from a tool query. System prompt explicitly forbids stating figures not from tools.

## Observability
Each request logs: request_id, question, tool name, inputs, latency, status.

## Deployment
Render.com + Render Postgres. DATABASE_URL env var switches between local and production automatically.

## Known Failure Modes
1. Groq rate limits on free tier — handled with retry logic
2. Cold start on Render free tier (~30s)
3. Merchant normalization is heuristic — unknown alias patterns may not match
4. Data only covers Jan 2024 to Mar 2025