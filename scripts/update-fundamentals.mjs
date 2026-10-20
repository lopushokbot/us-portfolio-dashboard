#!/usr/bin/env node
/**
 * Earnings refresh for every holding + peer (runs with the daily price job, so a new report
 * is picked up within hours of the company publishing it).
 *
 *   ttmEps   = trailing-twelve-month diluted GAAP EPS = sum of the last 4 reported quarters (Yahoo fundamentals timeseries);
 *              falls back to Yahoo's quote-level epsTrailingTwelveMonths when the quarters are incomplete or not in USD (TSM)
 *   fwdEps   = next-twelve-months consensus EPS: time-weighted blend of current-FY and next-FY consensus (Yahoo earningsTrend)
 *   bvps     = book value per share (banks, P/B)
 *   earnings = { lastQuarter, lastReported, next, nextConfirmed, adjTtm, quarters[] } — report dates from Nasdaq,
 *              next date from Yahoo calendarEvents. adjTtm = sum of the last 4 quarters' adjusted (non-GAAP) EPS,
 *              used to flag one-off items automatically.
 *
 * Any ticker that fails keeps its previous values; the script never wipes data.
 */
import { DATA_PATH, readJson, writeJson, yahooQuotes, yahooSummary, yahooQuarterlyEps, ttmFromQuarters, nasdaqReports, ntmEps, isoDay, sleep } from "./lib.mjs";

const now = new Date();
const today = isoDay(now);
const r4 = v => v == null || !isFinite(v) ? null : Math.round(v * 10000) / 10000;
const r2 = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;
const fromTs = s => s ? isoDay(s * 1000) : null;

const data = await readJson(DATA_PATH);
const rows = [...data.stocks, ...data.peers];
const quotes = await yahooQuotes(rows.map(r => r.t));
const log = [], newReports = [], failed = [];

