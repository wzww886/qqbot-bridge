#!/system/bin/sh
# Magisk / KernelSU 安装阶段执行
SKIPUNZIP=0

ui_print "**************************************"
ui_print "  QQ Bot Bridge — QQ 机器人接大模型"
ui_print "**************************************"

ABI=$(getprop ro.product.cpu.abi)
ui_print "- 当前设备架构: $ABI"

# 运行时检查：本模块不内置 node 二进制（50MB+，且需与 ABI 匹配）
if [ -f "$MODPATH/bin/node" ]; then
  ui_print "- 已内置 Node 运行时"
else
  case "$ABI" in
    arm64-v8a) ui_print "- 未内置运行时，arm64 需自备：见 docs/02-deploy.md「获取 Node」" ;;
    *)         ui_print "! ABI=$ABI，需按文档自行准备对应架构的 node + so" ;;
  esac
fi

# 保留用户配置：老版本数据目录不动
DATA=/data/adb/qqbot_bridge
if [ -d "$DATA" ]; then
  ui_print "- 检测到已有数据目录，保留配置不动"
else
  mkdir -p "$DATA/app" "$DATA/log" "$DATA/bin" "$DATA/lib"
  ui_print "- 已创建 $DATA"
fi

# 脚本可执行位
set_perm_recursive "$MODPATH" 0 0 0755 0644
for f in "$MODPATH"/*.sh; do [ -f "$f" ] && set_perm "$f" 0 0 0755; done

ui_print "- 安装完成。首次使用请编辑 config.json 与 ai.json"
ui_print "- 重启后自动拉起，或手动：sh $DATA/watchdog.sh &"
