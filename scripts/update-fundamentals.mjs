#!/usr/bin/env node
/**
 * Earnings refresh for every holding + peer (runs with the daily price job, so a new report
 * is picked up within hours of the company publishing it).
 *
 *   ttmEps   = trailing-twelve-month diluted GAAP EPS = sum of the last 4 reported quarters (Yahoo fundamentals timeseries,
 *              with any newer quarter Yahoo hasn't ingested yet taken from SEC EDGAR — the 10-Q/10-K XBRL or, on report day,
 *              the 8-K earnings release); falls back to Yahoo's quote-level epsTrailingTwelveMonths when the quarters are
 *              incomplete or not in USD (TSM)
 *   fwdEps   = next-twelve-months consensus EPS: time-weighted blend of current-FY and next-FY consensus (Yahoo earningsTrend)
 *   bvps     = book value per share (banks, P/B)
 *   earnings = { lastQuarter, lastReported, next, nextConfirmed, adjTtm, quarters[] } — report dates from Nasdaq,
 *              next date from Yahoo calendarEvents. adjTtm = sum of the last 4 quarters' adjusted (non-GAAP) EPS,
 *              used to flag one-off items automatically.
 *
 * Any ticker that fails keeps its previous values; the script never wipes data.
 */
import { DATA_PATH, readJson, writeJson, yahooQuotes, isoDay, sleep } from "./lib.mjs";
import { refreshEarnings } from "./earnings.mjs";

const now = new Date();
const today = isoDay(now);

const data = await readJson(DATA_PATH);
const rows = [...data.stocks, ...data.peers];
const quotes = await yahooQuotes(rows.map(r => r.t));
const log = [], newReports = [], failed = [];

for (const row of rows) {
  const t = row.t, q = quotes[t];
  try {
    await refreshEarnings(row, q, log, newReports, now);
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
