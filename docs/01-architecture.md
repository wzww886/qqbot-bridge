# 架构

## 一句话

`QQ 官方 SDK（WebSocket 长连） → bridge.mjs → ai.mjs（记忆 + 提示词 + 调用大模型） → 拆条 → 回发`。

## 进程与文件

```
┌──────────────┐   WebSocket    ┌───────────────┐   HTTPS    ┌──────────────┐
│ QQ 开放平台   │ ─────────────▶ │ bridge.mjs    │ ─────────▶ │ 大模型 API    │
│ (机器人)      │ ◀───────────── │ (接入+调度)    │ ◀───────── │ OpenAI 兼容   │
└──────────────┘  发消息/收事件   └───────┬───────┘            └──────────────┘
                                          │ 调用
                                   ┌──────▼───────┐
                                   │ ai.mjs       │
                                   │ 记忆/提示词/  │
                                   │ 分句/表情/主动 │
                                   └──────┬───────┘
                                          │ 落盘
                     ┌────────────────────┼────────────────────┐
                     ▼                    ▼                    ▼
              memory/*.json          diary/*.md          stickers/index.json
              (事实/摘要/规则)        (日记)              (表情索引)
```

### bridge.mjs（接入层，约 160 行）
- 用 `@tencent-connect/qqbot-nodejs` 建立长连，监听 `message` 事件
- 事件落 `inbox.jsonl`（JSONL，一行一条，便于 grep / 回放）
- 防自环：自己发的消息不处理
- 判断 `atMe`：`GROUP_AT_MESSAGE_CREATE` 或 mentions 里 `is_you === true`
- HTTP API（只监听 `127.0.0.1`）、主动消息定时器、健康检查（90s 连不上自杀交给 watchdog）

### ai.mjs（引擎层，约 580 行）
| 模块 | 职责 |
|---|---|
| `cfg()` | 读 `ai.json`，按 mtime 缓存，改完 `POST /ai/reload` 或等下次自动重载 |
| `assemble()` | 拼提示词：人格 + 规则 + 记忆摘要 + 事实 + 召回 + 近 N 轮对话 + 当前消息；超 `maxPromptChars` 从最旧的开始丢 |
| `handleMessage()` | 主流程：限流 → 静默时段 → 是否该回 → 拼 prompt → 调模型 → 拆条 → 延迟发送 → 写记忆（异步压缩） |
| `splitReply()` | 按换行/长度/标点切分；`minSegments` 保证至少两条；`stripTrailingPunctuation` 去句尾句号 |
| `pickSticker()` | 正则判情绪 → 取该情绪的 tag → 从索引里随机选图，宁可不发也不发错 |
| `proactive()` | 空闲触发主动消息，受每日上限/最小间隔/免打扰约束 |
| `remember()` / `compress()` | 写历史；每 `compressEvery` 条压缩一次摘要，抽取事实与规则 |

## HTTP API

监听 `127.0.0.1:32146`（`config.json` 的 `port` 或 `QQBRIDGE_PORT`）。

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/status` | 运行状态：连接、PID、事件数、AI 统计 |
| GET | `/messages?consume=1` | 读 inbox；`consume=1` 读完清空 |
| POST | `/ai/reload` | 热加载 `ai.json` |
| POST | `/proactive` | 手动触发一次主动消息 `{scope,targetId,senderName}` |
| POST | `/send` | 发文本 `{scope,targetId,content,msgId?}` |
| POST | `/sendimage` | 发图 `{scope,targetId,file,msgId?}` |
| GET | `/shutdown` | 退出（watchdog 会拉起，慎用） |

`scope` 取 `c2c`（私聊）或 `group`（群，`targetId` 填群 openid）。

## 数据目录

默认 `stateDir = /data/adb/qqbot_bridge_data`（`config.json` 可改）：

```
ai.json            模型与行为配置
persona.md         人格
proactive.json     主动消息配置
inbox.jsonl        所有收到的消息
memory/            每会话一个 json（c_ 私聊 / g_ 群）
diary/             日记
profile/           用户画像
```

> 改 `stateDir` 后记得把 `ai.json`、`persona.md` 一起搬过去，并同步 `stickerDir`。