# 配置说明

三份配置，改完大多**不用重启**（`ai.json` 支持热加载：`curl -X POST 127.0.0.1:32146/ai/reload`）。

## 一、config.json（接入层，放 `app/` 目录）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `appId` | string | — | QQ 开放平台机器人 AppID |
| `appSecret` | string | — | QQ 开放平台 AppSecret（**别提交到仓库**） |
| `port` | number | 32146 | 本地 HTTP API 端口，仅监听 127.0.0.1 |
| `stateDir` | string | 空 | 数据目录，留空用 `/data/adb/qqbot_bridge_data` |

## 二、ai.json（行为层，放 `stateDir`）

### 模型

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 总开关，false 时只记录不回复 |
| `provider` | `deepseek` | 仅展示用，实际请求走 `baseUrl` |
| `baseUrl` | — | OpenAI 兼容地址，**不要带** `/chat/completions` |
| `apiKey` | — | 模型 Key |
| `model` | `deepseek-chat` | 私聊/主模型 |
| `temperature` | 1.2 | 越大越放飞 |
| `maxTokens` | 160 | 主模型回复预算；小会导致只思考不说话 |
| `effort` | 空 | 推理档位（DeepSeek v4 系支持 `low/high/max`），空=不传 |
| `timeoutMs` | 60000 | 单次请求超时 |

### 群聊专用（把群聊从私聊里摘出来，避免互相拖慢）

| 字段 | 默认 | 说明 |
|---|---|---|
| `groupModel` | 空 | 群聊模型；留空则复用 `model` |
| `groupMaxTokens` | 0 | 群聊回复预算，0=复用 `maxTokens` |
| `groupTemperature` | 0 | 0=复用 `temperature` |
| `groupEffort` | 空 | 群聊推理档位 |

> 实测：私聊 `v4-pro` 首条约 4.7s，群聊 `flash` 约 3.4s（prompt 2246 字）。

### 提示词与记忆

| 字段 | 默认 | 说明 |
|---|---|---|
| `personaFile` | `persona.md` | 人格文件名，相对 `stateDir` |
| `ownerIds` | `[]` | 主人 openid 列表，命中则按「主人」对待 |
| `contextTurns` | 14 | 带多少轮历史进 prompt |
| `maxPromptChars` | 6000 | prompt 总字数上限，超了从最旧历史开始丢 |
| `summaryEvery` | 0 | >0 时每 N 轮强制总结一次 |
| `memory.summaryChars` | 600 | 记忆摘要目标长度 |
| `memory.compressEvery` | 12 | 每 N 条压缩一次历史 |
| `memory.factsLimit` | 40 | 事实条目上限 |
| `memory.recall` | 3 | 每次召回几条相关记忆 |
| `memory.rulesLimit` | 20 | 规则条目上限 |
| `memory.diary` | true | 是否写日记 |

### 回复行为（`reply`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `maxSegments` | 3 | 最多拆几条 |
| `minSegments` | 1 | 至少几条；**设 2 就是「一句拆两句」**，模型只给一句时按句内标点自动切 |
| `maxCharsPerSegment` | 55 | 单条上限，超出按标点找切口 |
| `stripTrailingPunctuation` | true | 去掉每条结尾的 `。，、；：`，保留 `？！…` |
| `delay.min` | 500 | 每条发送前基础延迟 ms |
| `delay.perChar` | 55 | 每字追加延迟 ms |
| `delay.max` | 3000 | 单条延迟上限 |
| `privateAlways` | true | 私聊必回 |
| `privateProbability` | 1 | 私聊回复概率（1=全回） |
| `groupMode` | `mention` | `mention`=@或关键词；`keyword`=只关键词；`all`=全回；`random`=纯概率 |
| `groupKeywords` | 数组 | 群内命中即回的词，如「鱼」「白饭」 |
| `groupProbability` | 0.15 | 非 @ 群消息的搭话概率 |
| `groupCooldownSec` | 120 | 同一个群两次主动搭话的最小间隔 |
| `quoteReply` | true | 首条是否引用回复 |
| `stripMarkdown` | true | 清洗模型输出的 Markdown |
| `forbidAIClaim` | true | 禁止自称 AI/模型 |
| `maxRepliesPerMinute` | 10 | 每分钟最多发几条 |
| `sticker.enabled` | false | 表情包开关（需 `stickerDir` 有索引） |
| `sticker.probability` | 0.4 | 触发概率 |
| `sticker.delayMs` | 700 | 文字后延迟多少再发图 |

### 免打扰（`quietHours`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | true | 开关 |
| `start` / `end` | `01:30` / `07:30` | 支持跨零点（start > end） |
| `privateStillReply` | true | 静默时段私聊是否仍回 |

### 表情包目录

| 字段 | 默认 | 说明 |
|---|---|---|
| `stickerDir` | 空 | 留空= `stateDir/stickers`；建议放 `/data/adb/qqbot_bridge/stickers`，不会被相册扫描 |

`index.json` 格式：

```json
[{ "file": "xxx.png", "tags": ["委屈", "难过"], "alt": "描述", "sizeKb": 1542 }]
```
`tags` 决定情绪匹配；没有匹配情绪的图宁可不发。

## 三、proactive.json（主动消息）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | false | 开关 |
| `maxPerDay` | 3 | 每日上限（0=不限） |
| `minGapMin` | 240 | 两次主动消息最小间隔（分钟） |
| `idleMin` | 120 | 多久没人说话才触发 |
| `quietHours.start/end` | — | 免打扰时段 |
| `target.scope` / `target.targetId` | — | 发给谁；留空则用最近一个私聊对象 |
| `senderName` | 父亲 | 提示词里对用户的称呼 |

## 四、环境变量

| 变量 | 作用 |
|---|---|
| `QQBRIDGE_ROOT` | 程序根目录（默认 `/data/adb/qqbot_bridge`） |
| `QQBRIDGE_STATE` | 数据目录，覆盖 `stateDir` |
| `QQBRIDGE_CONFIG` | 直接指定 `config.json` 路径 |
| `QQBRIDGE_PORT` | 覆盖 HTTP 端口 |
| `QQBRIDGE_API` | `qq.js` 请求的地址（默认 `http://127.0.0.1:32146`） |
| `QQBRIDGE_PROACTIVE_STATE` | 主动消息计数文件位置 |

优先级：**环境变量 > config.json > 内置默认值**。