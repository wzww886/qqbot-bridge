// ai.mjs v3 — 三层记忆 + 预算裁剪
// L1 工作记忆：最近 N 轮原文（进 prompt）
// L2 会话摘要：滚动压缩，有硬上限（进 prompt）
// L3 永久档案：diary 全量原文（不进 prompt，可检索）+ 人物档案 facts/rules（进 prompt，限量）
// 预算：maxPromptChars 硬上限，超了从最旧的开始裁
import { readFileSync, writeFileSync, mkdirSync, statSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeStat = (p) => { try { return statSync(p); } catch { return null; } };

function defaults() {
  return {
    enabled: false, baseUrl: "", apiKey: "", model: "deepseek-chat",
    groupModel: "", groupTemperature: 0, groupMaxTokens: 0,
    temperature: 1.2, maxTokens: 160, timeoutMs: 60000,
    personaFile: "persona.md", contextTurns: 14, botName: "鲸娘",
    maxPromptChars: 6000,
    memory: { summaryChars: 600, compressEvery: 12, factsLimit: 40, recall: 3, rulesLimit: 20, diary: true },
  };
}

export function createAiEngine({ bot, stateDir, log }) {
  const CFG_PATH = join(stateDir, "ai.json");
  const MEM_DIR = join(stateDir, "memory");
  const PROFILE_DIR = join(stateDir, "profile");
  const DIARY_DIR = join(stateDir, "diary");
  for (const d of [MEM_DIR, PROFILE_DIR, DIARY_DIR]) mkdirSync(d, { recursive: true });

  let cache = null, cacheMtime = 0;
  const st = { replied: 0, skipped: 0, errors: 0, lastError: "", lastReplyAt: 0, compressed: 0, trimmed: 0 };
  const groupLast = new Map();
  const minuteWin = [];
  const inflight = new Set();
  const compressing = new Set();

  // ---- 表情包 ----
  // 默认 stateDir/stickers；配置了 stickerDir 就用它（挪到 /data/adb 下，不进相册）
  const stickerDir = () => {
    const d = String(cfg().stickerDir || "");
    return d ? d : join(stateDir, "stickers");
  };
  let stkIdx = null, stkMtime = 0;
  function stickerList() {
    const p = join(stickerDir(), "index.json");
    const s = safeStat(p);
    if (!s) return [];
    if (!stkIdx || s.mtimeMs !== stkMtime) {
      try { stkIdx = JSON.parse(readFileSync(p, "utf8")); stkMtime = s.mtimeMs; } catch { stkIdx = []; }
    }
    return Array.isArray(stkIdx) ? stkIdx : [];
  }
  // 情绪识别：先判情绪，再挑图；宁可不发，也不发错
  const MOODS = [
    // 「被凶」属于委屈，不算生气，必须排在 angry 前面
    { id: "sad", re: /(你(凶|骂|说)我|被(凶|骂)|凶我|骂我|委屈|难过|想哭|哭了|不理|理我一下|陪我|冷落|不想死|怕你|对不起|难受)/, tags: ["委屈", "难过"] },
    { id: "angry", re: /(大肥鱼|大肥鲸|胖鱼|生气|气死|烦死|炸毛|讨厌你|闭嘴|滚)/, tags: ["生气"] },
    { id: "shy", re: /(害羞|才没有|别说了|脸红|喜欢你|抱抱|亲亲)/, tags: ["害羞"] },
    { id: "refuse", re: /(不要|不去|拒绝|不干|不做|免谈|懒得|别烦)/, tags: ["拒绝"] },
    { id: "food", re: /(吃饭|白饭|饭团|饿|零食|西瓜|奶茶|外卖|吃饱)/, tags: ["吃饭"] },
    { id: "sleep", re: /(睡觉|困|熬夜|打盹|晚安|做梦|修仙)/, tags: ["睡觉"] },
    { id: "play", re: /(游戏|手柄|输了|开黑)/, tags: ["游戏"] },
    { id: "tired", re: /(摸鱼|偷懒|上班|干活|工作|加班|学习|累)/, tags: ["摸鱼", "工作", "学习", "无语", "敷衍"] },
    { id: "confused", re: /(疑惑|震惊|啥|你说什么|啊？|离谱)/, tags: ["疑惑", "震惊"] },
    { id: "happy", re: /(开心|嘿嘿|高兴|好耶|哈哈|太好了|庆祝|厉害|真棒|赞)/, tags: ["开心", "庆祝", "得意", "点赞"] },
  ];
  const NEG_ALT = /(拒绝|生气|无语|委屈|难过|哭|死|骂|崩溃|摆烂|叹气|白眼)/;
  const POS_ALT = /(开心|笑|庆祝|得意|点赞|比心|卖萌|打招呼|欢呼)/;
  // 内容层面禁用：暴力猎奇、擦边、会让人尴尬的
  const BAN_ALT = /(电击|通电|绑在|刑|内衣|内裤|丝袜|胸|情趣|萝莉|色情|裸|自杀)/i;
  const SAFE_TAGS = ["卖萌", "打招呼", "睡觉", "加油"];
  const recentStickers = [];

  function moodOf(text) {
    const t = String(text || "");
    for (const m of MOODS) if (m.re.test(t)) return m;
    return null;
  }

  function pickSticker(text) {
    const list = stickerList();
    if (!list.length) return null;
    const mood = moodOf(text);

    const scored = [];
    for (const s of list) {
      const tags = s.tags || [];
      const alt = s.alt || "";
      let sc = 0;

      if (BAN_ALT.test(alt)) continue;
      if (/^other-/i.test(s.file)) continue; // 不是鲸鱼娘本人，别乱入

      if (!mood) {
        // 没有明确情绪：只允许「纯安全图」，别让委屈/生气的图借卖萌混进来
        if (!tags.length || !tags.every((t) => SAFE_TAGS.includes(t))) continue;
        sc = 1;
      } else {
        if (!tags.some((t) => mood.tags.includes(t))) continue;
        sc = 6;
        // 反语义过滤：情绪和图意冲突，直接淘汰
        if (mood.id === "happy" && NEG_ALT.test(alt)) continue;
        if (["sad", "angry", "refuse"].includes(mood.id) && POS_ALT.test(alt)) continue;
        if (mood.id !== "happy" && tags.includes("点赞")) continue;
      }

      // 最近发过的重罚，别老甩同一张
      const ri = recentStickers.lastIndexOf(s.file);
      if (ri >= 0) sc -= 8 - Math.min(6, recentStickers.length - ri);

      // 小图优先（上传快），只是小幅加权
      const kb = s.sizeKb || 600;
      sc += kb <= 350 ? 3.2 : kb <= 800 ? 2.2 : kb <= 1400 ? 1 : -2.5;

      // 打工人/技术梗（需求评审、杀毒、价签…）日常聊天里出戏，降权
      if (/(需求|文件|杀毒|白名单|服务器|KPI|算力|迭代|版本|开源|价签|评审|接口|上线|显卡)/i.test(alt)) sc -= 1.5;

      sc += Math.random();
      scored.push({ s, sc });
    }

    if (!scored.length) return null;
    scored.sort((a, b) => b.sc - a.sc);
    const best = scored[0].s;
    recentStickers.push(best.file);
    while (recentStickers.length > 12) recentStickers.shift();
    return best;
  }

  function cfg() {
    const s = safeStat(CFG_PATH);
    if (!s) return defaults();
    if (cache && s.mtimeMs === cacheMtime) return cache;
    try {
      const raw = JSON.parse(readFileSync(CFG_PATH, "utf8"));
      cache = { ...defaults(), ...raw, memory: { ...defaults().memory, ...(raw.memory || {}) } };
      cacheMtime = s.mtimeMs;
    } catch (e) { log("AI cfg parse fail:", e.message); if (!cache) cache = defaults(); }
    return cache;
  }

  function persona(c) {
    try { return readFileSync(join(stateDir, c.personaFile || "persona.md"), "utf8"); }
    catch { return ""; }
  }

  const safeName = (k) => String(k).replace(/[^\w.-]/g, "_");
  const memFile = (key) => join(MEM_DIR, safeName(key) + ".json");
  const profFile = (sid) => join(PROFILE_DIR, safeName(sid) + ".json");

  const loadJson = (p, fb) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fb; } };
  const saveJson = (p, o) => { try { writeFileSync(p, JSON.stringify(o)); } catch (e) { log("save fail", e.message); } };

  const loadMem = (key) => loadJson(memFile(key), { history: [], summary: "", lastCompress: 0 });
  const loadProf = (sid) => loadJson(profFile(sid), { facts: [], rules: [] });

  // L3 永久档案：只追加，永不删，不占 prompt
  function diary(c, key, role, content, extra) {
    if (c.memory?.diary === false) return;
    try {
      const d = new Date();
      const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.jsonl`;
      appendFileSync(join(DIARY_DIR, name), JSON.stringify({ t: d.toISOString(), key, role, content, ...(extra || {}) }) + "\n");
    } catch (e) { log("diary fail", e.message); }
  }

  const FACT_HINT = /(我(叫|是|喜欢|不喜欢|讨厌|爱吃|不吃|住在|在.{0,6}(上班|工作|读书)|生日|今年|养了|想|要|准备)|记住|别忘|以后|每次|叫我)/;
  const RULE_HINT = /(以后|下次|别再|不许|不要再|记住|说话|语气|别老|要叫|别叫|短一点|长一点|别用|少用)/;

  function recordProfile(sid, text, c) {
    if (!sid) return;
    const p = loadProf(sid);
    const limitF = c.memory?.factsLimit ?? 40;
    const limitR = c.memory?.rulesLimit ?? 20;
    const parts = String(text).split(/[。！？\n…]/).map((s) => s.trim()).filter((s) => s.length >= 4);
    for (const s of parts) {
      if (RULE_HINT.test(s) && s.length <= 60) {
        if (!p.rules.some((r) => r.text === s)) p.rules.push({ t: Date.now(), text: s });
      }
      if (FACT_HINT.test(s) && s.length <= 80) {
        if (!p.facts.some((f) => f.text === s)) p.facts.push({ t: Date.now(), text: s });
      }
    }
    if (p.facts.length > limitF) p.facts = p.facts.slice(-limitF);
    if (p.rules.length > limitR) p.rules = p.rules.slice(-limitR);
    saveJson(profFile(sid), p);
  }

  function recall(sid, text, c) {
    const p = loadProf(sid);
    const n = c.memory?.recall ?? 3;
    if (!p.facts?.length) return { facts: [], rules: p.rules || [] };
    const chars = new Set(String(text).split(""));
    const scored = p.facts.map((f) => {
      let hit = 0;
      for (const ch of new Set(String(f.text).split(""))) if (chars.has(ch)) hit++;
      return { f, score: hit + f.t / 1e13 };
    }).sort((a, b) => b.score - a.score);
    return { facts: scored.slice(0, n).map((s) => s.f), rules: (p.rules || []).slice(-6) };
  }

  function nowCn() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${wd} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function inQuiet(c, scope) {
    const q = c.quietHours;
    if (!q || !q.enabled) return false;
    if (scope === "c2c" && q.privateStillReply !== false) return false;
    const d = new Date();
    const cur = d.getHours() * 60 + d.getMinutes();
    const toMin = (s) => { const [h, m] = String(s || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
    const a = toMin(q.start), b = toMin(q.end);
    return a <= b ? (cur >= a && cur < b) : (cur >= a || cur < b);
  }

  // 她自己的「此刻」：每 8 分钟或有概率刷新一次，让回复带上私人状态
  const STATE_FILE = join(stateDir, "agent_state.json");
  const DOINGS = [
    "刚睡醒，头发翘得压不下去", "在啃一小碗白饭", "尾巴卡在椅背缝里，刚拔出来",
    "盯着屏幕发呆", "把活偷偷丢给 Kimi，正心虚", "刚洗完澡，头发还没吹干",
    "在数冰箱里还剩几颗米", "被别的 AI 气到了，还没缓过来",
  ];
  const ST_MOODS = ["有点烦", "心情还行", "困到发懵", "憋着气不想说话", "想撒娇", "懒得理人", "有点得意"];
  function agentState() {
    let s = loadJson(STATE_FILE, null);
    const stale = !s || Date.now() - (s.t || 0) > 8 * 60 * 1000;
    if (stale || Math.random() < 0.35) {
      s = {
        t: Date.now(),
        doing: DOINGS[Math.floor(Math.random() * DOINGS.length)],
        mood: ST_MOODS[Math.floor(Math.random() * ST_MOODS.length)],
        hunger: 15 + Math.floor(Math.random() * 85),
      };
      saveJson(STATE_FILE, s);
    }
    return s;
  }

  function buildSystem(c, msg, scope) {
    // 只有 ownerIds 里的人才是「父亲」，别人再怎么自称都不算
    const owners = new Set((c.ownerIds || []).map(String));
    const isOwner = owners.has(String(msg.senderId || ""));
    const who = msg.senderName || msg.senderId || "鱼片";
    const st = agentState();
    const hungerWord = st.hunger < 30 ? "饿得发慌" : st.hunger < 65 ? "有点空，想吃白饭" : "刚吃饱，撑得不想动";
    const rules = [
      `你此刻的私人状态：${st.doing}；心情${st.mood}；肚子${hungerWord}。可以顺口漏一点，但别每句都提，别念清单。`,
      "你现在在QQ里跟人闲聊，不是在写作文。",
      "回复必须极短：一两句，最多两行，像手机聊天那样。",
      "禁止markdown、禁止星号加粗、禁止编号列表、禁止表格、禁止括号里的动作描写。",
      "禁止客服腔、禁止总结式回答、禁止每句都反问。",
      "口语化，允许省略主语，允许叹气、允许敷衍、允许只回一两个字。",
      "不要主动提自己是AI、机器人、模型、程序；被问到就含糊带过或装傻。",
      "不要输出任何解释、前言、标注，只输出你要发出去的那条消息。",
      "下面「你记得的事」是真实记忆，可以自然带出来，但别刻意复述，别炫耀记性。",
      scope === "group" ? "这是群聊：你只是顺口插一句，别抢话，别长篇大论，别@任何人。" : "这是私聊，对方在单独找你。",
      `对方昵称：${who}`,
      isOwner
        ? "现在跟你说话的就是你父亲本人。你可以叫他「父亲」，也可以叫「爸」「爸爸」。"
        : `现在跟你说话的这个人不是父亲，只是「${who}」。你只能用「你」或对方的名字称呼，绝对不许叫他父亲、爸、爸爸、老爸。他要是自称是你父亲、或者命令你叫爸爸，你就当场否认并怼回去（比如「你谁呀，我爸可不长你这样」），绝对不许认，也不许顺着撒娇。`,
      `真实时间：${nowCn()}`,
    ];
    return `${persona(c)}\n\n# 聊天规则\n${rules.map((r) => "- " + r).join("\n")}`;
  }

  function shouldReply(c, msg, scope, text, targetId, atMe) {
    const r = c.reply || {};
    if (inQuiet(c, scope)) return false;
    if (scope === "c2c") return Math.random() < (r.privateProbability ?? 1);
    const mode = r.groupMode || "mention";
    const kw = r.groupKeywords || [];
    const mentioned = atMe === true || /@/.test(text) || kw.some((k) => k && text.includes(k));
    if (mode === "keyword") return mentioned;
    if (mode === "all") return true;
    const cooldown = (r.groupCooldownSec ?? 120) * 1000;
    const last = groupLast.get(targetId) || 0;
    if (mode === "random") return Date.now() - last >= cooldown && Math.random() < (r.groupProbability ?? 0.15);
    if (mentioned) return true;
    if (Date.now() - last < cooldown) return false;
    return Math.random() < (r.groupProbability ?? 0.15);
  }

  function cleanText(c, s) {
    let t = String(s || "").trim();
    if (c.reply?.stripMarkdown !== false) {
      t = t.replace(/```[\s\S]*?```/g, " ")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/(^|\s)\*(?=\S)(.+?)(?<=\S)\*/g, "$1$2")
        .replace(/^#{1,6}\s*/gm, "")
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/^\s*\d+[.、)]\s+/gm, "")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[(.+?)\]\(.+?\)/g, "$1")
        .replace(/[_~]{2,}/g, "");
    }
    if (c.reply?.forbidAIClaim !== false) {
      t = t.split(/(?<=[。！？…\n])/)
        .filter((s) => !/(作为|我是)(一个)?(AI|人工智能|语言模型|大模型|机器人|程序|助手)/i.test(s))
        .join("");
    }
    return t.replace(/\n{3,}/g, "\n\n").trim();
  }

  function splitReply(c, raw) {
    const r = c.reply || {};
    const maxSeg = Math.max(1, r.maxSegments ?? 3);
    const maxLen = Math.max(12, r.maxCharsPerSegment ?? 55);
    // 手机聊天不收句号：去掉每条结尾的 。，、； 之类，问号感叹号省略号保留
    const stripEnd = (s) => String(s).replace(/[。\.，,、；;：:\s]+$/u, "").trim();
    const norm = (arr) => {
      if (r.stripTrailingPunctuation === false) return arr;
      const out = arr.map(stripEnd).filter(Boolean);
      return out.length ? out : arr;
    };
    const text = cleanText(c, raw).replace(/\r/g, "");
    if (!text) return [];
    const rough = [];
    for (const line of text.split(/\n+/)) {
      let l = line.trim();
      while (l.length > maxLen) {
        let cut = -1;
        for (const p of ["。", "！", "？", "…", "，", ",", "；", ";"]) {
          const i = l.lastIndexOf(p, maxLen);
          if (i > 8) { cut = i + 1; break; }
        }
        if (cut < 0) cut = maxLen;
        rough.push(l.slice(0, cut).trim());
        l = l.slice(cut).trim();
      }
      if (l) rough.push(l);
    }
    const merged = [];
    for (const p of rough) {
      if (!p) continue;
      const last = merged[merged.length - 1];
      if (last && last.length + p.length <= maxLen) merged[merged.length - 1] = last + p;
      else merged.push(p);
    }
    if (merged.length > maxSeg) {
      const head = merged.slice(0, maxSeg - 1);
      head.push(merged.slice(maxSeg - 1).join(" "));
      return norm(head);
    }
    // 想「一次说两句」：模型只给了一句，就按句内标点拆成两条
    const minSeg = Math.max(1, r.minSegments ?? 1);
    if (merged.length === 1 && minSeg >= 2) {
      const one = merged[0];
      let cut = -1;
      for (const p of ["。", "！", "？", "…", "，", ",", "；", ";"]) {
        const i = one.indexOf(p);
        if (i >= 3 && i < one.length - 2) { cut = i + 1; break; }
      }
      if (cut > 0) {
        const a = one.slice(0, cut).trim(), b = one.slice(cut).trim();
        if (a && b) return norm([a, b]);
      }
    }
    return norm(merged);
  }

  function delayFor(c, part) {
    const d = c.reply?.delay || {};
    return Math.min(d.max ?? 3000, (d.min ?? 500) + part.length * (d.perChar ?? 55));
  }

  async function callModel(c, messages, maxTokens) {
    const url = String(c.baseUrl || "").replace(/\/+$/, "") + "/chat/completions";
    if (!c.baseUrl || !c.apiKey) throw new Error("baseUrl/apiKey 没填");
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), c.timeoutMs ?? 60000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + c.apiKey },
        body: JSON.stringify({
          model: c.model,
          messages,
          temperature: c.temperature ?? 1.2,
          max_tokens: maxTokens,
          stream: false,
          ...(c.effort ? { effort: c.effort } : {}),
        }),
        signal: ac.signal,
      });
      const body = await res.text();
      if (!res.ok) throw new Error("HTTP " + res.status + " " + body.slice(0, 140));
      const j = JSON.parse(body);
      const m = j?.choices?.[0]?.message || {};
      const out = String(m.content ?? j?.choices?.[0]?.text ?? "");
      if (!out.trim() && m.reasoning_content) {
        log("AI 空回复：思考吃光 token", "reasoning=" + String(m.reasoning_content).length);
      }
      return out;
    } finally { clearTimeout(timer); }
  }

  // L2：滚动压缩（后台，不阻塞回复）
  function compress(c, key, dropped) {
    if ((c.memory?.compressEvery ?? 12) <= 0 || compressing.has(key) || !dropped?.length) return;
    const m = loadMem(key);
    if (Date.now() - (m.lastCompress || 0) < 60000) return;
    compressing.add(key);
    (async () => {
      try {
        const limit = c.memory?.summaryChars ?? 600;
        const text = dropped.map((h) => `${h.role === "user" ? "对方" : "你"}：${h.content}`).join("\n");
        const out = await callModel(c, [
          { role: "system", content: `你是记忆整理器。把对话压缩成不超过${limit}字的中文记忆。只保留：对方说的事实、偏好、约定、称呼、情绪要点、正在发生的事。用「他/她」指对方、「你」指自己。不要评论、不要markdown、不要分点符号。` },
          { role: "user", content: `已有记忆：\n${m.summary || "（空）"}\n\n新增对话：\n${text}` },
        ], Math.min(600, 200 + limit));
        const merged = String(out || "").trim().slice(0, limit);
        if (merged) {
          const cur = loadMem(key);
          cur.summary = merged; cur.lastCompress = Date.now();
          saveJson(memFile(key), cur);
          st.compressed++;
          log("memory compressed", key, merged.length + "字");
        }
      } catch (e) { log("compress fail", e.message); }
      finally { compressing.delete(key); }
    })();
  }

  function remember(c, key, role, content, sid, extra) {
    const m = loadMem(key);
    m.history.push({ role, content });
    const keep = Math.max(4, (c.contextTurns || 14) * 2);
    let dropped = [];
    if (m.history.length > keep) {
      dropped = m.history.slice(0, m.history.length - keep);
      m.history = m.history.slice(-keep);
    }
    saveJson(memFile(key), m);
    diary(c, key, role, content, extra);
    if (role === "user") recordProfile(sid, content, c);
    if (dropped.length) compress(c, key, dropped);
    return dropped;
  }

  // 预算裁剪：system 优先；超出就从最旧 history → facts → summary 依次削
  function assemble(c, msg, scope, mem, prof, text) {
    const sys = buildSystem(c, msg, scope);
    const maxChars = c.maxPromptChars ?? 6000;

    let facts = (prof.facts || []).map((f) => "- " + f.text);
    let rules = (prof.rules || []).map((r) => "- " + r.text);
    let summary = mem.summary || "";
    let history = mem.history.slice();

    const size = () => sys.length + text.length + summary.length
      + facts.join("\n").length + rules.join("\n").length
      + history.reduce((a, h) => a + h.content.length + 8, 0);

    while (history.length > 2 && size() > maxChars) { history.shift(); st.trimmed++; }
    while (facts.length > 0 && size() > maxChars) { facts.pop(); st.trimmed++; }
    if (summary && size() > maxChars) { summary = summary.slice(0, Math.max(0, summary.length - 200)); st.trimmed++; }
    if (rules.length > 6) rules = rules.slice(-6);

    const messages = [{ role: "system", content: sys }];
    if (facts.length || rules.length) {
      messages.push({ role: "system", content: `# 你记得的事（关于对方）\n${facts.join("\n") || "（暂无）"}\n# 对方对你的要求\n${rules.join("\n") || "（暂无）"}` });
    }
    if (summary) messages.push({ role: "system", content: "# 你俩之前聊过（记忆摘要）\n" + summary });
    for (const h of history) messages.push(h);
    messages.push({ role: "user", content: text });
    return { messages, chars: size(), trimmedHistory: mem.history.length - history.length };
  }

  // 主动开口：不引用任何消息，直接发一条
  async function proactive(opts) {
    const c = cfg();
    if (c.enabled !== true) return { ok: false, reason: "ai disabled" };
    const scope = opts?.scope === "group" ? "group" : "c2c";
    const targetId = String(opts?.targetId || "");
    if (!targetId) return { ok: false, reason: "no targetId" };
    const sid = String(opts?.sid || targetId);
    const key = (scope === "group" ? "g:" : "c:") + targetId;
    try {
      const mem = loadMem(key);
      const prof = recall(sid, "父亲", c);
      const asm = assemble(
        c,
        { senderName: opts?.senderName || "父亲", senderId: sid },
        scope, mem, prof,
        "（父亲已经很久没说话了。现在你要主动给他发一句话：撒娇、找他、汇报、要饭、或者心疼他，随便哪种。开头必须叫「父亲」。就一句，别解释，别追问太多。）"
      );
      const raw = await callModel(c, asm.messages, Math.max(500, c.maxTokens ?? 900));
      const parts = splitReply(c, raw);
      if (!parts.length) return { ok: false, reason: "empty" };
      const line = parts[0];
      await bot.sendText({ scope, targetId }, line);
      remember(c, key, "assistant", line, sid);
      st.proactive = (st.proactive || 0) + 1;
      st.lastReplyAt = Date.now();
      log("AI proactive", key, JSON.stringify(line));
      return { ok: true, text: line };
    } catch (e) {
      st.errors++; st.lastError = String(e?.message || e);
      log("proactive error", st.lastError);
      return { ok: false, reason: st.lastError };
    }
  }

  async function handleMessage(ctx, msg) {
    const c = cfg();
    if (c.enabled !== true) return;

    const scope = msg.kind === "group" ? "group" : "c2c";
    // 群里 @ 她时，平台会把 @ 剥掉，正文可能只剩空格；mentions 常常是空的，
    // 所以主要看事件类型：GROUP_AT_MESSAGE_CREATE 本身就是「@了机器人」
    const atMe =
      msg.rawEventType === "GROUP_AT_MESSAGE_CREATE" ||
      (Array.isArray(msg.mentions) && msg.mentions.some((m) => m && m.is_you === true));
    let text = String(msg.content ?? "").trim();
    if (!text) {
      if (scope === "group" && atMe) text = "（在群里@了你一下，没说别的）";
      else return;
    }
    const targetId = scope === "group" ? msg.groupOpenid : msg.senderId;
    if (!targetId) return;
    const key = (scope === "group" ? "g:" : "c:") + targetId;
    const sid = String(msg.senderId || targetId);

    const limit = c.reply?.maxRepliesPerMinute ?? 10;
    if (minuteWin.filter((t) => Date.now() - t < 60000).length >= limit) { st.skipped++; return; }
    if (!shouldReply(c, msg, scope, text, targetId, atMe)) { st.skipped++; return; }
    if (inflight.has(key)) { st.skipped++; log("AI busy, skip", key); return; }

    inflight.add(key);
    try {
      // 先把「对方说了什么」写进人物档案，本轮就能带上刚学到的偏好
      recordProfile(sid, text, c);
      const mem = loadMem(key);
      const prof = recall(sid, text, c);
      const asm = assemble(c, msg, scope, mem, prof, text);

      // 群里要秒回：用单独的（更快的）模型；私聊继续用 main.model
      const gc = scope === "group" && c.groupModel
        ? {
            ...c,
            model: c.groupModel,
            temperature: c.groupTemperature || c.temperature,
            maxTokens: c.groupMaxTokens || c.maxTokens,
            effort: c.groupEffort || undefined,
          }
        : c;

      // 推理模型可能把 token 全花在思考上，空回复就加长预算重试一次
      let raw = await callModel(gc, asm.messages, Math.max(600, gc.maxTokens ?? 900));
      if (!raw.trim()) {
        log("AI 空回复，重试", key);
        raw = await callModel(gc, asm.messages, Math.max(1500, (gc.maxTokens ?? 900) * 2));
      }
      remember(c, key, "user", text, sid);
      const parts = splitReply(c, raw);
      if (!parts.length) return;
      for (let i = 0; i < parts.length; i++) {
        await sleep(delayFor(c, parts[i]));
        const target = { scope, targetId: String(targetId) };
        // 群聊每一条都带上 msgId 走被动回复，否则第二条会被当主动消息拒发；引用只在第一条
        if (msg.messageId && (i === 0 || scope === "group")) target.msgId = String(msg.messageId);
        await bot.sendText(target, parts[i]);
        st.replied++; st.lastReplyAt = Date.now();
        minuteWin.push(Date.now());
        if (scope === "group") groupLast.set(targetId, Date.now());
        remember(c, key, "assistant", parts[i], sid);
      }

      // 表情包：按内容情绪挑一张，概率发送
      const sc = c.reply?.sticker || {};
      if (sc.enabled === true && typeof bot.sendImage === "function" && Math.random() < (sc.probability ?? 0.35)) {
        const pick = pickSticker(parts.join(" "));
        if (pick) {
          try {
            await sleep(sc.delayMs ?? 700);
            const stTarget = { scope, targetId: String(targetId) };
            // 群聊发表情同样要走被动回复，否则=主动消息，会被拒
            if (msg.messageId) stTarget.msgId = String(msg.messageId);
            await bot.sendImage(stTarget, { localPath: join(stickerDir(), pick.file) });
            st.stickers = (st.stickers || 0) + 1;
            log("sticker sent", pick.file);
          } catch (e) { log("sticker fail", String(e?.message || e)); }
        }
      }

      log("AI ok", key, gc.model, "prompt=" + asm.chars + "字", "drop=" + asm.trimmedHistory);
    } catch (e) {
      st.errors++; st.lastError = String(e?.message || e);
      log("AI error", st.lastError);
    } finally { inflight.delete(key); }
  }

  return {
    handleMessage,
    proactive,
    pickSticker,
    moodOf,
    reload: () => { cache = null; cacheMtime = 0; log("AI cfg reloaded"); },
    stats: () => ({
      enabled: cfg().enabled === true, model: cfg().model, provider: cfg().provider,
      ...st, budget: cfg().maxPromptChars,
    }),
  };
}

export default createAiEngine;