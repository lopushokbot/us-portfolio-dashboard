# US Portfolio Valuation Dashboard

Apple-style static dashboard showing trailing and forward P/E for Sema's 15 US stock holdings versus hand-picked peer groups, plus S&P 500 and Nasdaq-100 benchmarks. Static page + data.json, no build step. **Fully automatic since 2026-10-20**: prices, per-company earnings (GAAP TTM, NTM consensus, report dates) and bottom-up index/sector multiples all refresh twice a day.

## Status

- **Built**: 2026-08-27 · data as of 2026-08-27 (all holdings had reported Q2 2026 / equivalent fiscal quarter)
- **Deployed 2026-08-27** (Sema's request): GitHub `lopushokbot/us-portfolio-dashboard` (public) · **Live: https://lopushokbot.github.io/us-portfolio-dashboard/**
- **Auto-update (v6)**: GitHub Actions `.github/workflows/update.yml` runs at 14:30 UTC (18:30 Dubai, market open) and 02:00 UTC (06:00 Dubai, after the close): `update-prices.mjs` → `update-fundamentals.mjs` → `update-indices.mjs`, commits `data.json` + `data/fiscal-years.json`, Pages redeploys. A new earnings report is in the numbers within hours. Manual only: growth rates (Zacks/SWS), history bands, curated one-off notes.
- **v4 (2026-08-27)**: EPS growth + PEG columns and an own-history band card added (see Methodology). Growth sources: Zacks 3-5yr where available, else Simply Wall St.
- **v5 (2026-10-20, Sema's request)**: index tiles show the index level behind each P/E (live level, implied EPS, level + P/E on source date); every multiple in the table shows the EPS/BV it divides into; chart + peer tooltips show price ÷ EPS. Removed loss-makers TEM, COIN, IREN (and the now-unused HOOD/IBKR peers, Financials/Health Care sectors). Added XOM (Energy), NKE (Consumer Discretionary), UBER (Industrials) with Oct 20 earnings data.
- **v6 (2026-10-20, Sema: "forget August, use the most recent data, refresh after each report")**: see Methodology. Validated: bottom-up S&P 500 forward 19.1× vs FactSet 19.0× (Oct 16), trailing 26.0× vs FactSet 26.0× / multpl 26.2×; Industrials 22.3× vs FactSet 22.6×.
- **Open items**: Sema's remaining improvement ideas not yet built: portfolio-weighted P/E (needs weights), EV/Sales for loss-makers, peers for the sector-benchmarked names, auto-refresh of EPS, history snapshots, Telegram alerts.

## Files

```
us-portfolio-dashboard/
├── index.html          — the dashboard (CSS + JS); fetches data.json on load and derives every ratio client-side
├── data.json           — ALL data: meta (as-of stamps), indices, stocks, peers, groups
├── scripts/lib.mjs      — shared helpers: Yahoo session (cookie+crumb), batch quotes, quoteSummary, quarterly EPS timeseries, Nasdaq report dates + Nasdaq-100 list, S&P 500 list (Wikipedia → datahub fallback), NTM blend
├── scripts/update-prices.mjs — Yahoo chart-API price refresh for stocks, peers and indices (^GSPC, ^NDX via `yahoo` field). Node's default UA only (a browser UA gets 429)
├── scripts/update-fundamentals.mjs — per holding + peer: ttmEps, fwdEps (NTM), bvps, `earnings{lastQuarter,lastReported,next,nextConfirmed,adjTtm,gaapQuarters,fy0,fy1,…}`
├── scripts/update-indices.mjs — bottom-up S&P 500 / Nasdaq-100 / GICS sector P/E from ~518 constituents (~1 min; first run ~1 min more for the fiscal-year cache)
├── data/fiscal-years.json — cache: each constituent's current-FY end date (for the NTM blend); auto-refreshed after year end
├── .github/workflows/update.yml — daily 14:30 UTC cron + workflow_dispatch; commits data.json
├── assets/fonts/       — New York Large (4 weights) + InterVariable, bundled
├── data/research-*.json — provenance snapshots (2026-08-27 pass; xom-nke-uber + growth on 2026-10-20)
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

- **Trailing P/E** = price ÷ sum of last 4 reported quarters' diluted GAAP EPS (Yahoo fundamentals-timeseries `quarterlyDilutedEPS`; must be 4 consecutive quarters ending at `mostRecentQuarter`, else Yahoo quote `epsTrailingTwelveMonths`; non-USD reporters like TSM always use the quote field, which is per-ADR USD). Yahoo's quote TTM is sometimes wrong (OXY 3.52 vs true 6.46) — the quarterly sum wins.
- **Forward P/E** = price ÷ next-twelve-months consensus EPS = f·FY0 + (1−f)·FY1, f = share of current fiscal year remaining (Yahoo earningsTrend 0y/+1y with endDate). Same basis as FactSet's index forward P/E.
- **Hidden rule (Sema, 2026-10-20)**: holdings with negative trailing or forward EPS are hidden automatically (listed under the table + in Notes) and reappear when earnings turn positive. Banks (P/B) exempt.
- **One-off notes**: curated notes live in `data.json → notes[]` tagged with the affected quarter-end month (`qtr: "2026-06"`); each is shown only while that quarter is inside the stock's TTM window. Plus an automatic flag when GAAP TTM differs >25% from the company-adjusted TTM (sum of Nasdaq's adjusted quarterly EPS). Footnote numbers are assigned at render time.
- **P/B (banks)** = price ÷ book value per share (equity ÷ shares) from the latest quarter.
- **Peer groups (Sema's choice, 2026-08-27)** — benchmark = **median** of members' own multiples (TSLA at ~320× trailing makes a Mag 7 mean useless; the mean is still shown in the Peer groups panel), computed live from the `PEERS` + `STOCKS` data:
  - Mag 7 (AAPL, MSFT, GOOG, AMZN, META, NVDA, TSLA) → for NVDA, GOOG, AMZN, MSFT, META
  - V + MA → CRCL (payment networks)
  - JPM + BAC + WFC + GS on P/B → NU
  - Remaining holdings use S&P 500 GICS sector aggregates (bottom-up, auto): Info Tech (MU, SNDK, TSM), Utilities (VST), Energy (OXY, XOM), Consumer Discretionary (NKE), Industrials (UBER — GICS Passenger Ground Transportation). All 11 sectors are computed into `meta.sectorsAll`; add a `groups.secX` entry (keys in update-indices.mjs) to use another.
- Sema explicitly did NOT want GICS sector means for the megacaps (MSFT/NVDA in IT vs GOOG/META in Comm Services gave inconsistent benchmarks) nor for CRCL.
- Charts: two separate simple bar charts (trailing, forward), not one combined — Sema found the combined version too busy.
- **Indices (bottom-up since 2026-10-20)**: Σ market cap ÷ Σ earnings over all constituents, company earnings = mcap × EPS ÷ price (share classes deduped by company name; ADR currency rescaled via Yahoo's own P/E). Loss-makers included (index-provider convention); `exLoss` variant also stored and shown. Stored as `indices[].trailing/forward {pe, level, date, n, coverage, losers, exLoss}`; if a run fails or coverage <95%/90% the previous values stay and the tile re-prices the implied EPS at today's level. Nasdaq-100 trailing runs well above published QQQ-based figures (worldperatio ~27×) because SpaceX, MSTR, INTC etc. carry big losses — ex-loss ≈ 28.5×.
- **EPS growth / PEG (added 2026-08-27, Sema's request)**: `growth: {pct, basis, source}` per stock in data.json — MANUAL (Zacks blocks plain fetch; refreshed 2026-10-20 via headless Chrome; UBER uses Simply Wall St 14.7%, Zacks 3.66% is distorted). `basis` = "lt" (consensus 3–5 yr EPS CAGR — Yahoo "Next 5 years", Zacks, stockanalysis) or "fy" (fallback: next-FY ÷ current-FY consensus − 1, shown with †). PEG = forward P/E ÷ growth%; N/M if growth ≤ 0 or forward N/M; banks "—".
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
