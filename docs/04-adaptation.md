# 多设备适配

## 支持矩阵

| 环境 | 状态 | 说明 |
|---|---|---|
| Android + Magisk（arm64） | ✅ 已验证 | 本项目原始运行环境（Node v26.12.1, NDK r30, min API 24） |
| Android + KernelSU / APatch | ✅ 理论可用 | 模块结构相同，`service.sh` 走标准 Magisk 生命周期 |
| Android + Termux | ✅ 可用 | 不需要 root，`pkg install nodejs-lts` 后直接跑 |
| Android arm64 低版本（< 7.0） | ⚠️ 需自编 | 当前运行时要求 API 24+ |
| Android armeabi-v7a | ⚠️ 未验证 | 需自行准备 arm32 node + so，代码无架构假设 |
| Android x86_64（模拟器） | ⚠️ 未验证 | 同上 |
| Linux / Windows / macOS | ✅ 可用 | 纯 Node ESM，无 Android 依赖；改 `stateDir` 到本地路径即可 |
| 群晖 / 软路由 / 树莓派 | ✅ 可用 | 同上，Node ≥ 20 |

## 适配要点

### 1. 三处硬编码已全部参数化

| 原值 | 现在 |
|---|---|
| `/data/adb/qqbot_bridge` | `QQBRIDGE_ROOT` / `MODDIR` / 自动探测 `/data/adb/modules/qqbot_bridge` |
| `/sdcard/.../qqbot_bridge` | `QQBRIDGE_STATE` / `config.json:stateDir` / config 所在目录 |
| `127.0.0.1:32146` | `QQBRIDGE_PORT` / `config.json:port` |

脚本里统一写法：
```sh
MODDIR=${QQBRIDGE_ROOT:-${MODDIR:-/data/adb/qqbot_bridge}}
[ -d "$MODDIR/bin" ] || MODDIR=/data/adb/modules/qqbot_bridge
```

### 2. 运行时（node + so）怎么换

代码与架构无关，**唯一与架构绑定的就是 `bin/node` 和 `lib/*.so`**：

```bash
$QQBRIDGE_ROOT/bin/node          # 可执行，与设备同 ABI
$QQBRIDGE_ROOT/lib/*.so          # node 依赖的全部动态库
```

获取方式：
- **Termux**：`pkg install nodejs-lts`，然后 `sh scripts/fetch-runtime.sh`
- **解包**：从 termux-packages 的 `.deb` 取 `files/usr/bin/node` 与 `files/usr/lib/*.so`
- **自编译**：Node 官方 `BUILDING.md` + Android NDK

### 3. 不同架构注意点

| ABI | 注意 |
|---|---|
| `arm64-v8a` | 最常见；本项目验证环境 |
| `armeabi-v7a` | 需 32 位 node；内存上限低，建议 `--max-old-space-size=48` |
| `x86_64` | 模拟器/Chromebook；注意 linker 与 glibc 差异 |
| `riscv64` | 无官方产物，需自编 |

`watchdog.sh` 已按可用性自动降级，缺 `ionice`/`taskset` 也不报错：
```sh
command -v ionice >/dev/null && ION="ionice -c 3"
command -v taskset >/dev/null && PIN="taskset 60"
```

### 4. 无 root 方案

Termux 里直接跑：
```bash
pkg install nodejs-lts
git clone <本仓库> && cd qqbot-bridge/src
npm install --omit=dev
QQBRIDGE_STATE=$HOME/qqbot-state node bridge.mjs
```
配合 `termux-wake-lock` 防杀，开机自启用 `Termux:Boot`。

### 5. 资源占用（arm64 实测）

| 指标 | 数值 |
|---|---|
| 常驻内存 | 约 40–60MB（`--max-old-space-size=64`） |
| CPU | 空闲近 0，回复时瞬时占用 |
| 磁盘 | 程序 2MB + 运行时 ~96MB + 表情包自定 |
| 并发 | 单进程串行，群内高频请调 `maxRepliesPerMinute` |

## 适配检查清单

- [ ] `bin/node -v` 能跑（`LD_LIBRARY_PATH` 指对）
- [ ] `node --check app/ai.mjs` 通过
- [ ] `config.json` 的 `stateDir` 在可写分区
- [ ] `qq.sh st` 返回 `connected:true`
- [ ] 手机重启后进程还在（看 `log/watchdog.log`）