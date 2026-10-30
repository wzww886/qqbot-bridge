// bridge.mjs v2 — QQ Bot <-> AI 闭环
import { QQBot } from "@tencent-connect/qqbot-nodejs";
import { createServer } from "node:http";
import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { createAiEngine } from "./ai.mjs";

import { dirname, join } from "node:path";

// ---- 路径全部可覆盖：环境变量 > config.json > 默认值 ----
const DEFAULT_STATE = "/data/adb/qqbot_bridge_data";
const LEGACY_STATE = "/storage/emulated/0/Download/Operit/plugins/qqbot_bridge";
const ROOT = process.env.QQBRIDGE_ROOT || "/data/adb/qqbot_bridge";

const CFG_CANDIDATES = [
  process.env.QQBRIDGE_CONFIG,
  process.env.QQBRIDGE_STATE && process.env.QQBRIDGE_STATE + "/config.json",
  DEFAULT_STATE + "/config.json",
  ROOT + "/app/config.json",
  LEGACY_STATE + "/config.json",
].filter(Boolean);
const cfgPath = CFG_CANDIDATES.find((p) => existsSync(p));
if (!cfgPath) { console.error("no config.json found, tried:\n  " + CFG_CANDIDATES.join("\n  ")); process.exit(1); }
const CFG = JSON.parse(readFileSync(cfgPath, "utf8"));

const STATE = process.env.QQBRIDGE_STATE || CFG.stateDir || DEFAULT_STATE;
mkdirSync(STATE, { recursive: true });

const INBOX = STATE + "/inbox.jsonl";
const PORT = Number(process.env.QQBRIDGE_PORT || CFG.port || 32146);
const startedAt = Date.now();
const stats = { running: true, connected: false, events: 0, lastError: "", lastEventAt: 0, sessionId: "", botInfo: null, reconnects: 0 };
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
// 老用户兜底：旧版默认目录（Operit 插件目录）里有配置就补搬过来，只补缺失、不覆盖
if (STATE !== LEGACY_STATE && existsSync(LEGACY_STATE)) {
  for (const f of ["ai.json", "persona.md", "proactive.json", "stickers.json"]) {
    try {
      const from = join(LEGACY_STATE, f), to = join(STATE, f);
      if (existsSync(from) && !existsSync(to)) { copyFileSync(from, to); log("migrated", f, "from legacy dir"); }
    } catch {}
  }
}

const bot = new QQBot({
  appId: CFG.appId,
  appSecret: CFG.appSecret,
  logger: { info: () => {}, warn: (...a) => log("WARN", ...a), error: (...a) => log("ERR", ...a), debug: () => {} },
});

const ai = createAiEngine({ bot, stateDir: STATE, log });

bot.on("ready", (d) => {
  stats.connected = true; stats.sessionId = d?.sessionId || ""; stats.botInfo = d?.user || null;
  log("READY", JSON.stringify(d || {}));
});
bot.on("resumed", () => { stats.connected = true; stats.reconnects++; log("RESUMED"); });
bot.on("disconnected", (e) => { stats.connected = false; log("DISCONNECTED", JSON.stringify(e)); });
bot.on("error", (e) => { stats.lastError = String(e?.message || e); log("ERROR", stats.lastError); });

bot.on("message", (ctx, msg) => {
  stats.events++; stats.lastEventAt = Date.now();

  // 防自环：不处理自己发的消息
  const selfId = stats.botInfo?.id;
  if (selfId && String(msg.senderId) === String(selfId)) return;

  const rec = {
    receivedAt: new Date().toISOString(), kind: msg.kind, rawEventType: msg.rawEventType, senderId: msg.senderId,
    senderName: msg.senderName, content: msg.content, messageId: msg.messageId,
    timestamp: msg.timestamp, groupOpenid: msg.groupOpenid,
    mentions: (msg.mentions || []).map((m) => ({ is_you: m?.is_you, scope: m?.scope, name: m?.nickname || m?.username })),
    attachments: msg.attachments || [], replyTarget: msg.replyTarget,
  };
  try { appendFileSync(INBOX, JSON.stringify(rec) + "\n"); } catch (e) { log("inbox write fail", e.message); }
  const atMe = msg.rawEventType === "GROUP_AT_MESSAGE_CREATE" || (msg.mentions || []).some((m) => m && m.is_you === true);
  log("MSG", rec.kind, rec.rawEventType || "", rec.senderName || rec.senderId, JSON.stringify(rec.content), atMe ? "[@我]" : "");

  ai.handleMessage(ctx, msg).catch((e) => log("AI dispatch fail", String(e?.message || e)));
});

function json(res, code, obj) { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } }); }); }

