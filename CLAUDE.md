# US Portfolio Valuation Dashboard

Apple-style static dashboard showing trailing and forward P/E for Sema's 15 US stock holdings versus hand-picked peer groups, plus S&P 500 and Nasdaq-100 benchmarks. Static page + data.json, no build step; prices auto-refresh daily.

## Status

- **Built**: 2026-08-27 · data as of 2026-08-27 (all holdings had reported Q2 2026 / equivalent fiscal quarter)
- **Deployed 2026-08-27** (Sema's request): GitHub `lopushokbot/us-portfolio-dashboard` (public) · **Live: https://lopushokbot.github.io/us-portfolio-dashboard/**
- **Auto-update**: GitHub Actions `.github/workflows/update.yml` runs `scripts/update-prices.mjs` daily at 14:30 UTC = 18:30 Dubai, commits `data.json`, Pages redeploys. Prices only — EPS/consensus/index/sector multiples are manual (quarterly).
- **v4 (2026-08-27)**: EPS growth + PEG columns and an own-history band card added (see Methodology). Growth sources: Zacks 3-5yr where available, else Simply Wall St.
- **v5 (2026-10-20, Sema's request)**: index tiles show the index level behind each P/E (live level, implied EPS, level + P/E on source date); every multiple in the table shows the EPS/BV it divides into; chart + peer tooltips show price ÷ EPS. Removed loss-makers TEM, COIN, IREN (and the now-unused HOOD/IBKR peers, Financials/Health Care sectors). Added XOM (Energy), NKE (Consumer Discretionary), UBER (Industrials) with Oct 20 earnings data.
- **Open items**: Q3 2026 earnings season under way — full EPS refresh due (XOM Oct 30, UBER Nov 4). Sema's remaining improvement ideas not yet built: portfolio-weighted P/E (needs weights), EV/Sales for loss-makers, peers for the sector-benchmarked names, auto-refresh of EPS, history snapshots, Telegram alerts.

## Files

```
us-portfolio-dashboard/
├── index.html          — the dashboard (CSS + JS); fetches data.json on load and derives every ratio client-side
├── data.json           — ALL data: meta (as-of stamps), indices, stocks, peers, groups
├── scripts/update-prices.mjs — Yahoo Finance price refresh for stocks, peers and indices (^GSPC, ^NDX via `yahoo` field) (Node 20, no deps). Do NOT send a browser User-Agent (Yahoo 429s it)
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
- Sections: hero → 4 benchmark tiles (live P/E + index today / implied EPS / index + P/E on source date) → trailing + forward bar charts (peer median tick, S&P 500 live dashed reference, tooltips with price ÷ EPS) → own-history bands → sortable holdings table (EPS/BV under each multiple) → peer groups → numbered notes → methodology & sources
- Bank rows (NU) use P/B with a badge, benchmarked to US bank P/B, not P/E

## Methodology (fixed — keep consistent on refresh)

- **Trailing P/E** = price ÷ sum of last 4 reported quarters' diluted GAAP EPS. Negative EPS → N/M.
- **Forward P/E** = price ÷ next-fiscal-year consensus EPS (FY/CY2027). Exception: NVDA uses NTM consensus (its FY ends January). Negative consensus → N/M.
- **P/B (banks)** = price ÷ book value per share (equity ÷ shares) from the latest quarter.
- **Peer groups (Sema's choice, 2026-08-27)** — benchmark = **median** of members' own multiples (TSLA at ~320× trailing makes a Mag 7 mean useless; the mean is still shown in the Peer groups panel), computed live from the `PEERS` + `STOCKS` data:
  - Mag 7 (AAPL, MSFT, GOOG, AMZN, META, NVDA, TSLA) → for NVDA, GOOG, AMZN, MSFT, META
  - V + MA → CRCL (payment networks)
  - JPM + BAC + WFC + GS on P/B → NU
  - Remaining holdings use S&P 500 GICS sector means: Info Tech (MU, SNDK, TSM), Utilities (VST), Energy (OXY, XOM), Consumer Discretionary (NKE), Industrials (UBER — GICS Passenger Ground Transportation).
- Sema explicitly did NOT want GICS sector means for the megacaps (MSFT/NVDA in IT vs GOOG/META in Comm Services gave inconsistent benchmarks) nor for CRCL.
- Charts: two separate simple bar charts (trailing, forward), not one combined — Sema found the combined version too busy.
- **Indices**: S&P 500 trailing GAAP (multpl.com), forward (FactSet Earnings Insight); Nasdaq-100 trailing (WorldPERatio), forward NTM consensus. Each sourced P/E is stored with the index `level` and `date` it was quoted at (`indices[].trailing/forward`); implied EPS = level ÷ P/E is held fixed and the tile shows today's level ÷ that EPS (same live method as stocks). The S&P chart reference line uses the live value.
- **EPS growth / PEG (added 2026-08-27, Sema's request)**: `growth: {pct, basis, source}` per stock in data.json. `basis` = "lt" (consensus 3–5 yr EPS CAGR — Yahoo "Next 5 years", Zacks, stockanalysis) or "fy" (fallback: next-FY ÷ current-FY consensus − 1, shown with †). PEG = forward P/E ÷ growth%; N/M if growth ≤ 0 or forward N/M; banks "—".
- **Own-history band (added 2026-08-27)**: `hist: {min, median, max, quarters, excluded, from, to, source, note}` per stock — quarterly trailing P/E over 5 yrs (macrotrends quarterly table; loss quarters excluded; NU uses P/B history). Rendered as a per-row normalized band (each row scaled to its own low→high) so outliers don't flatten the others. <4 usable quarters → "Insufficient history". Refresh yearly.
- Flag one-offs in the Notes section (e.g. GOOG/AMZN Q2'26 Anthropic-stake gains inflate TTM; META Q3'25 tax charge depresses it).

## Holdings

NVDA, NU, CRCL, VST, MU, SNDK, TSM, GOOG, AMZN, MSFT, META, OXY (broker screenshot 2026-08-27) + XOM, NKE, UBER (added 2026-10-20). TEM, COIN, IREN removed 2026-10-20 at Sema's request (negative earnings → P/E not computable).

- Rule from Sema: only list holdings whose P/E can be computed — drop names with negative trailing or forward earnings.
- NKE forward = FY2027 consensus (FYE May 2027 — current fiscal year; FY2028 ~1.56). UBER growth uses Simply Wall St 14.7% (Zacks 3.66% distorted by the 2025 tax-release base).

## Rules

- All data lives in `data.json` — edit there, never hardcode numbers into index.html
- Price fields are overwritten daily by the workflow; everything else in data.json is manual
- Repo is public (required for free GitHub Pages) — Sema accepted this when asking to publish
- Update this file and RUNBOOK.md after any refresh
