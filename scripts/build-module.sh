#!/bin/sh
# 一键打模块包（无需 zip 命令，用自带的零依赖 pack.mjs）
# 用法：sh scripts/build-module.sh   → 产物 dist/qqbot_bridge-v<版本>.zip
# 依赖：node（Ubuntu / Termux / PC 均可，纯 JS 无需编译）
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
VER=$(grep -m1 '^version=' "$ROOT/module/module.prop" | cut -d= -f2 | sed 's/^[vV]//')
[ -n "$VER" ] || VER=2.1.0
OUT="$ROOT/dist/qqbot_bridge-v$VER.zip"
STAGE=$(mktemp -d)

mkdir -p "$STAGE/config" "$ROOT/dist"

# app/：源码 + 依赖库（模块运行时用，不从 npm 拉，离线可用）
cp -a "$ROOT/src" "$STAGE/app"

# 模块根：Magisk / KernelSU 需要的文件必须平铺在 zip 根
cp "$ROOT/module/module.prop" "$ROOT/module/customize.sh" "$ROOT/module/service.sh" \
   "$ROOT/module/uninstall.sh" "$ROOT/module/qq.sh" "$ROOT/module/watchdog.sh" "$STAGE/"

# CLI 也放根，方便 sh qq.sh 的兄弟 node qq.js 直接可用
cp "$ROOT/src/qq.js" "$STAGE/qq.js"

# 示例配置（真实配置不入包，首次启动由 customize.sh 生成）
cp "$ROOT"/config/*.example.* "$STAGE/config/" 2>/dev/null || true
cp "$ROOT/config/persona.example.md" "$STAGE/config/" 2>/dev/null || true

node "$ROOT/scripts/pack.mjs" "$STAGE" "$OUT"
rm -rf "$STAGE"
echo "打包完成：$OUT ($(du -h "$OUT" | cut -f1))"