const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  if (u.pathname === "/status") {
    return json(res, 200, {
      success: true, engine: "qqbot-nodejs-bridge", running: stats.running, connected: stats.connected,
      pid: process.pid, startedAt, sessionId: stats.sessionId, botInfo: stats.botInfo,
      eventCount: stats.events, lastEventAt: stats.lastEventAt, lastError: stats.lastError,
      reconnects: stats.reconnects, inbox: INBOX, configUsed: cfgPath, ai: ai.stats(),
    });
  }
  if (u.pathname === "/messages") {
    const consume = u.searchParams.get("consume") === "1";
    let lines = [];
    if (existsSync(INBOX)) lines = readFileSync(INBOX, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (consume) writeFileSync(INBOX, "");
    return json(res, 200, { success: true, count: lines.length, messages: lines });
  }
  if (u.pathname === "/ai/reload") { ai.reload(); return json(res, 200, { success: true, ai: ai.stats() }); }
  if (u.pathname === "/proactive") {
    const b = req.method === "POST" ? await readBody(req) : {};
    const r = await ai.proactive({ scope: b.scope, targetId: b.targetId, senderName: b.senderName });
    return json(res, 200, r);
  }
  if (u.pathname === "/send" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.scope || !b.targetId || !b.content) return json(res, 400, { success: false, error: "scope/targetId/content required" });
    try {
      const target = { scope: b.scope, targetId: String(b.targetId) };
      if (b.msgId) target.msgId = String(b.msgId);
      const r = await bot.sendText(target, String(b.content));
      return json(res, 200, { success: true, result: r ?? null });
    } catch (e) { stats.lastError = String(e?.message || e); return json(res, 500, { success: false, error: stats.lastError }); }
  }
  if (u.pathname === "/sendimage" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.scope || !b.targetId || !b.file) return json(res, 400, { success: false, error: "scope/targetId/file required" });
    try {
      const target = { scope: b.scope, targetId: String(b.targetId) };
      if (b.msgId) target.msgId = String(b.msgId);
      const r = await bot.sendImage(target, { localPath: String(b.file) });
      return json(res, 200, { success: true, result: r ?? null });
    } catch (e) { stats.lastError = String(e?.message || e); return json(res, 500, { success: false, error: stats.lastError }); }
  }
  if (u.pathname === "/shutdown") { json(res, 200, { success: true }); setTimeout(() => process.exit(0), 100); return; }
  return json(res, 404, { success: false, error: "not found" });
});
server.listen(PORT, "127.0.0.1", () => log("http api on 127.0.0.1:" + PORT));

// ---------------- 主动消息调度 ----------------
const PROACTIVE_CFG = STATE + "/proactive.json";
const PROACTIVE_STATE = process.env.QQBRIDGE_PROACTIVE_STATE || join(ROOT, "proactive_state.json");
const readJ = (p, fb) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fb; } };

function recentC2C() {
  if (!existsSync(INBOX)) return null;
  const lines = readFileSync(INBOX, "utf8").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { const r = JSON.parse(lines[i]); if (r.kind === "c2c" && r.senderId) return r; } catch {}
  }
  return null;
}

async function tickProactive() {
  const c = readJ(PROACTIVE_CFG, {});
  if (c.enabled !== true) return;
  const now = Date.now();
  const stt = readJ(PROACTIVE_STATE, { lastAt: 0, day: "", count: 0 });
  const day = new Date().toDateString();
  if (stt.day !== day) { stt.day = day; stt.count = 0; }
  if ((c.maxPerDay ?? 3) > 0 && (stt.count || 0) >= c.maxPerDay) return;
  if (now - (stt.lastAt || 0) < (c.minGapMin ?? 240) * 60000) return;
  if (now - Math.max(stats.lastEventAt || 0, startedAt) < (c.idleMin ?? 120) * 60000) return;
  const q = c.quietHours || {};
  if (q.start && q.end) {
    const d = new Date();
    const cur = d.getHours() * 60 + d.getMinutes();
    const toMin = (s) => { const [h, m] = String(s).split(":").map(Number); return (h || 0) * 60 + (m || 0); };
    const a = toMin(q.start), b = toMin(q.end);
    const on = a <= b ? (cur >= a && cur < b) : (cur >= a || cur < b);
    if (on) return;
  }
  let scope = c.target?.scope === "group" ? "group" : "c2c";
  let targetId = String(c.target?.targetId || "");
  if (!targetId) { const last = recentC2C(); if (!last) return; targetId = String(last.senderId); }
  const r = await ai.proactive({ scope, targetId, senderName: c.senderName || "父亲" });
  if (r.ok) {
    stt.lastAt = now; stt.count = (stt.count || 0) + 1;
    try { writeFileSync(PROACTIVE_STATE, JSON.stringify(stt)); } catch {}
  } else log("proactive skip", r.reason);
}
setInterval(() => { tickProactive().catch((e) => log("proactive tick fail", String(e?.message || e))); }, 60000);
log("proactive scheduler armed");

await bot.start().catch((e) => { stats.lastError = String(e?.message || e); stats.connected = false; log("START_FAILED", stats.lastError); });

// 健康检查：90秒连不上就自杀，交给 watchdog 重启（应对开机无网）
let lastOkAt = Date.now();
setInterval(() => {
  if (stats.connected) { lastOkAt = Date.now(); return; }
  if (Date.now() - lastOkAt > 90000) {
    log("HEALTH_TIMEOUT, exit so supervisor restarts");
    process.exit(1);
  }
}, 30000);