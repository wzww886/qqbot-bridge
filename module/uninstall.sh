#!/system/bin/sh
# 卸载清理：杀进程、停看门狗；数据目录默认保留（免得误删记忆）
ps -A -o PID,ARGS 2>/dev/null | grep '[b]ridge.mjs' | awk '{print $1}' | xargs -r kill -9 2>/dev/null
ps -A -o PID,ARGS 2>/dev/null | grep '[w]atchdog.sh' | awk '{print $1}' | xargs -r kill 2>/dev/null
echo "- 进程已停止。数据保留在 /data/adb/qqbot_bridge（含记忆/表情包），需要彻底清理请手动删除。"
