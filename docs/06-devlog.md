# 开发日志

> 记录每个决策「为什么这么定」，不是变更列表（那是 CHANGELOG）。

## 2026-10-29

### 1. 私聊/群聊分模型

**问题**：`deepseek-v4-pro` 私聊效果好，但群里首字要 4.7 秒，群聊场景没法用。

**决策**：`groupModel` 独立配置，群聊走 `flash`，且**不传 `effort`**（flash 不需要思考档位）。

**实现**：`handleMessage` 里按 `scope` 派生一份配置：

```js
const gc = scope === "group" && c.groupModel
  ? { ...c, model: c.groupModel, maxTokens: c.groupMaxTokens || c.maxTokens, effort: c.groupEffort || undefined }
  : c;
```

**结果**：群聊 3.4s，私聊 4.7s，各自满意。

### 2. 推理模型空回复

**问题**：`max_tokens` 给小了，模型把预算全花在 reasoning 上，`content` 为空。

**决策**：空回复不算错，加长预算重试一次（600 → 1500+）。宁可慢一次，也别装死。

### 3. 「一次说两句」

**问题**：模型天然倾向回一条，性格设定写了也没用。

**决策**：**两层保证**——prompt 层要求「两句之间换行」，代码层 `minSegments: 2`，只给一句就按句内标点劈开。

**坑**：`splitReply` 原逻辑会把短句重新合并（`last.length + p.length <= maxLen`），所以必须在合并**之后**再拆，否则白干。

### 4. 句尾不要句号

**观察**：真人聊天极少打句号，打了就像客服/作文。

**决策**：`stripTrailingPunctuation` 默认开，只清结尾的 `。，、；：`，**保留 `？！…`**——这些是情绪，删了就变面瘫。

**实现细节**：三个 return 分支都要过 `norm()`，漏一个就会出现「有的条带句号、有的不带」。

### 5. 群聊第二条被拒发

**问题**：群里连发两条，第二条报主动消息限额。

**根因**：只有首条带了 `msgId`（引用回复逻辑），第二条变主动消息。

**决策**：群聊**每一条**都带 `msgId`，引用只在首条体现。

```js
if (msg.messageId && (i === 0 || scope === "group")) target.msgId = String(msg.messageId);
```

### 6. 表情包污染相册

**问题**：103 张图放 `/sdcard/Download/...`，全被媒体扫描进相册。

**决策**：`stickerDir` 可配置，实际挪到 `/data/adb/qqbot_bridge/stickers`（不在媒体扫描范围），并留 `.nomedia` 兜底。
代码不再是常量，改为函数每次读配置：

```js
const stickerDir = () => String(cfg().stickerDir || "") || join(stateDir, "stickers");
```

### 7. 群聊「不 @ 也说话」——结论是不可能

**排查**：本地模拟 `GROUP_MESSAGE_CREATE` 事件，规则正常（关键词命中就回）。
但真实链路 `inbox.jsonl` 里**没有这条消息**。

**结论**：QQ 开放平台不推非 @ 群消息，需「群消息」高级权限。这是平台能力边界，不是代码能绕的。
已把「名字/口头禅」加进 `groupKeywords`，权限到位那天即可生效。

> 想彻底解决只能换协议端（NapCat / LLOneBot 挂小号），代价是违规风险与另一套架构，本项目不做。

### 8. 全参数化 + 开源

**动机**：社区有人要模块，干脆开源。

**动作**：
- 三处硬编码（程序目录、数据目录、端口）→ 环境变量 > config.json > 默认值
- 所有密钥脱敏为 `*.example.json`
- 运行时（node + so）不入库，用 `scripts/fetch-runtime.sh` 从 Termux 取
- 系统没有 `zip`，所以写了个零依赖 ZIP 打包器 `scripts/pack.mjs`
- 模块脚本统一 `MODDIR` 探测，兼容 `/data/adb/qqbot_bridge` 与 `/data/adb/modules/qqbot_bridge`

## 关于定位：为什么不用服务器

这项目最早不是「部署方式之一」，而是起点——一台吃灰的旧手机 + 一个 Magisk 模块，把它变成 7×24 常驻的机器人，替掉每月几十块的云主机。

- 手机不需要新硬件，本来就插着电开着机
- 模块 `service.sh` 原生接管开机自启，比在 Android 上折腾 systemd 靠谱
- 有 root 就能管后台、电池白名单、通知栏，不必自己写守护进程
- 数据全在本机 `/data/adb`，不落在别人硬盘上；迁移 = 换机刷模块

代价：要 root、要自备 Node 运行时、单机算力有限（所以群聊走快模型、私聊走好模型）。

同一份代码在 PC 上 `npm start` 也能跑，但主线始终是**模块形态**。

## 设计取舍备忘

| 取舍 | 原因 |
|---|---|
| 记忆分文件（一会话一 json） | 群聊/私聊记忆隔离，避免串台；坏了只坏一个 |
| 摘要压缩而不是全量塞 | prompt 成本是延迟主因，全量 history 会越来越慢 |
| 表情「宁可不发」 | 发错图的社交成本远高于不发 |
| 群聊冷却 120s | 防止刷屏被群友投诉/被平台限流 |
| 看门狗轮询而非 systemd | Android 没有可靠的服务管理，轮询最土但最稳 |
| 主动消息严格限额 | 平台额度有限，超了会静默失败，不如自己先卡住 |