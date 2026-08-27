# RUNBOOK — US Portfolio Valuation Dashboard

## View locally

```bash
cd /Users/iibot/Documents/ppppp/workspace/us-portfolio-dashboard
python3 -m http.server 8734
# open http://localhost:8734/
```

Playwright MCP blocks `file://` URLs — always serve over http for screenshots.

## Refresh data (after each earnings season, or when prices move a lot)

1. **Prices** — automatic (daily workflow). To force: `node scripts/update-prices.mjs`.
2. **TTM EPS** — for each holding, sum the last 4 reported quarters' diluted GAAP EPS (stockanalysis.com `/financials/?p=quarterly` or the company's press release). TSM: use USD per ADR from the TSMC release.
3. **Forward EPS** — next-fiscal-year consensus from stockanalysis.com `/forecast/` (NVDA: NTM implied from forward P/E). Note the basis in Notes if it changes.
4. **NU + bank peers** — update `bvps` = total equity ÷ shares outstanding for NU and for JPM/BAC/WFC/GS (book value per share is in each bank's quarterly release).
5. **Indices** — S&P trailing: multpl.com; S&P forward: latest FactSet Earnings Insight PDF; Nasdaq-100: worldperatio.com + historyofmarket.com. Update `bench` and `sp500` in data.json (values + context strings).
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
- **Daily job**: Actions workflow "Daily price update" — cron `30 14 * * *` UTC (18:30 Dubai). Runs `node scripts/update-prices.mjs`, commits `data.json` if changed, Pages redeploys within ~1–2 min.
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

- **2026-08-27 (v4)** — Sema's picks from the improvement list: (#2) EPS growth + PEG columns — growth = Zacks "Exp EPS Growth (3-5yr)" (Yahoo no longer publishes a 5-yr row), Simply Wall St where Zacks is NA (MU, VST, CRCL, IREN); (#3) "Versus its own history" card — quarterly trailing P/E 2021–2026 from macrotrends, loss quarters and P/E > 100× excluded, NU on P/B history; per-row normalized bands, red dot = outside range; rows sorted by position in range. CRCL/SNDK/TEM show "Insufficient history". Research provenance in `data/research-growth-hist-{1,2,3}.json`.
- **2026-08-27 (v3)** — Published to GitHub Pages at Sema's request. Data moved to `data.json`; index.html now fetches it. Added `scripts/update-prices.mjs` (Yahoo Finance; must NOT send a browser UA — 429) and the daily 18:30 Dubai Actions workflow. First run refreshed 25/25 prices.

- **2026-08-27 (v2)** — Sema's feedback: replaced GICS sector means with peer groups (Mag 7 for megacaps; HOOD+IBKR for COIN; V+MA for CRCL; JPM/BAC/WFC/GS P/B for NU), split the chart into separate trailing and forward charts, added a "Peer groups" panel showing each member's multiple. Peer companies live in the `PEERS` array — refresh them alongside holdings (step 2–4 apply to them too).
- **2026-08-27** — Initial build. 15 holdings, Q2 2026 data. Research via 4 parallel agents (indices/sectors, semis, fintech/energy, megacaps). IREN FY2026 results pending (due same evening).
