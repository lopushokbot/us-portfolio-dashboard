/**
 * Shared helpers for the data refresh scripts (Node 20+, no dependencies).
 *
 * Yahoo Finance:
 *  - chart API (prices) works with Node's default User-Agent; a full browser UA gets 429.
 *  - quote / quoteSummary need a cookie + crumb. The crumb endpoint answers 429 to Node's default UA
 *    and to full browser UAs, but accepts the bare "Mozilla/5.0" UA — keep it exactly like that.
 * Nasdaq API (report dates) needs a full browser UA.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_PATH = path.join(ROOT, "data.json");
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export const readJson = async p => JSON.parse(await readFile(p, "utf8"));
export const writeJson = (p, d) => writeFile(p, JSON.stringify(d, null, 2) + "\n");

const YUA = { "user-agent": "Mozilla/5.0" };
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

async function retry(fn, label, tries = 4) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(i); } catch (err) { last = err; if (i < tries) await sleep(1500 * i); }
  }
  throw new Error(`${label}: ${last?.message}`);
}

/* ---------- Yahoo session (cookie + crumb) ---------- */
let session = null;
export async function yahooSession(force = false) {
  if (session && !force) return session;
  session = await retry(async () => {
    const r1 = await fetch("https://fc.yahoo.com", { headers: YUA, redirect: "manual" });
    const cookie = (r1.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
    if (!cookie) throw new Error("no cookie");
    const r2 = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { ...YUA, cookie } });
    const crumb = (await r2.text()).trim();
    if (!r2.ok || !crumb || crumb.includes("<") || crumb.length > 40) throw new Error(`crumb HTTP ${r2.status}`);
    return { cookie, crumb };
  }, "Yahoo session");
  return session;
}

