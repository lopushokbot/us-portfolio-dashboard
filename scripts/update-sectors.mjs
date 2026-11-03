#!/usr/bin/env node
/**
 * Sector leaders page (sectors.html): the ten largest S&P 500 companies by market cap in each of the 11 GICS sectors.
 *
 * Every multiple uses exactly the portfolio page's definitions — the per-company logic is shared (earnings.mjs):
 *   trailing P/E = latest price ÷ diluted GAAP EPS over the last four reported quarters (SEC EDGAR as filed, Yahoo fills gaps)
 *   forward  P/E = latest price ÷ next-twelve-months consensus EPS (current/next fiscal-year blend)
 *   latest price = last trade in any session — regular, after-hours, overnight or pre-market
 * Sector aggregates: "all members" comes from update-indices.mjs (bottom-up over every S&P 500 member, run first);
 * "top 10" = Σ market cap ÷ Σ earnings over the ten leaders, plus the median of their own multiples.
 *
 * Writes sectors.json. A company whose refresh fails keeps its previous values; the run never wipes the file.
 */
import path from "node:path";
import { ROOT, DATA_PATH, readJson, writeJson, yahooQuotes, yahooLastTrades, sp500, isoDay, sleep, dubaiStamp } from "./lib.mjs";
import { refreshEarnings } from "./earnings.mjs";

const OUT = path.join(ROOT, "sectors.json");
const TOP = 10;
const SECTORS = [
  ["Information Technology", "secIT", "Info Tech"],
  ["Communication Services", "secComm", "Comm. Services"],
  ["Consumer Discretionary", "secCD", "Cons. Discretionary"],
  ["Financials", "secFin", "Financials"],
  ["Health Care", "secHC", "Health Care"],
  ["Industrials", "secInd", "Industrials"],
  ["Consumer Staples", "secStaples", "Cons. Staples"],
  ["Energy", "secEnergy", "Energy"],
  ["Utilities", "secUtil", "Utilities"],
  ["Real Estate", "secRE", "Real Estate"],
  ["Materials", "secMat", "Materials"],
];

