// 零依赖 ZIP 打包器（store 模式，不压缩）：用于生成 Magisk 模块包
// 用法：node scripts/pack.mjs <源目录> <输出.zip> [--exclude=a,b]
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";

const [src, out, ...flags] = process.argv.slice(2);
if (!src || !out) { console.error("usage: node pack.mjs <dir> <out.zip> [--exclude=a,b]"); process.exit(1); }
const ex = new Set((flags.find((f) => f.startsWith("--exclude=")) || "").replace("--exclude=", "").split(",").filter(Boolean));

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), rel = relative(base, p).replace(/\\/g, "/");
    if ([...ex].some((e) => rel === e || rel.startsWith(e + "/"))) continue;
    const s = statSync(p);
    if (s.isDirectory()) walk(p, base, acc); else acc.push({ p, rel, s });
  }
  return acc;
}

const files = walk(src);
const locals = [], centrals = [];
let offset = 0;
for (const f of files) {
  const data = readFileSync(f.p);
  const name = Buffer.from(f.rel, "utf8");
  const crc = crc32(data);

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
  lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
  locals.push(lh, name, data);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
  ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
  ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
  centrals.push(ch, name);

  offset += lh.length + name.length + data.length;
}
const cd = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([...locals, cd, eocd]));
console.log(`OK ${out}  ${files.length} files  ${(statSync(out).size / 1024).toFixed(1)} KB`);