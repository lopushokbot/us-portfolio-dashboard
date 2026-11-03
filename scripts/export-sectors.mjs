#!/usr/bin/env node
/**
 * Local only: builds a single self-contained, pre-rendered copy of sectors.html for sending as a file (Telegram).
 *   - fonts inlined as data URIs, sectors.json inlined as window.__SECTORS__
 *   - rendered once in headless Chrome and saved with the finished DOM, so it reads correctly even in viewers that
 *     don't run JavaScript (iOS Quick Look); in a browser the script re-renders it and sorting/navigation still work
 *   - "‹ Portfolio valuation" points at the live site
 * Output: exports/sectors-<YYYY-MM-DD>.html (gitignored). Usage: node scripts/export-sectors.mjs
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { ROOT } from "./lib.mjs";

const require = createRequire("/Users/iibot/airbnb-pricing-watch/package.json");
const { chromium } = require("playwright-core");
const LIVE = "https://lopushokbot.github.io/us-portfolio-dashboard/";

let html = await readFile(path.join(ROOT, "sectors.html"), "utf8");
const data = JSON.parse(await readFile(path.join(ROOT, "sectors.json"), "utf8"));

/* fonts → data URIs */
const fonts = [...html.matchAll(/url\("(assets\/fonts\/[^"]+)"\)/g)].map(m => m[1]);
for (const f of new Set(fonts)) {
  const b64 = (await readFile(path.join(ROOT, f))).toString("base64");
  const mime = f.endsWith(".woff2") ? "font/woff2" : "font/otf";
  html = html.split(`url("${f}")`).join(`url("data:${mime};base64,${b64}")`);
}
/* data inline + live links */
const json = JSON.stringify(data).replace(/</g, "\\u003c");
html = html.replace("<script>\n/* ================= Helpers", `<script>window.__SECTORS__ = ${json};</script>\n<script>\n/* ================= Helpers`);
html = html.replace(`id="back" href="./"`, `id="back" href="${LIVE}"`);

/* pre-render */
const dir = path.join(ROOT, "exports");
await mkdir(dir, { recursive: true });
const tmp = path.join(dir, "_render.html");
await writeFile(tmp, html);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(pathToFileURL(tmp).href);
  await page.waitForSelector("table.leaders tbody tr");
  const rendered = await page.evaluate(() => {
    document.querySelectorAll(".fade").forEach(el => el.classList.add("in"));
    document.querySelectorAll(".chip.on").forEach(el => el.classList.remove("on"));
    return "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
  });
  const out = path.join(dir, `sectors-${data.meta.asOf}.html`);
  await writeFile(out, rendered);
  console.log(`${out} · ${(rendered.length / 1024).toFixed(0)} KB · ${data.companies.length} companies`);
} finally {
  await browser.close();
  await rm(tmp, { force: true });
}
