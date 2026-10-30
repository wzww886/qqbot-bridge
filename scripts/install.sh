#!/system/bin/sh
# 一键安装到 /data/adb/qqbot_bridge（需 root）
# 用法：sh scripts/install.sh [模块目录] [数据目录]
set -e
SRC=$(cd "$(dirname "$0")/.." && pwd)
DATA=${1:-/data/adb/qqbot_bridge}
STATE=${2:-/data/adb/qqbot_bridge_data}

[ "$(id -u)" = "0" ] || { echo "需要 root"; exit 1; }

echo "- 安装到 $DATA"
mkdir -p "$DATA/app" "$DATA/log" "$DATA/bin" "$DATA/lib" "$STATE"

cp "$SRC"/src/*.mjs "$DATA/app/"
cp "$SRC"/src/qq.js "$DATA/qq.js"
cp "$SRC"/module/*.sh "$DATA/"
[ -d "$SRC/src/node_modules" ] && cp -r "$SRC/src/node_modules" "$DATA/app/"

# 配置只在不存在时写入，避免覆盖已有密钥
[ -f "$DATA/app/config.json" ] || cp "$SRC/config/config.example.json" "$DATA/app/config.json"
[ -f "$STATE/ai.json" ] || cp "$SRC/config/ai.example.json" "$STATE/ai.json"
[ -f "$STATE/persona.md" ] || cp "$SRC/config/persona.example.md" "$STATE/persona.md"
[ -f "$STATE/proactive.json" ] || cp "$SRC/config/proactive.example.json" "$STATE/proactive.json"

chmod 755 "$DATA"/*.sh

if [ ! -x "$DATA/bin/node" ]; then
  echo "! 还没有 Node 运行时，先执行：sh scripts/fetch-runtime.sh"
else
  echo "- 启动 watchdog"
  pkill -f watchdog.sh 2>/dev/null
  pkill -f bridge.mjs 2>/dev/null
  nohup sh "$DATA/watchdog.sh" >> "$DATA/log/watchdog.log" 2>&1 &
  sleep 3
  sh "$DATA/qq.sh" st | head -c 300
fi
echo
echo "- 记得填 $DATA/app/config.json 和 $STATE/ai.json"