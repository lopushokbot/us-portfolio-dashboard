#!/usr/bin/env node
/**
 * Bottom-up trailing + forward P/E for the S&P 500, the Nasdaq-100 and every S&P 500 GICS sector.
 *
 * Method (same definitions as the per-stock multiples on the dashboard):
 *   trailing P/E = Σ market cap ÷ Σ trailing-twelve-month GAAP net earnings      (loss-makers included, as S&P does)
 *   forward  P/E = Σ market cap ÷ Σ next-twelve-months consensus earnings          (NTM = time-weighted FY0/FY1 blend)
 * where a company's earnings = market cap × EPS ÷ price (so share counts and classes cancel out).
 * Companies without consensus are left out of the forward aggregate (cap and earnings both); coverage is recorded.
 *
 * Writes data.json → indices[].trailing / .forward ({pe, level, date, coverage, source}) and groups.sec*.{t,f}.
 * The fiscal-year end of each company's FY0 estimate is cached in data/fiscal-years.json (refreshed after year end).
 * If anything essential fails the previous values are kept and the script exits 0 with a warning.
 */
import path from "node:path";
import { ROOT, DATA_PATH, readJson, writeJson, yahooQuotes, yahooSummary, sp500, nasdaq100, ntmEps, isoDay, sleep } from "./lib.mjs";

const FY_PATH = path.join(ROOT, "data", "fiscal-years.json");
const SECTOR_KEYS = {
  "Information Technology": "secIT", "Energy": "secEnergy", "Utilities": "secUtil", "Consumer Discretionary": "secCD",
  "Industrials": "secInd", "Financials": "secFin", "Health Care": "secHC", "Communication Services": "secComm",
  "Consumer Staples": "secStaples", "Materials": "secMat", "Real Estate": "secRE",
};
const now = new Date();
const today = isoDay(now);

