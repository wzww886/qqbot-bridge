#!/system/bin/sh
# 导入表情包：扫描图片目录 → 生成 index.json（tags 从文件名推断，可后续手改）
# 用法：sh scripts/import-stickers.sh <图片目录> [目标目录]
set -e
FROM=${1:?用法: import-stickers.sh <图片目录> [目标目录]}
TO=${2:-${QQBRIDGE_ROOT:-/data/adb/qqbot_bridge}/stickers}
NODE_BIN=${NODE_BIN:-$(dirname "$0")/../bin/node}
[ -x "$NODE_BIN" ] || NODE_BIN=node

mkdir -p "$TO"
echo "- 索引目录：$TO"
"$NODE_BIN" - "$FROM" "$TO" <<'EOF'
import { readdirSync, writeFileSync, statSync, existsSync, readFileSync } from "node:fs";
const [from, to] = process.argv.slice(2);
const exts = /\.(png|jpe?g|gif|webp)$/i;
const idxPath = to + "/index.json";
let old = [];
try { old = JSON.parse(readFileSync(idxPath, "utf8")); } catch {}
const oldMap = new Map(old.map((o) => [o.file, o]));
const files = readdirSync(from).filter((f) => exts.test(f));
const out = [];
for (const f of files) {
  if (oldMap.has(f)) { out.push(oldMap.get(f)); continue; }
  const tags = f.replace(exts, "").split(/[-_]/).slice(-3).filter((s) => s && !/^\d+$/.test(s));
  out.push({ file: f, tags, alt: f.replace(exts, ""), sizeKb: Math.round(statSync(from + "/" + f).size / 1024) });
}
writeFileSync(idxPath, JSON.stringify(out, null, 1));
console.log(`- 索引 ${out.length} 条（新增 ${out.length - old.length}），标签请按需手改 ${idxPath}`);
EOF
echo "- 图片本身请复制到 $TO（脚本只建索引，不动图片）"
echo "  例：cp $FROM/*.png $TO/"