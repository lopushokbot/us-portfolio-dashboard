# RUNBOOK — US Portfolio Valuation Dashboard

## View locally

```bash
cd /Users/iibot/Documents/ppppp/workspace/us-portfolio-dashboard
python3 -m http.server 8734
# open http://localhost:8734/
```

Playwright MCP blocks `file://` URLs — always serve over http for screenshots.

## Refresh data (after each earnings season, or when prices move a lot)

1. **Prices** — take Sema's broker screenshot (or fetch quotes) and update `price` in the `STOCKS` array.
2. **TTM EPS** — for each holding, sum the last 4 reported quarters' diluted GAAP EPS (stockanalysis.com `/financials/?p=quarterly` or the company's press release). TSM: use USD per ADR from the TSMC release.
3. **Forward EPS** — next-fiscal-year consensus from stockanalysis.com `/forecast/` (NVDA: NTM implied from forward P/E). Note the basis in Notes if it changes.
4. **NU** — update `bvps` = total equity ÷ shares outstanding; `secPb` from Damodaran industry table (Jan release).
5. **Indices** — S&P trailing: multpl.com; S&P forward: latest FactSet Earnings Insight PDF; Nasdaq-100: worldperatio.com + historyofmarket.com. Update `BENCH` values and context strings.
6. **Sector means** — worldperatio.com/sp-500-sectors/ (trailing); sector-ETF forward P/E (Alaric mid-year review or FactSet). Update `SECTORS`.
7. Update `ASOF`, the hero `<strong>` date, the footer date, the Notes list (drop stale one-offs, add new), and the methodology dates.
8. Add/remove holdings by editing `STOCKS` (add `fn: [n]` for any footnote; `metric: "pb"` for banks).
9. Serve locally, screenshot light + dark + 390px mobile, check: no N/M where a number is expected, chart labels don't collide, table sorts.
10. Update CLAUDE.md status line + this file's log.

Research JSON snapshots from each pass go in `data/` for provenance.

## Deploy (only after Sema's OK)

```bash
cd /Users/iibot/Documents/ppppp/workspace/us-portfolio-dashboard
git init && git add -A && git commit -m "US portfolio valuation dashboard"
gh repo create lopushokbot/us-portfolio-dashboard --public --source=. --push
# then enable GitHub Pages from main / root in repo settings
```

Add sitemap.xml + robots.txt before the first deploy (SEO checklist in root CLAUDE.md).

## Log

- **2026-08-27 (v2)** — Sema's feedback: replaced GICS sector means with peer groups (Mag 7 for megacaps; HOOD+IBKR for COIN; V+MA for CRCL; JPM/BAC/WFC/GS P/B for NU), split the chart into separate trailing and forward charts, added a "Peer groups" panel showing each member's multiple. Peer companies live in the `PEERS` array — refresh them alongside holdings (step 2–4 apply to them too).
- **2026-08-27** — Initial build. 15 holdings, Q2 2026 data. Research via 4 parallel agents (indices/sectors, semis, fintech/energy, megacaps). IREN FY2026 results pending (due same evening).