async function main() {
  const data = await readJson(DATA_PATH);
  let fy = {};
  try { fy = await readJson(FY_PATH); } catch {}

  const spx = await sp500();
  const ndx = await nasdaq100();
  const sectorOf = Object.fromEntries(spx.rows.map(r => [r.t, r.sector]));
  const universe = [...new Set([...spx.rows.map(r => r.t), ...ndx])];
  console.log(`S&P 500: ${spx.rows.length} (${spx.source}) · Nasdaq-100: ${ndx.length} · unique ${universe.length}`);

  const quotes = await yahooQuotes([...universe, "^GSPC", "^NDX"]);
  console.log(`quotes: ${Object.keys(quotes).length}`);

  /* refresh fiscal-year cache: missing, or FY0 already ended (Yahoo rolls the year after the annual report) */
  const stale = universe.filter(t => quotes[t] && (!fy[t] || !fy[t].fy0End || fy[t].fy0End < today && fy[t].checked !== today));
  console.log(`fiscal-year lookups: ${stale.length}`);
  let done = 0;
  const worker = async () => {
    while (stale.length) {
      const t = stale.shift();
      try {
        const s = await yahooSummary(t, ["earningsTrend"]);
        const y0 = (s.earningsTrend?.trend || []).find(x => x.period === "0y");
        fy[t] = { fy0End: y0?.endDate || null, checked: today };
      } catch (e) { fy[t] = { ...(fy[t] || {}), checked: today, err: e.message.slice(0, 60) }; }
      if (++done % 100 === 0) console.log(`  … ${done}`);
      await sleep(150);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await writeJson(FY_PATH, Object.fromEntries(Object.entries(fy).sort()));

  /* per-company earnings, deduplicating share classes (GOOG/GOOGL, FOX/FOXA, NWS/NWSA) by company name */
  const seen = new Set();
  const company = {};
  let currencyFixes = 0;
  for (const t of universe) {
    const q = quotes[t];
    if (!q || !(q.marketCap > 0) || !(q.regularMarketPrice > 0)) continue;
    const name = (q.longName || q.shortName || t).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(name)) continue;
    seen.add(name);
    const p = q.regularMarketPrice, M = q.marketCap;
    /* EPS may be in the reporting currency (ADRs): rescale using Yahoo's own P/E where it disagrees with price ÷ EPS */
    let scale = 1;
    const ref = q.forwardPE > 0 && q.epsForward > 0 ? [q.forwardPE, q.epsForward] : q.trailingPE > 0 && q.epsTrailingTwelveMonths > 0 ? [q.trailingPE, q.epsTrailingTwelveMonths] : null;
    if (ref) { const s = (p / ref[0]) / ref[1]; if (Math.abs(s - 1) > 0.05) { scale = s; currencyFixes++; } }
    const ttm = q.epsTrailingTwelveMonths != null ? q.epsTrailingTwelveMonths * scale : null;
    const ntm = ntmEps(q.epsCurrentYear != null ? q.epsCurrentYear * scale : null, q.epsForward != null ? q.epsForward * scale : null, fy[t]?.fy0End, now);
    company[t] = { M, eT: ttm != null ? M * ttm / p : null, eF: ntm != null ? M * ntm / p : null };
  }
  if (currencyFixes) console.log(`currency-rescaled EPS for ${currencyFixes} companies`);

  const aggregate = tickers => {
    let capAll = 0, capT = 0, eT = 0, capF = 0, eF = 0, n = 0, nT = 0, nF = 0;
    let capTp = 0, eTp = 0, capFp = 0, eFp = 0, lossT = 0, lossF = 0;   /* "ex loss-makers" variant */
    for (const t of tickers) {
      const c = company[t]; if (!c) continue;
      n++; capAll += c.M;
      if (c.eT != null) { capT += c.M; eT += c.eT; nT++; if (c.eT > 0) { capTp += c.M; eTp += c.eT; } else lossT++; }
      if (c.eF != null) { capF += c.M; eF += c.eF; nF++; if (c.eF > 0) { capFp += c.M; eFp += c.eF; } else lossF++; }
    }
    return {
      t: eT > 0 ? capT / eT : null, f: eF > 0 ? capF / eF : null,
      tEx: eTp > 0 ? capTp / eTp : null, fEx: eFp > 0 ? capFp / eFp : null, lossT, lossF,
      n, covT: capAll ? capT / capAll : 0, covF: capAll ? capF / capAll : 0, nT, nF,
    };
  };

  const results = {
    spx: aggregate(spx.rows.map(r => r.t)),
    ndx: aggregate(ndx),
  };
  const sectors = {};
  for (const [sector, key] of Object.entries(SECTOR_KEYS)) sectors[key] = aggregate(spx.rows.filter(r => r.sector === sector).map(r => r.t));

  const r2 = v => Math.round(v * 100) / 100;
  const levelOf = { spx: quotes["^GSPC"]?.regularMarketPrice, ndx: quotes["^NDX"]?.regularMarketPrice };
  for (const ix of data.indices) {
    const r = results[ix.key], level = levelOf[ix.key];
    if (!r || !level || r.covT < 0.95 || r.covF < 0.9 || !r.t || !r.f) { console.warn(`${ix.name}: insufficient coverage — keeping previous values`, r); continue; }
    const src = `Bottom-up from ${r.n} constituents (Yahoo Finance consensus)`;
    ix.price = r2(level);
    ix.trailing = { pe: r2(r.t), level: r2(level), date: today, n: r.nT, coverage: r2(r.covT), losers: r.lossT, exLoss: r2(r.tEx), source: src, basis: "GAAP TTM" };
    ix.forward = { pe: r2(r.f), level: r2(level), date: today, n: r.nF, coverage: r2(r.covF), losers: r.lossF, exLoss: r2(r.fEx), source: src, basis: "NTM consensus" };
    console.log(`${ix.name.padEnd(10)} trailing ${r.t.toFixed(2)}× (cov ${(r.covT * 100).toFixed(1)}%) · forward ${r.f.toFixed(2)}× (cov ${(r.covF * 100).toFixed(1)}%) · level ${level}`);
  }
  for (const [key, g] of Object.entries(data.groups)) {
    const r = sectors[key];
    if (!r || g.members) continue;
    if (!r.t || !r.f || r.covT < 0.9 || r.covF < 0.85) { console.warn(`${key}: insufficient coverage — keeping previous values`); continue; }
    g.t = r2(r.t); g.f = r2(r.f); g.n = r.n; g.asOf = today;
    console.log(`${key.padEnd(10)} trailing ${r.t.toFixed(2)}× · forward ${r.f.toFixed(2)}× · ${r.n} cos`);
  }
  data.meta.indicesAsOf = today;
  data.meta.sectorsAll = Object.fromEntries(Object.entries(sectors).map(([k, r]) => [k, { t: r.t && r2(r.t), f: r.f && r2(r.f), n: r.n }]));
  await writeJson(DATA_PATH, data);
}

main().catch(err => { console.error("Index refresh failed — data.json left untouched:", err.message); process.exitCode = 0; });
