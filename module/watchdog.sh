#!/system/bin/sh
# QQ Bot Bridge — 看门狗：进程掉了就拉起来，日志超 512KB 轮转
MODDIR=${QQBRIDGE_ROOT:-${MODDIR:-/data/adb/qqbot_bridge}}
[ -d "$MODDIR/bin" ] || MODDIR=/data/adb/modules/qqbot_bridge

export LD_LIBRARY_PATH="$MODDIR/lib"
NODE="$MODDIR/bin/node"
APP="$MODDIR/app"
LOG="$MODDIR/log"
mkdir -p "$LOG"

# 低优先级运行，别跟系统抢 CPU
ION=""
command -v ionice >/dev/null 2>&1 && ION="ionice -c 3"
PIN=""
command -v taskset >/dev/null 2>&1 && PIN="taskset 60"

[ -x "$NODE" ] || { echo "[$(date)] FATAL: 运行时缺失 $NODE（见 docs/02-deploy.md）" >> "$LOG/watchdog.log"; exit 1; }

while true; do
  if ! ps -A -o ARGS 2>/dev/null | grep -q '[b]ridge.mjs'; then
    echo "[$(date)] restart bridge" >> "$LOG/watchdog.log"
    cd "$APP" || exit 1
    $ION $PIN nice -n 19 "$NODE" --max-old-space-size=64 --max-semi-space-size=8 bridge.mjs >> "$LOG/bridge.log" 2>&1 &
  fi
  SZ=$(ls -l "$LOG/bridge.log" 2>/dev/null | awk '{print $5}')
  if [ -n "$SZ" ] && [ "$SZ" -gt 524288 ]; then mv -f "$LOG/bridge.log" "$LOG/bridge.log.1"; fi
  sleep 20
done