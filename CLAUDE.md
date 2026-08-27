# US Portfolio Valuation Dashboard

Apple-style static dashboard showing trailing and forward P/E for Sema's 15 US stock holdings versus hand-picked peer groups, plus S&P 500 and Nasdaq-100 benchmarks. Static page + data.json, no build step; prices auto-refresh daily.

## Status

- **Built**: 2026-08-27 · data as of 2026-08-27 (all holdings had reported Q2 2026 / equivalent fiscal quarter)
- **Deployed 2026-08-27** (Sema's request): GitHub `lopushokbot/us-portfolio-dashboard` (public) · **Live: https://lopushokbot.github.io/us-portfolio-dashboard/**
- **Auto-update**: GitHub Actions `.github/workflows/update.yml` runs `scripts/update-prices.mjs` daily at 14:30 UTC = 18:30 Dubai, commits `data.json`, Pages redeploys. Prices only — EPS/consensus/index/sector multiples are manual (quarterly).
- **Open items**: IREN FY2026 results were due 2026-08-27 after close — refresh its TTM EPS

## Files

```
us-portfolio-dashboard/
├── index.html          — the dashboard (CSS + JS); fetches data.json on load and derives every ratio client-side
├── data.json           — ALL data: meta (as-of stamps), bench, sp500, stocks, peers, groups
├── scripts/update-prices.mjs — Yahoo Finance price refresh (Node 20, no deps). Do NOT send a browser User-Agent (Yahoo 429s it)
├── .github/workflows/update.yml — daily 14:30 UTC cron + workflow_dispatch; commits data.json
├── assets/fonts/       — New York Large (4 weights) + InterVariable, bundled
├── data/research-*.json — provenance snapshots from the 2026-08-27 research pass
├── robots.txt, sitemap.xml
├── CLAUDE.md
└── RUNBOOK.md
```

## Design

- New York for headings, Inter for body/numbers (tabular-nums in table)
- Light: page #f5f5f7, cards white, accent #0071e3. Dark: true black, cards #1c1c1e, accent #2997ff. Both validated with the dataviz palette script.
- Sections: hero → 4 benchmark stat tiles → forward P/E bar chart (sector mean tick per bar, S&P 500 forward dashed reference, hover tooltips) → sortable holdings table → numbered notes → methodology & sources
- Bank rows (NU) use P/B with a badge, benchmarked to US bank P/B, not P/E

## Methodology (fixed — keep consistent on refresh)

- **Trailing P/E** = price ÷ sum of last 4 reported quarters' diluted GAAP EPS. Negative EPS → N/M.
- **Forward P/E** = price ÷ next-fiscal-year consensus EPS (FY/CY2027). Exception: NVDA uses NTM consensus (its FY ends January). Negative consensus → N/M.
- **P/B (banks)** = price ÷ book value per share (equity ÷ shares) from the latest quarter.
- **Peer groups (Sema's choice, 2026-08-27)** — benchmark = **median** of members' own multiples (TSLA at ~320× trailing makes a Mag 7 mean useless; the mean is still shown in the Peer groups panel), computed live from the `PEERS` + `STOCKS` data:
  - Mag 7 (AAPL, MSFT, GOOG, AMZN, META, NVDA, TSLA) → for NVDA, GOOG, AMZN, MSFT, META
  - HOOD + IBKR → COIN (exchange/brokerage)
  - V + MA → CRCL (payment networks)
  - JPM + BAC + WFC + GS on P/B → NU
  - Remaining holdings use S&P 500 GICS sector means: Info Tech (MU, SNDK, TSM), Utilities (VST), Energy (OXY), Health Care (TEM), Financials (IREN — GICS puts crypto miners there; no clean peer set).
- Sema explicitly did NOT want GICS sector means for the megacaps (MSFT/NVDA in IT vs GOOG/META in Comm Services gave inconsistent benchmarks) nor for COIN/CRCL.
- Charts: two separate simple bar charts (trailing, forward), not one combined — Sema found the combined version too busy.
- **Indices**: S&P 500 trailing GAAP (multpl.com), forward (FactSet Earnings Insight); Nasdaq-100 trailing (WorldPERatio), forward NTM consensus.
- Flag one-offs in the Notes section (e.g. GOOG/AMZN Q2'26 Anthropic-stake gains inflate TTM; META Q3'25 tax charge depresses it).

## Holdings (from Sema's broker screenshot, 2026-08-27)

NVDA, NU, IREN, CRCL, TEM, VST, COIN, MU, SNDK, TSM, GOOG, AMZN, MSFT, META, OXY

## Rules

- All data lives in `data.json` — edit there, never hardcode numbers into index.html
- Price fields are overwritten daily by the workflow; everything else in data.json is manual
- Repo is public (required for free GitHub Pages) — Sema accepted this when asking to publish
- Update this file and RUNBOOK.md after any refresh
