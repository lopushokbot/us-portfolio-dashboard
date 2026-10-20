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

/** Batch quote: up to ~100 symbols per call. Returns {SYMBOL: quote}. */
export async function yahooQuotes(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 80) {
    const chunk = symbols.slice(i, i + 80);
    const j = await yahooJson(`https://{host}.finance.yahoo.com/v7/finance/quote?symbols=${chunk.map(encodeURIComponent).join(",")}`);
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
    if (gap < 75 || gap > 105) return null;
  }
  if (mostRecentQuarter && Math.abs(new Date(last4[3].end) - new Date(mostRecentQuarter)) / 864e5 > 20) return null;
  return { ttm: last4.reduce((a, x) => a + x.eps, 0), quarters: last4 };
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
