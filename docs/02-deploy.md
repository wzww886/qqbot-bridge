# 部署

## 0. 前置

| 需要 | 说明 |
|---|---|
| QQ 机器人 | [q.qq.com](https://q.qq.com) 创建，拿到 `appId` / `appSecret`，开启「私聊」能力 |
| 大模型 API Key | 任意 OpenAI 兼容接口（DeepSeek、通义、Kimi、Ollama…） |
| Node 运行时 | **本仓库不内置**，见第 2 步 |
| root | 走 Magisk/KernelSU 时需要；用 Termux 或 PC 跑则不需要 |

## 1. 装文件

### 方式 A：Magisk / KernelSU 模块（推荐）
下载 release 里的 `qqbot_bridge-v2.1.0.zip`，Magisk/KernelSU 里直接刷入。
`customize.sh` 会检查架构、创建数据目录、不改动你已有的配置。

### 方式 B：手动
```bash
mkdir -p /data/adb/qqbot_bridge/{app,bin,lib,log}
cp src/*.mjs /data/adb/qqbot_bridge/app/
cp src/qq.js /data/adb/qqbot_bridge/
cp module/*.sh /data/adb/qqbot_bridge/
cp -r src/node_modules /data/adb/qqbot_bridge/app/
chmod 755 /data/adb/qqbot_bridge/*.sh
```

### 方式 C：一键脚本
```bash
sh scripts/install.sh /data/adb/qqbot_bridge
```

## 2. 获取 Node 运行时

> 本仓库**不含** node 二进制：50MB+，且必须与设备 ABI 匹配。

### Android + Termux（最省事）
```bash
# Termux 里
pkg install nodejs-lts
# 然后（root shell）
sh /data/adb/qqbot_bridge/scripts/fetch-runtime.sh
```
脚本会复制 `node` 与依赖的 `.so`（libcares、libcrypto、libicu*、libssl、libsqlite3、libffi、libz、libc++_shared）。

### 没有 Termux / 想更小
用 Node 官方 Android 交叉编译产物或 termux-packages 的 `nodejs-lts` 包，解包后把 `node` 丢进 `bin/`、依赖 so 丢进 `lib/`。
要求：**node ≥ 20**，ELF 与设备 ABI 一致（`arm64-v8a` / `armeabi-v7a` / `x86_64`）。

### 自检
```bash
LD_LIBRARY_PATH=/data/adb/qqbot_bridge/lib /data/adb/qqbot_bridge/bin/node -v
# 期望：v20.x 或 v22/v26.x
```
报 `CANNOT LINK EXECUTABLE` → 缺 so，回看第 2 步。

## 3. 填配置

```bash
# QQ 凭据
vi /data/adb/qqbot_bridge/app/config.json
# {"appId":"你的","appSecret":"你的","port":32146,"stateDir":""}

# 模型与行为
vi /data/adb/qqbot_bridge_data/ai.json
# baseUrl / apiKey / model / ownerIds 这四项必须改
```

`ownerIds` 填你自己的 openid（在 `inbox.jsonl` 里看 `senderId`，或先随便发一条再从 `/messages` 读）。

## 4. 启动

```bash
sh /data/adb/qqbot_bridge/watchdog.sh >> /data/adb/qqbot_bridge/log/watchdog.log 2>&1 &

# 验证
sh /data/adb/qqbot_bridge/qq.sh st
# 看到 "connected":true 就成了
```

Magisk 用户重启手机即由 `service.sh` 自动拉起（已 sleep 30s 等网络）。

## 5. QQ 平台侧

1. 开发设置 → 记录 `AppID` / `AppSecret`
2. 功能配置 → 开启「私聊」，群聊按需
3. 沙箱配置 → 把自己加进体验成员
4. 若走正式环境，需按平台要求提交审核

> **群聊限制**：默认只推「@机器人」事件。想要群里不 @ 也接话，需要申请「群消息」权限，详见 [05-faq.md](05-faq.md)。

## 6. 日志与排错

```bash
tail -f /data/adb/qqbot_bridge/log/bridge.log     # 主日志（>512KB 自动轮转）
tail -f /data/adb/qqbot_bridge/log/watchdog.log   # 只有重启记录
sh qq.sh inbox | tail -3                          # 最近收到的消息
```