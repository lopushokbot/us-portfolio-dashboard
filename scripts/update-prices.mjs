#!/usr/bin/env node
/**
 * Daily price refresh for the US Portfolio Valuation Dashboard.
 * - Reads data.json, fetches the latest price for every holding + peer + index (S&P 500, Nasdaq-100)
 *   from Yahoo Finance, writes the prices back and stamps meta.pricesAsOf in Dubai time.
 * - Stocks + peers use the LATEST TRADE OF ANY SESSION (after-hours, overnight, pre-market), so a reaction to an
 *   after-close earnings report is in the multiples by the next morning. `close` keeps the regular-session close,
 *   `session` says where `price` came from. Indices stay on the official close (no extended-hours index level).
 * - EPS / book value / consensus / index P/Es are NOT touched (they change quarterly — see RUNBOOK).
 * - If a ticker fails after retries the previous price is kept and the failure is logged.
 * - Exits non-zero only if every ticker failed (nothing sensible to commit).
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { yahooLastTrades } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(ROOT, "data.json");
// NOTE: do NOT send a browser-style User-Agent — Yahoo answers 429 to it; Node's default UA gets 200.
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function yahooPrice(ticker, attempt = 1) {
  const host = attempt % 2 ? "query1" : "query2";
  const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== "number" || !(price > 0)) throw new Error("no regularMarketPrice");
    return { price, time: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000) : null };
  } catch (err) {
    if (attempt < 3) { await sleep(1500 * attempt); return yahooPrice(ticker, attempt + 1); }
    throw err;
  }
}

function dubaiStamp(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dubai", month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  return `${fmt.format(date)} Dubai`;
}

const data = JSON.parse(await readFile(DATA_PATH, "utf8"));
const rows = [...data.stocks, ...data.peers, ...(data.indices || [])];
let ok = 0, failed = [];
let latestMarketTime = null;

for (const row of rows) {
  try {
    const { price, time } = await yahooPrice(row.yahoo || row.t);
    const old = row.close ?? row.price;
    row.price = Math.round(price * 100) / 100;
    if (time && (!latestMarketTime || time > latestMarketTime)) latestMarketTime = time;
    const chg = old ? ((row.price / old - 1) * 100).toFixed(2) : "n/a";
    console.log(`${(row.yahoo || row.t).padEnd(5)} ${String(old).padStart(9)} → ${String(row.price).padStart(9)}  (${chg}%)`);
    ok++;
  } catch (err) {
    failed.push(row.name && row.yahoo ? row.name : row.t);
    console.warn(`${(row.yahoo || row.t).padEnd(5)} FAILED — keeping ${row.price} (${err.message})`);
  }
  await sleep(250);
}

/* extended hours: replace the regular close with the latest trade of any session */
const tickers = [...data.stocks, ...data.peers].map(r => r.t);
let ext = {};
try { ext = await yahooLastTrades(tickers); } catch (err) { console.warn(`Extended-hours quotes unavailable — using regular close (${err.message})`); }
const LABEL = { regular: "close", post: "after-hours", pre: "pre-market", overnight: "overnight" };
console.log("");
for (const row of [...data.stocks, ...data.peers]) {
  const x = ext[row.t];
  if (!x) { row.close = row.price; row.session = "regular"; delete row.sessionTime; continue; }
  row.close = Math.round(x.close * 100) / 100;
  row.price = Math.round(x.price * 100) / 100;
  row.session = x.session;
  row.sessionTime = x.time.toISOString();
  if (x.time > latestMarketTime) latestMarketTime = x.time;
  if (x.session !== "regular") console.log(`${row.t.padEnd(5)} ${LABEL[x.session].padEnd(11)} ${String(row.price).padStart(9)}  vs close ${row.close}  (${((row.price / row.close - 1) * 100).toFixed(2)}%)  @ ${row.sessionTime.slice(0, 16)}Z`);
}

if (ok === 0) {
  console.error("All price fetches failed — data.json left untouched.");
  process.exit(1);
}

const now = new Date();
data.meta.pricesAsOf = dubaiStamp(now);
data.meta.pricesAsOfISO = now.toISOString();
data.meta.priceSource = "Yahoo Finance" + (latestMarketTime ? ` (last trade ${latestMarketTime.toISOString().slice(0, 16).replace("T", " ")} UTC)` : "");
if (failed.length) data.meta.priceWarning = `Stale price for: ${failed.join(", ")}`; else delete data.meta.priceWarning;

await writeFile(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
console.log(`\nUpdated ${ok}/${rows.length} prices · ${data.meta.pricesAsOf}${failed.length ? ` · stale: ${failed.join(", ")}` : ""}`);
