# US Portfolio Valuation Dashboard

Apple-style static dashboard showing trailing and forward P/E for Sema's 15 US stock holdings versus hand-picked peer groups, plus S&P 500 and Nasdaq-100 benchmarks. Static page + data.json, no build step. **Fully automatic since 2026-10-20**: prices, per-company earnings (GAAP TTM, NTM consensus, report dates) and bottom-up index/sector multiples all refresh once a day before 08:00 Dubai.

## Status

- **Built**: 2026-08-27 · data as of 2026-08-27 (all holdings had reported Q2 2026 / equivalent fiscal quarter)
- **Deployed 2026-08-27** (Sema's request): GitHub `lopushokbot/us-portfolio-dashboard` (public) · **Live: https://lopushokbot.github.io/us-portfolio-dashboard/**
- **Auto-update (v6)**: GitHub Actions `.github/workflows/update.yml` runs once a day at 03:37 UTC ≈ 07:37 Dubai (Sema chose 08:00 on 2026-10-20; moved off the top of the hour 2026-10-29 because GitHub delayed it 5–6 h; after the US close, so prices are the previous session's close): `update-prices.mjs` → `update-fundamentals.mjs` → `update-indices.mjs`, commits `data.json` + `data/fiscal-years.json`, Pages redeploys. A new earnings report is in the numbers by the next morning (SEC 8-K release parse — no wait for Yahoo). Manual only: growth rates (Zacks/SWS), history bands, curated one-off notes.
- **v4 (2026-08-27)**: EPS growth + PEG columns and an own-history band card added (see Methodology). Growth sources: Zacks 3-5yr where available, else Simply Wall St.
- **v5 (2026-10-20, Sema's request)**: index tiles show the index level behind each P/E (live level, implied EPS, level + P/E on source date); every multiple in the table shows the EPS/BV it divides into; chart + peer tooltips show price ÷ EPS. Removed loss-makers TEM, COIN, IREN (and the now-unused HOOD/IBKR peers, Financials/Health Care sectors). Added XOM (Energy), NKE (Consumer Discretionary), UBER (Industrials) with Oct 20 earnings data.
- **v6 (2026-10-20, Sema: "forget August, use the most recent data, refresh after each report")**: see Methodology. Validated: bottom-up S&P 500 forward 19.1× vs FactSet 19.0× (Oct 16), trailing 26.0× vs FactSet 26.0× / multpl 26.2×; Industrials 22.3× vs FactSet 22.6×.
- **v7 (2026-10-29, Sema: "why wasn't it updated with GOOG/MSFT?")**: Yahoo's quarterly EPS lags a report by 1–3 days, so GOOG/MSFT (reported Oct 28 after close) were still on the June quarter. Added SEC EDGAR as primary GAAP EPS source: 10-Q/10-K XBRL quarters + same-day 8-K earnings-release parse (exhibit 99.1, accepted only when the row's other figure matches the prior-year quarter). Validated: GS release parse 17.01 = Yahoo 17.01; all other TTMs unchanged. Cron moved to 03:37 UTC (GitHub was starting the `0 4` job 5–6 h late).
- **v7.1 (2026-10-29, Sema: "take overnight trading price into consideration for all stocks, especially after earnings")**: stocks + peers now price at the latest trade of ANY session — regular, after-hours, overnight (Blue Ocean, 8pm–4am ET), pre-market — via Yahoo quote (`overnightPrice=true` returns overnight fields but drops post-market ones, so both variants are fetched; `yahooLastTrades` in lib.mjs). `stocks[].close` = regular close, `session` + `sessionTime` = source of `price`. Table shows "overnight −10.0%" under the price (≥3% moves coloured). Indices stay on the official close. update-fundamentals no longer overwrites `price`.
- **Open items**: Sema's remaining improvement ideas not yet built: portfolio-weighted P/E (needs weights), EV/Sales for loss-makers, peers for the sector-benchmarked names, history snapshots, Telegram alerts.

## Files

```
us-portfolio-dashboard/
├── index.html          — the dashboard (CSS + JS); fetches data.json on load and derives every ratio client-side
├── data.json           — ALL data: meta (as-of stamps), indices, stocks, peers, groups
├── scripts/lib.mjs      — shared helpers: Yahoo session (cookie+crumb), batch quotes, quoteSummary, quarterly EPS timeseries, SEC EDGAR quarterly EPS (XBRL + 8-K release parse) + merge, Nasdaq report dates + Nasdaq-100 list, S&P 500 list (Wikipedia → datahub fallback), NTM blend
├── scripts/update-prices.mjs — Yahoo chart-API close for stocks, peers and indices (^GSPC, ^NDX via `yahoo` field; Node's default UA only — a browser UA gets 429), then stocks + peers switched to the latest extended-hours trade (after-hours / overnight / pre-market) via the crumb quote API
├── scripts/update-fundamentals.mjs — per holding + peer: ttmEps, fwdEps (NTM), bvps, `earnings{lastQuarter,lastReported,next,nextConfirmed,adjTtm,gaapQuarters,fy0,fy1,…}`
├── scripts/update-indices.mjs — bottom-up S&P 500 / Nasdaq-100 / GICS sector P/E from ~518 constituents (~1 min; first run ~1 min more for the fiscal-year cache)
├── data/fiscal-years.json — cache: each constituent's current-FY end date (for the NTM blend); auto-refreshed after year end
├── .github/workflows/update.yml — daily 03:37 UTC (~07:37 Dubai) cron + workflow_dispatch; commits data.json + data/fiscal-years.json
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

- **Trailing P/E** = price ÷ sum of last 4 reported quarters' diluted GAAP EPS (SEC EDGAR as filed — 10-Q/10-K XBRL `EarningsPerShareDiluted`, or the 8-K earnings release on report day — with Yahoo fundamentals-timeseries `quarterlyDilutedEPS` filling quarters EDGAR lacks and replacing Q4s EDGAR only has as FY − 9M (wrong when share count moves, e.g. CRCL post-IPO); each quarter's `src` is stored in `gaapQuarters`; must be 4 consecutive quarters ending at `mostRecentQuarter`, else Yahoo quote `epsTrailingTwelveMonths`; non-USD reporters like TSM always use the quote field, which is per-ADR USD). Yahoo's quote TTM is sometimes wrong (OXY 3.52 vs true 6.46) — the quarterly sum wins.
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
- Price fields (`price`, `close`, `session`, `sessionTime`) are overwritten daily by the workflow; `price` is the latest trade of any session, never only the regular close
- Repo is public (required for free GitHub Pages) — Sema accepted this when asking to publish
- Update this file and RUNBOOK.md after any refresh
