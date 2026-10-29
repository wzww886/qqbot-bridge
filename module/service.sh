#!/system/bin/sh
# Magisk/KernelSU 开机自启
MODDIR=${0%/*}

# 等系统联网、存储挂载完成，否则第一次连接必失败
sleep 30

export QQBRIDGE_ROOT="/data/adb/qqbot_bridge"
[ -d "$QQBRIDGE_ROOT/bin" ] || QQBRIDGE_ROOT="$MODDIR"
export LD_LIBRARY_PATH="$QQBRIDGE_ROOT/lib"

mkdir -p "$QQBRIDGE_ROOT/log"
nohup sh "$QQBRIDGE_ROOT/watchdog.sh" >> "$QQBRIDGE_ROOT/log/watchdog.log" 2>&1 &
