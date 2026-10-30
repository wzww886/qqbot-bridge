// GitHub 发布器：把本目录推到指定仓库（存在则逐文件更新）
// 用法：
//   GITHUB_TOKEN=ghp_xxx GITHUB_REPO=用户名/仓库名 node scripts/publish.mjs [--create]
// --create：仓库不存在时自动创建（public）
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPO;
if (!TOKEN || !REPO) { console.error("需要 GITHUB_TOKEN 和 GITHUB_REPO=owner/name"); process.exit(1); }
const [owner, name] = REPO.split("/");
const ROOT = process.cwd();
const API = "https://api.github.com";
const HEAD = {
  authorization: "Bearer " + TOKEN,
  accept: "application/vnd.github+json",
  "user-agent": "qqbot-bridge-publisher",
  "x-github-api-version": "2022-11-28",
};

const IGNORE = new Set([".git", "node_modules", ".DS_Store", "Thumbs.db"]);
function walk(dir, base = dir, acc = []) {
  for (const n of readdirSync(dir)) {
    // 日志、备份、临时文件不入库
    if (IGNORE.has(n) || /\.(log|bak|tmp|zip\.tmp)$/i.test(n)) continue;
    const p = join(dir, n), rel = relative(base, p).replace(/\\/g, "/");
    if (statSync(p).isDirectory()) walk(p, base, acc); else acc.push({ p, rel });
  }
  return acc;
}

async function api(path, method = "GET", body) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(API + path, { method, headers: HEAD, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text();
      let j = null; try { j = JSON.parse(t); } catch {}
      return { ok: r.ok, status: r.status, data: j, text: t };
    } catch (e) {
      lastErr = e;
      if (attempt < 3) {
        console.log(`  ! 网络错误（${e.cause?.code || e.message}），第 ${attempt} 次重试…`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
  throw lastErr;
}

// 1) 仓库是否存在
let got = await api(`/repos/${owner}/${name}`);
if (!got.ok && process.argv.includes("--create")) {
  const c = await api("/user/repos", "POST", { name, description: "QQ 官方机器人接任意 OpenAI 兼容大模型", private: false, has_issues: true });
  if (!c.ok) { console.error("创建仓库失败:", c.status, c.text.slice(0, 200)); process.exit(1); }
  console.log("- 已创建仓库", REPO);
  got = { ok: true };
} else if (!got.ok) {
  console.error(`仓库 ${REPO} 不存在或无权访问（${got.status}）。加 --create 自动创建。`);
  process.exit(1);
}

// 2) 逐文件提交
const files = walk(ROOT).filter((f) => !f.rel.startsWith("dist/") || f.rel.endsWith(".zip"));
console.log(`- 待上传 ${files.length} 个文件`);
let ok = 0, fail = 0;
for (const f of files) {
  const content = readFileSync(f.p).toString("base64");
  // 已存在则取 sha，避免 422
  let sha;
  const head = await api(`/repos/${owner}/${name}/contents/${encodeURIComponent(f.rel).replace(/%2F/g, "/")}`);
  if (head.ok && head.data?.sha) sha = head.data.sha;
  const res = await api(`/repos/${owner}/${name}/contents/${encodeURIComponent(f.rel).replace(/%2F/g, "/")}`, "PUT", {
    message: `chore: sync ${f.rel}`,
    content,
    ...(sha ? { sha } : {}),
  });
  if (res.ok) { ok++; process.stdout.write("."); }
  else { fail++; console.error(`\n! ${f.rel} → ${res.status} ${res.text.slice(0, 120)}`); }
}
console.log(`\n- 完成：成功 ${ok}，失败 ${fail}`);
console.log(`- 仓库地址：https://github.com/${owner}/${name}`);