const now = new Date(), today = isoDay(now);
const r2 = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;
const median = a => { const v = a.filter(x => x != null && isFinite(x)).sort((p, q) => p - q); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const NAME_FIX = { "DBA Sempra": "Sempra", "JP Morgan Chase": "JPMorgan Chase", "Alphabet Class A": "Alphabet", "ExxonMobil Holdings": "ExxonMobil", "Southern": "Southern Company" };
const cleanName = raw => {
  let n = String(raw || "").replace(/\s*\(The\)$/i, "").replace(/^The\s+/i, "").trim();
  for (let i = 0; i < 3; i++) n = n.replace(/[,\s]+(Inc|Incorporated|Corp|Corporation|Company|Co|Ltd|Limited|plc|N\.V|S\.A|LP|L\.P)\.?$/i, "").trim();
  n = n.replace(/\s+(&|and)$/i, "").replace(/,$/, "").trim();
  return NAME_FIX[n] || n;
};

let prev = {};
try { prev = await readJson(OUT); } catch {}
const prevRow = Object.fromEntries((prev.companies || []).map(c => [c.t, c]));
const data = await readJson(DATA_PATH);

/* 1 · universe and ranking: S&P 500 members by market cap, share classes counted once (GOOGL/GOOG, FOXA/FOX, NWSA/NWS) */
const spx = await sp500();
const quotes = await yahooQuotes(spx.rows.map(r => r.t));
console.log(`S&P 500: ${spx.rows.length} (${spx.source}) · quotes ${Object.keys(quotes).length}`);
const sectorCap = {}, picks = {};
for (const [sector] of SECTORS) {
  const seen = new Set(), list = [];
  const members = spx.rows.filter(r => r.sector === sector && quotes[r.t]?.marketCap > 0)
    .sort((a, b) => quotes[b.t].marketCap - quotes[a.t].marketCap);
  let cap = 0;
  for (const r of members) {
    const q = quotes[r.t], key = (q.longName || q.shortName || r.t).toLowerCase().replace(/[^a-z0-9]/g, "").replace(/class[a-z]$/, "");
    if (seen.has(key)) continue;
    seen.add(key); cap += q.marketCap;
    if (list.length < TOP) list.push(r.t);
  }
  sectorCap[sector] = cap; picks[sector] = list;
}

/* 2 · earnings, same code path as the holdings */
const jobs = SECTORS.flatMap(([sector]) => picks[sector].map((t, i) => ({ t, sector, rank: i + 1 })));
const rows = {}, log = [], newReports = [], failed = [];
const worker = async () => {
  while (jobs.length) {
    const j = jobs.shift(), q = quotes[j.t], old = prevRow[j.t] || {};
    const row = { t: j.t, name: cleanName(q.longName || q.shortName) || j.t, sector: j.sector, rank: j.rank,
      ttmEps: old.ttmEps ?? null, fwdEps: old.fwdEps ?? null, earnings: old.earnings || null };
    try { await refreshEarnings(row, q, log, newReports, now); }
    catch (err) { failed.push(j.t); log.push(`${j.t.padEnd(5)} FAILED — keeping previous values (${err.message})`); }
    rows[j.t] = row;
    await sleep(200);
  }
};
await Promise.all([worker(), worker()]);
console.log(log.join("\n"));

/* 3 · latest trade of any session */
const tickers = Object.keys(rows);
let last = {};
try { last = await yahooLastTrades(tickers); } catch (e) { console.warn(`Extended-hours quotes unavailable — regular close used (${e.message})`); }
for (const t of tickers) {
  const row = rows[t], q = quotes[t], x = last[t];
  row.close = r2(x?.close ?? q.regularMarketPrice);
  row.price = r2(x?.price ?? q.regularMarketPrice);
  row.session = x?.session || "regular";
  if (x?.time) row.sessionTime = x.time.toISOString();
  row.mcap = Math.round(q.marketCap * row.price / (q.regularMarketPrice || row.price));
  /* lean earnings block for the page */
  const e = row.earnings || {};
  row.earnings = { lastQuarter: e.lastQuarter ?? null, lastReported: e.lastReported ?? null, next: e.next ?? null, nextConfirmed: !!e.nextConfirmed,
    ttmBasis: e.ttmBasis ?? null, gaapQuarters: e.gaapQuarters ?? null, fy0: e.fy0 ?? null, fy0End: e.fy0End ?? null, fy1: e.fy1 ?? null, fy1End: e.fy1End ?? null, analysts: e.analysts ?? null };
}

/* 4 · sector aggregates */
const pe = (p, eps) => p > 0 && eps > 0 ? p / eps : null;
const sectors = SECTORS.map(([sector, key, short]) => {
  const list = picks[sector].map(t => rows[t]);
  let cap = 0, capT = 0, eT = 0, capF = 0, eF = 0;
  for (const r of list) {
    cap += r.mcap;
    const sh = r.mcap / r.price;   /* implied shares, so earnings = shares × EPS */
    if (r.ttmEps != null) { capT += r.mcap; eT += sh * r.ttmEps; }
    if (r.fwdEps != null) { capF += r.mcap; eF += sh * r.fwdEps; }
  }
  const all = data.meta.sectorsAll?.[key] || {};
  return {
    key, name: sector, short,
    all: { t: all.t ?? null, f: all.f ?? null, n: all.n ?? null },
    top: {
      t: eT > 0 ? r2(capT / eT) : null, f: eF > 0 ? r2(capF / eF) : null,
      medT: r2(median(list.map(r => pe(r.price, r.ttmEps)))), medF: r2(median(list.map(r => pe(r.price, r.fwdEps)))),
      cap, share: sectorCap[sector] ? r2(list.reduce((a, r) => a + r.mcap * r.close / r.price, 0) / sectorCap[sector]) : null,
      losersT: list.filter(r => !(r.ttmEps > 0)).length, losersF: list.filter(r => !(r.fwdEps > 0)).length,
    },
    tickers: picks[sector],
  };
});

const spxIx = data.indices.find(i => i.key === "spx");
const out = {
  meta: {
    asOf: today, asOfISO: now.toISOString(), pricesAsOf: dubaiStamp(now),
    spx: spxIx ? { t: spxIx.trailing?.pe ?? null, f: spxIx.forward?.pe ?? null, date: spxIx.trailing?.date ?? null, level: spxIx.price ?? null } : null,
    universe: `${spx.rows.length} S&P 500 members (${spx.source}), GICS sectors`,
    ...(failed.length ? { warning: `Earnings refresh failed for: ${failed.join(", ")} (previous values kept)` } : {}),
    recentReports: newReports.length
      ? [...newReports.map(x => ({ text: x, detected: today })), ...(prev.meta?.recentReports || [])].slice(0, 30)
      : prev.meta?.recentReports || [],
  },
  sectors,
  companies: SECTORS.flatMap(([sector]) => picks[sector].map(t => rows[t])),
};
if (failed.length === tickers.length) { console.error("Every company failed — sectors.json left untouched."); process.exit(0); }
await writeJson(OUT, out);

for (const s of sectors) console.log(`${s.short.padEnd(20)} top10 ${String(s.top.t).padStart(6)}× / ${String(s.top.f).padStart(6)}×  · all ${String(s.all.t).padStart(6)}× / ${String(s.all.f).padStart(6)}×  · ${Math.round(s.top.share * 100)}% of sector cap · ${s.tickers.join(" ")}`);
console.log(`\nSector leaders refreshed: ${tickers.length - failed.length}/${tickers.length}${failed.length ? ` · failed: ${failed.join(", ")}` : ""}${newReports.length ? `\nNEW REPORTS: ${newReports.join("; ")}` : ""}`);
