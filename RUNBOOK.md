# RUNBOOK — US Portfolio Valuation Dashboard

## View locally

```bash
cd /Users/iibot/Documents/ppppp/workspace/us-portfolio-dashboard
python3 -m http.server 8734
# open http://localhost:8734/
```

Playwright MCP blocks `file://` URLs — always serve over http for screenshots.

## Automatic (no action needed)

Prices, EPS (TTM + NTM), book values, report dates, index and sector multiples all refresh once a day at ~07:37 Dubai (03:37 UTC) via GitHub Actions. To run locally: `node scripts/update-prices.mjs && node scripts/update-fundamentals.mjs && node scripts/update-indices.mjs`.

SEC EDGAR gotchas: User-Agent `us-portfolio-dashboard admin@lopushokbot.dev` (SEC requires name + contact; never a personal email); ≤10 req/s (150 ms spacing in lib). IFRS filers (NU, TSM) and V (no plain `EarningsPerShareDiluted` tag) fall back to Yahoo. If a report is missing the morning after: `node scripts/update-fundamentals.mjs` prints `<T>: <month> quarter from SEC 8-K/10-Q` when EDGAR filled it; if not, check the 8-K has item 2.02 and an EX-99.1 exhibit.

Yahoo gotchas: chart API = Node default UA; crumb/quote/quoteSummary = exactly `Mozilla/5.0` UA (others 429). Nasdaq API = full browser UA. Never put a personal email in any request header.

## Manual refresh (the parts that are NOT automatic)

- **Growth (PEG)** — every few months: Zacks "Exp EPS Growth (3-5yr)" per holding via headless Chrome (`/Users/iibot/airbnb-pricing-watch/node_modules/playwright-core` + system Chrome), Simply Wall St where NA. Save to `data/research-growth-<date>.json`, copy into `stocks[].growth`.
- **One-off notes** — after a holding reports, if the Notes show an automatic "one-off items" flag, research it and replace with a curated note in `data.json → notes[]` (`t`, `qtr` = quarter-end month of the affected quarter, `title`, `text`). Curated notes expire on their own when the quarter leaves the TTM window.
- **History bands** — yearly (step 6c below).
- **New holding** — add `{t, name, price, group, growth, hist}` to `stocks` (group key must exist in `groups`); the next run fills EPS and dates.

## Legacy manual refresh steps (pre-2026-10-20, kept for reference)

