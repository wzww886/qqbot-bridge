# QQ Bot Bridge · 让 QQ 机器人真的“像个人”

[![version](https://img.shields.io/badge/version-2.1.0-blue.svg)](CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![release](https://img.shields.io/github/v/release/wzww886/qqbot_bridge_oss?label=release)](https://github.com/wzww886/qqbot_bridge_oss/releases)
[![platform](https://img.shields.io/badge/platform-Android%20%7C%20Linux-lightgrey.svg)](docs/04-adaptation.md)

把 **QQ 官方机器人**接到任意 **OpenAI 兼容大模型**（DeepSeek / 通义 / Kimi / 本地 Ollama 都行），
补上官方 SDK 没给你的那部分：**人格记忆、分条回复、表情包、主动消息、看门狗自愈**。

> 面向 Android（Magisk / KernelSU / Termux），也可直接在 PC / 服务器跑，代码是纯 Node ESM。

---

## 特性

| 能力 | 说明 |
|---|---|
| 🧠 人格记忆 | 每会话独立记忆文件，事实提取 + 摘要压缩 + 关键词召回，换话题不忘人 |
| 💬 像人打字 | 一次回复拆 2~3 条，条间随机延迟；结尾不带句号，保留问号感叹号 |
| 🐋 表情包 | 按情绪（委屈/生气/开心/困）挑图，只发匹配情绪的图，不发错就不发 |
| ⏰ 主动消息 | 空闲 N 小时后自己找你，有每日上限与免打扰时段 |
| 🛡️ 自愈 | watchdog 每 20s 巡检，进程挂了自动拉起；连不上 90s 自杀重启 |
| 🔌 双模型 | 私聊走高质模型，群聊走快模型（`groupModel`），互不拖累 |
| 🎛️ 全参数可调 | 路径、端口、模型、延迟、概率、限流、免打扰……全在 JSON 里 |
| 🧩 零依赖部署 | 运行时不内置，从 Termux 复制或自编译，多架构通用 |

## 快速开始

模块包：**[Releases 下载 `qqbot_bridge-v2.1.0.zip`](https://github.com/wzww886/qqbot_bridge_oss/releases/latest)**，Magisk / KernelSU 直接刷，或解压到 `/data/adb/modules/qqbot_bridge`。

```bash
# 1. 放到设备上（需 root）
unzip qqbot_bridge-v2.1.0.zip -d /data/adb/modules/qqbot_bridge   # 或手动拷

# 2. 准备 Node 运行时（不内置，约 50MB）
sh /data/adb/qqbot_bridge/scripts/fetch-runtime.sh

# 3. 填配置
vi /sdcard/Download/Operit/plugins/qqbot_bridge/ai.json      # 模型 key
vi /data/adb/qqbot_bridge/app/config.json                    # QQ appId / appSecret

# 4. 起来
sh /data/adb/qqbot_bridge/watchdog.sh &
sh /data/adb/qqbot_bridge/qq.sh st
```

## 在 PC / 服务器上跑（不用 Magisk）

```bash
git clone https://github.com/wzww886/qqbot_bridge_oss.git
cd qqbot_bridge_oss
npm install                      # 依赖：@tencent-connect/qqbot-nodejs + ws
cp config/ai.example.json       ~/.config/qqbot/ai.json
cp config/config.example.json   ~/.config/qqbot/config.json
QQBRIDGE_ROOT=$PWD QQBRIDGE_STATE=~/.config/qqbot npm start
```

打模块包（任意有 node 的机器，不需要 `zip` 命令）：

```bash
npm run pack        # → dist/qqbot_bridge-v2.1.0.zip
```

## 目录结构

```
qqbot_bridge/
├── app/        ai.mjs（AI 引擎） bridge.mjs（QQ 接入 + HTTP API） node_modules
├── bin/node    运行时（自备）
├── lib/        运行时依赖 so（自备）
├── log/        bridge.log / watchdog.log
└── qq.js       CLI：st / inbox / send / shutdown
```

## 文档

| 文档 | 内容 |
|---|---|
| [docs/01-architecture.md](docs/01-architecture.md) | 数据流、模块职责、HTTP API |
| [docs/02-deploy.md](docs/02-deploy.md) | 从零部署、QQ 平台配置、获取 Node |
| [docs/03-config.md](docs/03-config.md) | **全部参数逐条说明** |
| [docs/04-adaptation.md](docs/04-adaptation.md) | 多设备/多架构适配、无 root 方案 |
| [docs/05-faq.md](docs/05-faq.md) | 踩过的坑：群消息收不到、被动回复、限流… |
| [docs/06-devlog.md](docs/06-devlog.md) | 开发日志：每个决策为什么这么定 |

## 已知限制（先看再装）

- **群里不 @ 她收不到消息**：QQ 开放平台默认只推 `GROUP_AT_MESSAGE_CREATE`，非 @ 消息需「群消息」高级权限。**这不是 bug，是平台权限。**
- 群内每条回复必须带 `msgId` 走被动回复，否则被拒；单条消息最多回 5 条。
- 主动消息有每日额度限制，`proactive.json` 里别把上限开太大。
- 仓库**不含** node 二进制与表情包素材（体积 / 版权原因）。

## 免责

非官方项目，与腾讯、DeepSeek 无关。请遵守 QQ 开放平台规则与当地法规；被风控、封号、Key 泄漏等后果自负。
人格原型出自社区创作（上善无形 / ZipZipPipe / DeepSeek），本项目仅作技术演示。

MIT License