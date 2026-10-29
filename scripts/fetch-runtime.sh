#!/system/bin/sh
# 获取 Node 运行时：优先从 Termux 复制，其次从指定目录复制
# 用法：sh scripts/fetch-runtime.sh [node所在bin目录]
set -e
DATA=${QQBRIDGE_ROOT:-/data/adb/qqbot_bridge}
ABI=$(getprop ro.product.cpu.abi)
PREFIX=${1:-/data/data/com.termux/files/usr}

echo "- 设备架构: $ABI"
[ "$(id -u)" = "0" ] || { echo "需要 root"; exit 1; }
mkdir -p "$DATA/bin" "$DATA/lib"

if [ ! -x "$PREFIX/bin/node" ]; then
  echo "! 没找到 $PREFIX/bin/node"
  echo "  Termux 里执行：pkg install nodejs-lts"
  echo "  或把已编译好的 node 目录传给本脚本"
  echo "  自编译参考：https://github.com/nodejs/node/blob/main/BUILDING.md（Android/NDK）"
  exit 1
fi

echo "- 复制 node：$("$PREFIX/bin/node" -v)"
cp "$PREFIX/bin/node" "$DATA/bin/node"
chmod 755 "$DATA/bin/node"

# Termux 版 node 依赖这些 so，缺一不可
for so in libc++_shared libcares libcrypto libffi libicudata libicui18n libicuuc libsqlite3 libssl libz; do
  for f in "$PREFIX"/lib/$so.so*; do
    [ -e "$f" ] && cp -L "$f" "$DATA/lib/" 2>/dev/null || true
  done
done

echo "- 自检："
LD_LIBRARY_PATH="$DATA/lib" "$DATA/bin/node" -v || { echo "! 运行失败，检查 lib 目录是否缺 .so"; exit 1; }
echo "- 完成。ARM32/x86_64 同理，只要 node 与 so 是同一架构。"