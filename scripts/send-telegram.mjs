#!/usr/bin/env node
/**
 * Local only: send a file to Sema's Telegram via @chepuliabot.
 * Token from ~/.claude/channels/telegram/.env (TELEGRAM_BOT_TOKEN), chat from ~/airbnb-pricing-watch/.env (TELEGRAM_CHAT_ID).
 * Usage: node scripts/send-telegram.mjs <file> "<caption>"
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const env = p => Object.fromEntries((existsSync(p) ? readFileSync(p, "utf8") : "").split("\n")
  .map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]));
const HOME = process.env.HOME;
const token = env(path.join(HOME, ".claude/channels/telegram/.env")).TELEGRAM_BOT_TOKEN;
const chat = env(path.join(HOME, "airbnb-pricing-watch/.env")).TELEGRAM_CHAT_ID;
const [file, caption = ""] = process.argv.slice(2);
if (!token || !chat) throw new Error("Telegram token or chat id missing");
if (!file || !existsSync(file)) throw new Error(`File not found: ${file}`);

const form = new FormData();
form.append("chat_id", chat);
if (caption) form.append("caption", caption);
form.append("document", new Blob([readFileSync(file)], { type: "text/html" }), path.basename(file));
const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form });
const j = await r.json();
if (!j.ok) throw new Error(`Telegram: ${j.description}`);
console.log(`Sent ${path.basename(file)} (message ${j.result.message_id})`);