async function yahooJson(url) {
  return retry(async attempt => {
    const s = await yahooSession(attempt > 2);
    const sep = url.includes("?") ? "&" : "?";
    const host = attempt % 2 ? "query1" : "query2";
    const r = await fetch(url.replace("{host}", host) + `${sep}crumb=${encodeURIComponent(s.crumb)}`, { headers: { ...YUA, cookie: s.cookie } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }, url.split("?")[0].split("/").slice(-2).join("/"));
}

/** Batch quote: up to ~100 symbols per call. Returns {SYMBOL: quote}. `extra` = additional query string (e.g. "&overnightPrice=true"). */
export async function yahooQuotes(symbols, extra = "") {
  const out = {};
  for (let i = 0; i < symbols.length; i += 80) {
    const chunk = symbols.slice(i, i + 80);
    const j = await yahooJson(`https://{host}.finance.yahoo.com/v7/finance/quote?symbols=${chunk.map(encodeURIComponent).join(",")}${extra}`);
    for (const q of j?.quoteResponse?.result || []) out[q.symbol] = q;
    await sleep(400);
  }
  return out;
}

/** quoteSummary modules for one symbol. */
export async function yahooSummary(symbol, modules) {
  const j = await yahooJson(`https://{host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules.join(",")}`);
  const res = j?.quoteSummary?.result?.[0];
  if (!res) throw new Error(`${symbol}: empty quoteSummary`);
  return res;
}

/** Quarterly diluted GAAP EPS from Yahoo's fundamentals timeseries (no crumb needed; Node's default UA). Oldest → newest. */
export async function yahooQuarterlyEps(symbol) {
  return retry(async () => {
    const r = await fetch(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=quarterlyDilutedEPS&period1=${Math.floor(Date.now() / 1000) - 3 * 365 * 86400}&period2=${Math.floor(Date.now() / 1000) + 86400}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const res = (await r.json())?.timeseries?.result?.[0];
    return (res?.quarterlyDilutedEPS || []).filter(x => x && x.reportedValue?.raw != null)
      .map(x => ({ end: x.asOfDate, eps: x.reportedValue.raw, ccy: x.currencyCode })).sort((a, b) => a.end.localeCompare(b.end));
  }, `timeseries ${symbol}`, 3);
}

/** Sum of the last four quarters if they are consecutive (≈ 3 months apart) and the newest is the latest reported quarter. */
export function ttmFromQuarters(qs, mostRecentQuarter) {
  if (qs.length < 4) return null;
  const last4 = qs.slice(-4);
  for (let i = 1; i < 4; i++) {
    const gap = (new Date(last4[i].end) - new Date(last4[i - 1].end)) / 864e5;
    if (gap < 75 || gap > 125) return null;   /* 16-week retail quarters run ~112 days */
  }
  if (mostRecentQuarter && Math.abs(new Date(last4[3].end) - new Date(mostRecentQuarter)) / 864e5 > 20) return null;
  return { ttm: last4.reduce((a, x) => a + x.eps, 0), quarters: last4 };
}

/**
 * Latest trade across every session — regular, after-hours (16:00–20:00 ET), overnight (20:00–04:00 ET, Blue Ocean ATS)
 * and pre-market (04:00–09:30 ET). Yahoo returns the overnight fields only when asked with overnightPrice=true, and then
 * drops the post-market ones — so both variants are fetched. Returns {SYMBOL: {price, time, session, close, closeTime}}.
 */
export async function yahooLastTrades(symbols) {
  const [plain, night] = await Promise.all([yahooQuotes(symbols), yahooQuotes(symbols, "&overnightPrice=true").catch(() => ({}))]);
  const out = {};
  for (const t of symbols) {
    const a = plain[t] || {}, b = night[t] || {};
    const close = a.regularMarketPrice ?? b.regularMarketPrice, closeTime = a.regularMarketTime ?? b.regularMarketTime;
    if (!(close > 0)) continue;
    const cands = [
      { session: "regular", price: close, time: closeTime },
      { session: "post", price: a.postMarketPrice ?? b.postMarketPrice, time: a.postMarketTime ?? b.postMarketTime },
      { session: "pre", price: a.preMarketPrice ?? b.preMarketPrice, time: a.preMarketTime ?? b.preMarketTime },
      { session: "overnight", price: b.overnightMarketPrice, time: b.overnightMarketTime },
    ].filter(c => c.price > 0 && c.time && c.time >= closeTime);
    const best = cands.sort((x, y) => y.time - x.time)[0];
    out[t] = { price: best.price, time: new Date(best.time * 1000), session: best.session, close, closeTime: new Date(closeTime * 1000) };
  }
  return out;
}

/* ---------- SEC EDGAR: same-day GAAP EPS ----------
 * Yahoo's quarterly timeseries lags a new report by 1–3 days. EDGAR has the 10-Q/10-K XBRL the day it is filed
 * (often the report day) and the 8-K earnings release (exhibit 99.1) within minutes of the announcement.
 * SEC fair-access: a descriptive User-Agent with a contact address, ≤10 requests/second.
 */
const SECH = { "user-agent": "us-portfolio-dashboard admin@lopushokbot.dev" };
const secCache = new Map();   /* submissions JSON is read twice per company — once per run is enough */
async function secFetch(url, as = "json") {
  if (url.includes("/submissions/")) {
    if (!secCache.has(url)) secCache.set(url, secFetchRaw(url, as).catch(e => { secCache.delete(url); throw e; }));
    return secCache.get(url);
  }
  return secFetchRaw(url, as);
}
async function secFetchRaw(url, as) {
  return retry(async () => {
    await sleep(150);
    const r = await fetch(url, { headers: SECH });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return as === "json" ? r.json() : r.text();
  }, `SEC ${url.split("/").slice(-1)[0]}`, 3);
}

let cikMap = null;
export async function secCik(ticker) {
  if (!cikMap) {
    const j = await secFetch("https://www.sec.gov/files/company_tickers.json");
    cikMap = Object.fromEntries(Object.values(j).map(x => [x.ticker.replace(".", "-"), String(x.cik_str).padStart(10, "0")]));
  }
  return cikMap[ticker] || null;
}

const days = (a, b) => (new Date(b) - new Date(a)) / 864e5;
const monthEnd = (iso, add) => { const d = new Date(iso + "T00:00:00Z"); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add + 1, 0)).toISOString().slice(0, 10); };

/** Quarterly diluted EPS from 10-Q/10-K XBRL (Q4 = fiscal year − nine-month YTD). Oldest → newest: [{end, eps, filed, src}]. */
export async function secXbrlQuarters(cik) {
  const j = await secFetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/EarningsPerShareDiluted.json`);
  const latest = new Map();
  for (const f of j?.units?.["USD/shares"] || []) {
    if (!/^10-[QK]/.test(f.form) || !f.start) continue;
    const k = `${f.start}|${f.end}`, prev = latest.get(k);
    if (!prev) latest.set(k, { ...f, first: f.filed });
    else { if (f.filed > prev.filed) Object.assign(prev, { val: f.val, filed: f.filed }); if (f.filed < prev.first) prev.first = f.filed; }
  }
  const facts = [...latest.values()], q = new Map();
  /* 80–120 days: calendar quarters, 12/13-week and 16-week retail quarters (COST, PEP) */
  for (const f of facts) { const d = days(f.start, f.end); if (d >= 80 && d <= 120) q.set(f.end, { end: f.end, eps: f.val, filed: f.first, src: f.form.slice(0, 4) }); }
  for (const fy of facts) {
    const d = days(fy.start, fy.end);
    if (d < 350 || d > 380 || q.has(fy.end)) continue;
    const ytd9 = facts.find(f => f.start === fy.start && days(f.start, f.end) >= 245 && days(f.start, f.end) <= 290);
    /* EPS isn't additive when the share count moves (IPOs, big buybacks) — a derived Q4 yields to Yahoo's reported one */
    if (ytd9) q.set(fy.end, { end: fy.end, eps: Math.round((fy.val - ytd9.val) * 100) / 100, filed: fy.first, src: "10-K", derived: true });
  }
  return [...q.values()].sort((a, b) => a.end.localeCompare(b.end));
}

/** Plain-text lines of an HTML document: one per table row (cells often wrap text in <p>/<div>), one per paragraph elsewhere. */
function htmlRows(h) {
  const text = x => x.replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'").replace(/&#[0-9]+;|&#x[0-9a-f]+;|&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ").trim();
  const out = [];
  for (const part of h.split(/(<table[\s\S]*?<\/table>)/i)) {
    const pieces = /^<table/i.test(part) ? part.split(/<\/tr>/i) : part.split(/<\/(?:p|div)>/i);
    for (const x of pieces) { const t = text(x); if (t) out.push(t); }
  }
  return out;
}

/**
 * Diluted EPS of a quarter that so far exists only in the 8-K earnings release (exhibit 99.1).
 * The release prints the quarter next to the same quarter a year earlier; a value is accepted only when the
 * row's other figure matches that prior-year quarter from XBRL — so a misread table can't slip through.
 */
export async function secReleaseQuarter(cik, known, dbg = {}) {
  if (known.length < 4) return (dbg.reason = "few quarters", null);
  const last = known[known.length - 1];
  const sub = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const r = sub.filings.recent;
  let idx = -1;
  for (let i = 0; i < r.form.length; i++) {
    if (r.filingDate[i] <= last.filed) break;
    if (r.form[i] === "8-K" && String(r.items[i]).split(",").includes("2.02")) { idx = i; break; }
  }
  if (idx < 0) return (dbg.reason = "no 8-K 2.02", null);
  /* the new quarter is the one a year after the 4th-newest known quarter (works for 52/53-week years ending
     early in a month too, e.g. SNDK/MU — month-end arithmetic would miss those) */
  const prior = known[known.length - 4];
  const span = days(prior.end, last.end);
  if (span < 245 || span > 300) return (dbg.reason = "span", null);
  const me = monthEnd(prior.end, 12), end = prior.end.slice(8) > me.slice(8) ? me : me.slice(0, 8) + prior.end.slice(8), filed = r.filingDate[idx];
  if (days(end, filed) < 0 || days(end, filed) > 75) return (dbg.reason = `date ${end} ${filed}`, null);

  const acc = r.accessionNumber[idx], base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}`;
  const index = await secFetch(`${base}/${acc}-index.htm`, "text");
  /* the release is EX-99.1 for most filers, plain EX-99 for some (VZ, GE, PFE); try each EX-99* exhibit in order */
  const exs = [...index.matchAll(/href="([^"]+\.htm)"[^<]*<\/a><\/td>\s*<td[^>]*>\s*(EX-99[^<\s]*)\s*</gi)]
    .sort((x, y) => (y[2] === "EX-99.1") - (x[2] === "EX-99.1")).map(m => m[1]);
  const ex = exs[0];
  if (!ex) return (dbg.reason = "no EX-99.1", dbg.types = [...index.matchAll(/<td[^>]*>\s*(EX-[^<\s]+)\s*</g)].map(m => m[1]), null);
  /* A diluted-EPS row prints this quarter next to the year-ago quarter P (and often the previous quarter S, or YTD pairs).
     Columns come in many orders — [cur, P], [P, cur, ytdP, ytdCur], [cur, S, P, …] (TMUS), [P, …, S, cur] (TSLA, NFLX) —
     so the value is located from the known quarters, never assumed: with S present it is S's neighbour away from P,
     otherwise P's partner in a two-column pair. Percent figures are ignored. */
  const P = prior.eps, S = last.eps, near = (x, y) => Math.abs(x - y) < 0.006;
  const votes = new Map();
  for (const e of exs.slice(0, 3)) {
    const rows = htmlRows(await secFetch(`https://www.sec.gov${e}`, "text"));
    if (!dbg.rows) { dbg.rows = rows.filter(l => /diluted|assuming dilution/i.test(l)).slice(0, 8); dbg.prior = P; dbg.url = e; }
    /* per-share figures: "4.92", "(0.12)", "-0.12", ".56" (WMB); never the tail of a larger number, never a percentage */
    const numsOf = l => [...l.matchAll(/(\()?(-)?\$?\s?(?<![\d,.])(\d{0,4}\.\d{2})\b(\))?(?!\s?%)/g)].map(m => ((m[1] && m[4]) || m[2] ? -1 : 1) * Number(m[3]));
    for (let r = 0; r < rows.length; r++) {
      let line = rows[r];
      if (line.length > 400 || !/diluted|assuming dilution/i.test(line) || /non-gaap|adjusted|excluding|guidance|outlook/i.test(line)) continue;
      /* label on its own row, figures on the next one (VZ) */
      if (numsOf(line).length < 2 && rows[r + 1] && rows[r + 1].length < 300) line += " " + rows[r + 1];
      const nums = numsOf(line);
      if (nums.length < 2) continue;
      const iP = nums.findIndex(x => near(x, P));
      const iS = near(P, S) ? -1 : nums.findIndex((x, k) => k !== iP && near(x, S));
      let i = -1;
      if (iP >= 0 && iS >= 0) i = iS + (iS > iP ? 1 : -1);
      else if (iP >= 0 && (nums.length === 2 || nums.length === 4) && iP <= 1) i = iP ^ 1;
      /* sequential-only release: [this quarter, previous quarter] (PSX) */
      else if (iP < 0 && iS >= 0 && nums.length === 2) i = iS ^ 1;
      const v = nums[i];
      /* a value equal to one of the last known quarters is a misread column, not the new quarter */
      if (v == null || near(v, P) || known.slice(-3).some(k => near(v, k.eps))) continue;
      votes.set(v, (votes.get(v) || 0) + 1);
    }
    if (votes.size) break;
  }
  if (!votes.size) return (dbg.reason = "no matching row", null);
  const ranked = [...votes.entries()].sort((x, y) => y[1] - x[1]);
  if (ranked[1] && ranked[1][1] === ranked[0][1]) return (dbg.reason = `ambiguous ${ranked.map(x => x[0]).join("/")}`, null);
  const [eps] = ranked[0];
  return { end, eps, filed, src: "8-K", prior: prior.eps, url: `https://www.sec.gov${ex}` };
}

/**
 * GAAP diluted EPS by quarter from EDGAR for a US filer: XBRL quarters plus, when the newest quarter is only
 * in the earnings release so far, that quarter. Also returns the latest earnings-release (8-K item 2.02) date.
 */
export async function secQuarterlyEps(ticker) {
  const cik = await secCik(ticker);
  if (!cik) throw new Error("no CIK");
  const quarters = await secXbrlQuarters(cik);
  if (!quarters.length) throw new Error("no XBRL EPS");
  let release = null;
  try { release = await secReleaseQuarter(cik, quarters); } catch (e) { /* release parse is best-effort */ }
  if (release) quarters.push(release);
  const sub = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const r = sub.filings.recent, last = quarters[quarters.length - 1];
  let releaseDate = null;
  for (let i = 0; i < r.form.length; i++) {
    if (r.filingDate[i] < last.end) break;
    if (r.form[i] === "8-K" && String(r.items[i]).split(",").includes("2.02") && r.filingDate[i] <= last.filed) { releaseDate = r.filingDate[i]; break; }
  }
  return { cik, quarters, release, lastReported: releaseDate || last.filed };
}

/**
 * SEC + Yahoo quarters merged by period end (±20 days). A quarter as filed (10-Q, 8-K release) wins;
 * Yahoo fills quarters EDGAR lacks and replaces Q4s that EDGAR only has as fiscal year − nine months.
 */
export function mergeQuarters(yahoo, sec) {
  const out = (sec || []).map(x => ({ end: x.end, eps: x.eps, src: x.src, derived: !!x.derived }));
  for (const y of yahoo) {
    const i = out.findIndex(x => Math.abs(days(x.end, y.end)) <= 20);
    if (i < 0) out.push({ end: y.end, eps: y.eps, src: "Yahoo" });
    else if (out[i].derived) out[i] = { end: out[i].end, eps: y.eps, src: "Yahoo" };
  }
  return out.sort((a, b) => a.end.localeCompare(b.end));
}

/* ---------- Nasdaq ---------- */
const NQH = { "user-agent": BROWSER_UA, accept: "application/json" };
/** Last reported quarters with report dates, newest first: [{qtr:"Sep 2026", reported:"2026-10-15", eps}] (eps = adjusted). */
export async function nasdaqReports(symbol) {
  const t = symbol.replace("-", ".");
  return retry(async () => {
    const r = await fetch(`https://api.nasdaq.com/api/company/${encodeURIComponent(t)}/earnings-surprise`, { headers: NQH });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rows = (await r.json())?.data?.earningsSurpriseTable?.rows || [];
    return rows.map(x => {
      const [m, d, y] = String(x.dateReported).split("/").map(Number);
      return { qtr: x.fiscalQtrEnd, reported: y ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null, eps: Number(x.eps) };
    });
  }, `Nasdaq ${t}`, 3);
}
export async function nasdaq100() {
  return retry(async () => {
    const r = await fetch("https://api.nasdaq.com/api/quote/list-type/nasdaq100", { headers: NQH });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return ((await r.json())?.data?.data?.rows || []).map(x => x.symbol.replace(/[./]/g, "-"));
  }, "Nasdaq-100 list", 3);
}

/* ---------- S&P 500 constituents + GICS sector ---------- */
export async function sp500() {
  try {
    const h = await (await fetch("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies", { headers: { "user-agent": "us-portfolio-dashboard/1.0 (github.com/lopushokbot/us-portfolio-dashboard)" } })).text();
    const i = h.indexOf('id="constituents"');
    const tbl = h.slice(i, h.indexOf("</table>", i));
    const rows = [...tbl.matchAll(/<tr[^>]*>\s*<td[^>]*>\s*<a[^>]*>([A-Z.]+)<\/a>(?:<!--[\s\S]*?-->)?\s*<\/td>\s*<td[^>]*>[\s\S]*?<\/td>\s*<td[^>]*>([^<]+)<\/td>/g)]
      .map(m => ({ t: m[1].replace(".", "-"), sector: m[2].trim() }));
    if (rows.length > 495) return { rows, source: "Wikipedia" };
  } catch {}
  const csv = await (await fetch("https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv")).text();
  const rows = csv.trim().split("\n").slice(1).map(l => {
    const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, "").replace(/^"|"$/g, ""));
    return { t: cells[0].replace(".", "-"), sector: cells[2] };
  });
  if (rows.length < 480) throw new Error(`S&P 500 list too short (${rows.length})`);
  return { rows, source: "datahub.io" };
}

/* ---------- Forward EPS: next-twelve-months blend ---------- */
/**
 * NTM EPS = time-weighted blend of current-FY and next-FY consensus:
 *   f = share of the current fiscal year still ahead (0–1); NTM = f·FY0 + (1−f)·FY1.
 * fy0End is the end date of the fiscal year that FY0 refers to.
 */
export function ntmEps(fy0, fy1, fy0End, now = new Date()) {
  if (fy1 == null || !isFinite(fy1)) return null;
  if (fy0 == null || !isFinite(fy0) || !fy0End) return fy1;
  const days = (new Date(fy0End) - now) / 864e5;
  const f = Math.min(1, Math.max(0, days / 365.25));
  return f * fy0 + (1 - f) * fy1;
}

export const isoDay = d => new Date(d).toISOString().slice(0, 10);
export function dubaiStamp(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dubai", month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  return `${fmt.format(date)} Dubai`;
}
