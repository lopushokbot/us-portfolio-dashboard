# US Portfolio Valuation Dashboard

Apple-style static dashboard showing trailing and forward P/E for Sema's 15 US stock holdings versus sector means, plus S&P 500 and Nasdaq-100 benchmarks. Single self-contained page, no build step.

## Status

- **Built**: 2026-08-27 · data as of 2026-08-27 (all holdings had reported Q2 2026 / equivalent fiscal quarter)
- **Deploy**: local only — Sema has not yet approved publishing (portfolio composition is personal)
- **Open items**: IREN FY2026 results were due 2026-08-27 after close — refresh its TTM EPS

## Files

```
us-portfolio-dashboard/
├── index.html          — the whole dashboard (CSS + JS + DATA block inline)
├── assets/fonts/       — New York Large (4 weights) + InterVariable, bundled
├── data/research-*.json — provenance snapshots from the 2026-08-27 research pass
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

- All data lives in the `DATA` block at the top of the `<script>` in index.html — edit there, never hardcode into markup
- Don't publish without Sema's explicit OK
- Update this file and RUNBOOK.md after any refresh