1. **Prices** — automatic (daily workflow). To force: `node scripts/update-prices.mjs`.
2. **TTM EPS** — for each holding, sum the last 4 reported quarters' diluted GAAP EPS (stockanalysis.com `/financials/?p=quarterly` or the company's press release). TSM: use USD per ADR from the TSMC release.
3. **Forward EPS** — next-fiscal-year consensus from stockanalysis.com `/forecast/` (NVDA: NTM implied from forward P/E). Note the basis in Notes if it changes.
4. **NU + bank peers** — update `bvps` = total equity ÷ shares outstanding for NU and for JPM/BAC/WFC/GS (book value per share is in each bank's quarterly release).
5. **Indices** — S&P trailing: multpl.com; S&P forward: latest FactSet Earnings Insight PDF (its prices are the prior-day close); Nasdaq-100: worldperatio.com + historyofmarket.com. Update `indices[].trailing/forward` in data.json: `pe`, `date` (the close the P/E was quoted at), `level` (index close on that date — `node` + Yahoo chart API `^GSPC`/`^NDX` `range=3mo`), `source`, `context`. Never set `level` to today's price unless the P/E is from today.
6. **Sector means** — worldperatio.com/sp-500-sectors/ (trailing); sector-ETF forward P/E (Alaric mid-year review or FactSet). Update the `sec*` entries in `groups` in data.json.
6b. **Growth (for PEG)** — per holding, consensus long-term EPS growth (Yahoo analysis "Next 5 Years (per annum)" / Zacks "Exp EPS Growth 3-5yr"); set `growth.pct`, `growth.basis` ("lt" or "fy"), `growth.source`. Refresh with the EPS pass.
6c. **History bands** — once a year: quarterly trailing P/E from macrotrends `…/pe-ratio` quarterly table, drop loss quarters, set `hist.min/median/max/quarters/excluded/from/to`. NU: price-book page.
7. Update `meta.earningsAsOf` in data.json, the Notes list in index.html (drop stale one-offs, add new), and the methodology dates.
8. Add/remove holdings by editing `stocks` in data.json (add `"fn": [n]` for any footnote; `"metric": "pb"` + `bvps` for banks; `group` must match a key in `groups`). Peer companies go in `peers`.
9. Serve locally, screenshot light + dark + 390px mobile, check: no N/M where a number is expected, chart labels don't collide, table sorts.
10. Update CLAUDE.md status line + this file's log.

Research JSON snapshots from each pass go in `data/` for provenance.

## Live site & automation

- **Live**: https://lopushokbot.github.io/us-portfolio-dashboard/ (GitHub Pages, branch `main`, root)
- **Daily job**: Actions workflow "Daily price + earnings update" — cron slots 03:37 / 05:11 / 07:43 UTC; the first one GitHub actually starts refreshes, later ones skip (guard step). GitHub may start them hours late or drop them — if the page is stale, run it now (below). Runs update-prices → update-fundamentals → update-indices, commits `data.json` + `data/fiscal-years.json` if changed, Pages redeploys within ~1–2 min.
- **Run it now**: `gh workflow run update.yml -R lopushokbot/us-portfolio-dashboard` then `gh run list -R lopushokbot/us-portfolio-dashboard -L 3`
- **Check health**: `gh run list -R lopushokbot/us-portfolio-dashboard -w "Daily price update" -L 5` — a failed run means Yahoo blocked every ticker (script exits 1 only when 0/25 succeed). Partial failures keep the old price and show a "Stale price for: …" warning in the page header.
- **Local test**: `node scripts/update-prices.mjs` (writes data.json; commit + push to publish)

## Deploy changes manually

```bash
cd /Users/iibot/Documents/ppppp/workspace/us-portfolio-dashboard
git pull --rebase   # the bot commits daily — always pull first
# edit data.json / index.html
git add -A && git commit -m "…" && git push
```

## Log

- **2026-10-30 (v7.2)** — Sema: "why didn't it update again?" GitHub never started the scheduled run on Oct 29 or Oct 30 (best-effort cron; the Oct 29 slot was probably dropped by the cron edit that day). Fix: three cron slots (03:37, 05:11, 07:43 UTC) with a guard step — a scheduled run exits early once `meta.pricesAsOfISO` is today (Dubai); `workflow_dispatch` always refreshes. Also fixed the 8-K parse for 52/53-week fiscal years ending early in a month (SNDK quarter ended 2026-10-03 was missed): new quarter = year-ago quarter + 1 year. Picked up AMZN Q3 $1.89 (8-K), SNDK Q1 FY27 $52.60 (8-K, TTM 72.90 → 124.75), MA Q3. A Mac LaunchAgent that dispatches the workflow at 07:30 Dubai was proposed but needs Sema's OK (blocked by the permission system as persistence).

- **2026-10-29 (v7.1)** — Sema: use overnight trading prices for all stocks, especially after earnings (GOOG ~$291 after hours vs $321.89 close). `update-prices.mjs` now sets each stock/peer `price` to the latest trade across regular/post/overnight/pre sessions (`yahooLastTrades`), keeps `close`, records `session`/`sessionTime`; page shows the session + % vs close under each price. GOOG → $289.81 overnight: 15.1× trailing / 19.8× forward (was 16.8× / 22.0×); MSFT $552.85 (+4.1%): 28.9× / 26.2×.

- **2026-10-29 (v7)** — Sema asked why GOOG/MSFT weren't updated. Cause: both reported Oct 28 after the US close (after that day's run), and Yahoo's quarterly EPS lags reports by 1–3 days, so even the next run would have missed them. Fix: SEC EDGAR as primary GAAP EPS source (`secQuarterlyEps`, `mergeQuarters` in lib.mjs) incl. same-day 8-K release parse; lastQuarter/lastReported follow EDGAR when it is ahead of Nasdaq; stale Yahoo next-dates (≤ last report) roll +91 days as estimates; adjusted-TTM flag only when Nasdaq and GAAP quarters align. Result: GOOG TTM 19.91 → 19.16 (Q3 $2.12 incl. −$0.55 equity-securities loss; note updated), MSFT 17.96 → 19.16 (Q1 FY27 $4.92, clean). Cron moved to `37 3 * * *`.

