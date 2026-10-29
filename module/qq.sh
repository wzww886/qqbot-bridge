#!/system/bin/sh
# QQ Bot Bridge — CLI 入口（状态查询/收发测试）
# 用法：sh qq.sh st | inbox [consume] | send <scope> <targetId> <msgId|-> <text>
MODDIR=${QQBRIDGE_ROOT:-${MODDIR:-/data/adb/qqbot_bridge}}
[ -d "$MODDIR/bin" ] || MODDIR=/data/adb/modules/qqbot_bridge

export LD_LIBRARY_PATH="$MODDIR/lib"
exec "$MODDIR/bin/node" "$MODDIR/qq.js" "$@"