for (const row of rows) {
  const t = row.t, q = quotes[t];
  try {
    if (!q) throw new Error("no quote");
    const s = await yahooSummary(t, ["earningsTrend", "calendarEvents", "defaultKeyStatistics"]);
    const trend = s.earningsTrend?.trend || [];
    const y0 = trend.find(x => x.period === "0y"), y1 = trend.find(x => x.period === "+1y");
    const p = q.regularMarketPrice;

    /* EPS can come in the reporting currency for ADRs — rescale with Yahoo's own P/E if price ÷ EPS disagrees */
    let scale = 1;
    const ref = q.forwardPE > 0 && q.epsForward > 0 ? [q.forwardPE, q.epsForward] : q.trailingPE > 0 && q.epsTrailingTwelveMonths > 0 ? [q.trailingPE, q.epsTrailingTwelveMonths] : null;
    if (ref) { const k = (p / ref[0]) / ref[1]; if (Math.abs(k - 1) > 0.05) scale = k; }

    const mrq = s.defaultKeyStatistics?.mostRecentQuarter?.fmt || null;
    let ttm = q.epsTrailingTwelveMonths != null ? q.epsTrailingTwelveMonths * scale : null, ttmBasis = "yahoo-quote", gaapQuarters = null;
    if ((q.financialCurrency || "USD") === "USD") {
      try {
        const sum = ttmFromQuarters(await yahooQuarterlyEps(t), mrq);
        if (sum) {
          if (ttm != null && Math.abs(sum.ttm - ttm) > 0.1 * Math.abs(sum.ttm)) log.push(`${t}: quarterly sum ${sum.ttm.toFixed(2)} vs quote TTM ${ttm.toFixed(2)} — using the quarterly sum`);
          ttm = sum.ttm; ttmBasis = "4 reported quarters";
          gaapQuarters = sum.quarters.map(x => ({ end: x.end, eps: r2(x.eps) }));
        }
      } catch (e) { log.push(`${t}: quarterly EPS unavailable (${e.message}) — using quote TTM`); }
    }
    const fy0 = y0?.earningsEstimate?.avg?.raw ?? q.epsCurrentYear, fy1 = y1?.earningsEstimate?.avg?.raw ?? q.epsForward;
    const ntm = ntmEps(fy0 != null ? fy0 * scale : null, fy1 != null ? fy1 * scale : null, y0?.endDate, now);

    /* report dates */
    let reports = [];
    try { reports = await nasdaqReports(t); } catch (e) { log.push(`${t}: Nasdaq report dates unavailable (${e.message})`); }
    const nextTs = s.calendarEvents?.earnings?.earningsDate?.map(d => d.raw).filter(Boolean).sort()[0];
    const next = nextTs ? fromTs(nextTs) : null;

    const prev = row.earnings || {};
    const lastQuarter = reports[0]?.qtr || prev.lastQuarter || null;
    const earnings = {
      lastQuarter,
      lastQuarterEnd: mrq || prev.lastQuarterEnd || null,
      lastReported: reports[0]?.reported || prev.lastReported || null,
      next: next && next >= today ? next : (next || null),
      nextConfirmed: s.calendarEvents?.earnings?.isEarningsDateEstimate === false,
      adjTtm: reports.length >= 4 ? r2(reports.slice(0, 4).reduce((a, x) => a + x.eps, 0) * scale) : prev.adjTtm ?? null,
      ttmBasis, gaapQuarters: gaapQuarters || prev.gaapQuarters || null,
      quarters: reports.length ? reports.slice(0, 4).map(x => ({ qtr: x.qtr, reported: x.reported, adjEps: r2(x.eps * scale) })) : prev.quarters || [],
      fy0: r4(fy0 != null ? fy0 * scale : null), fy0End: y0?.endDate || null,
      fy1: r4(fy1 != null ? fy1 * scale : null), fy1End: y1?.endDate || null,
      analysts: y1?.earningsEstimate?.numberOfAnalysts?.raw ?? null,
      updated: today,
    };
    if (prev.lastQuarter && lastQuarter && prev.lastQuarter !== lastQuarter) newReports.push(`${t} ${lastQuarter} (reported ${earnings.lastReported})`);

    const old = { ttm: row.ttmEps, fwd: row.fwdEps, bv: row.bvps };
    /* banks are valued on P/B; their EPS is kept for reference only */
    if (row.metric === "pb" && q.bookValue > 0) row.bvps = r4(q.bookValue * scale);
    if (ttm != null) row.ttmEps = r4(ttm);
    if (ntm != null) row.fwdEps = r4(ntm);
    row.price = r2(p);
    row.earnings = earnings;
    log.push(`${t.padEnd(5)} ttm ${String(old.ttm ?? "—").padStart(7)} → ${String(row.ttmEps ?? "—").padStart(8)}  fwd(NTM) ${String(old.fwd ?? "—").padStart(7)} → ${String(row.fwdEps ?? "—").padStart(8)}${row.metric === "pb" ? `  bv ${old.bv} → ${row.bvps}` : ""}  last ${earnings.lastQuarter} @ ${earnings.lastReported} · next ${earnings.next}${earnings.nextConfirmed ? "" : " (est.)"}`);
  } catch (err) {
    failed.push(t);
    log.push(`${t.padEnd(5)} FAILED — keeping previous values (${err.message})`);
  }
  await sleep(250);
}

console.log(log.join("\n"));
if (failed.length === rows.length) { console.error("Every ticker failed — data.json left untouched."); process.exit(0); }

data.meta.earningsAsOf = today;
data.meta.earningsUpdatedISO = now.toISOString();
if (failed.length) data.meta.earningsWarning = `Earnings refresh failed for: ${failed.join(", ")}`; else delete data.meta.earningsWarning;
if (newReports.length) {
  data.meta.recentReports = [...newReports.map(x => ({ text: x, detected: today })), ...(data.meta.recentReports || [])].slice(0, 20);
  console.log(`\nNEW REPORTS: ${newReports.join("; ")}`);
}
await writeJson(DATA_PATH, data);
console.log(`\nEarnings refreshed for ${rows.length - failed.length}/${rows.length}${failed.length ? ` · failed: ${failed.join(", ")}` : ""}`);