- **2026-10-20 (v6.1)** — Sema: one update a day at 08:00 Dubai instead of twice daily. Cron now `0 4 * * *` UTC; page copy updated.

- **2026-10-20 (v6)** — Sema: index P/E from today's data, most recent company earnings, auto-refresh after every report. Added `scripts/lib.mjs`, `update-fundamentals.mjs`, `update-indices.mjs`; workflow now 2×/day (14:30 + 02:00 UTC). Forward basis switched from next-FY to NTM blend for all. Index + sector multiples bottom-up (S&P 500 26.0×/19.1×, NDX 32.7×/22.2× on Oct 20; FactSet 26.0×/19.0×). New UI: Next-report column, Earnings calendar card, data-driven notes (quarter-tagged curated + automatic GAAP-vs-adjusted flags), auto-hide negative-earnings holdings, sector rows in Peer groups. Growth refreshed (NVDA Zacks now 14% vs 58% in Aug). First GitHub run 39398443898 succeeded (25/25 prices, 23/23 earnings, 100% index coverage).

- **2026-10-20 (v5)** — Sema: (1) show index prices behind index P/E → tiles now show index today, implied EPS, index level + P/E on source date; tile value = today's level ÷ implied EPS; `bench`/`sp500` replaced by `indices`, price script also refreshes ^GSPC/^NDX. (2) show prices behind each P/E → EPS/BV printed under every multiple, price ÷ EPS in chart and peer tooltips. (3) removed TEM, COIN, IREN (negative earnings) + HOOD/IBKR peers + secFin/secHC groups. (4) added XOM, NKE, UBER (research in `data/research-xom-nke-uber.json`; new groups secCD 25.82/24.01, secInd 28.18/26.76). Footnotes renumbered (1–12). Also fixed the "24:06" midnight stamp (hourCycle h23).

- **2026-08-27 (v4)** — Sema's picks from the improvement list: (#2) EPS growth + PEG columns — growth = Zacks "Exp EPS Growth (3-5yr)" (Yahoo no longer publishes a 5-yr row), Simply Wall St where Zacks is NA (MU, VST, CRCL, IREN); (#3) "Versus its own history" card — quarterly trailing P/E 2021–2026 from macrotrends, loss quarters and P/E > 100× excluded, NU on P/B history; per-row normalized bands, red dot = outside range; rows sorted by position in range. CRCL/SNDK/TEM show "Insufficient history". Research provenance in `data/research-growth-hist-{1,2,3}.json`.
- **2026-08-27 (v3)** — Published to GitHub Pages at Sema's request. Data moved to `data.json`; index.html now fetches it. Added `scripts/update-prices.mjs` (Yahoo Finance; must NOT send a browser UA — 429) and the daily 18:30 Dubai Actions workflow. First run refreshed 25/25 prices.

- **2026-08-27 (v2)** — Sema's feedback: replaced GICS sector means with peer groups (Mag 7 for megacaps; HOOD+IBKR for COIN; V+MA for CRCL; JPM/BAC/WFC/GS P/B for NU), split the chart into separate trailing and forward charts, added a "Peer groups" panel showing each member's multiple. Peer companies live in the `PEERS` array — refresh them alongside holdings (step 2–4 apply to them too).
- **2026-08-27** — Initial build. 15 holdings, Q2 2026 data. Research via 4 parallel agents (indices/sectors, semis, fintech/energy, megacaps). IREN FY2026 results pending (due same evening).
