# FAQ / 踩坑记录

## 群聊相关

### Q：群里不 @ 她，她完全不说话？

**平台限制，不是 bug。**

QQ 开放平台默认只推 `GROUP_AT_MESSAGE_CREATE`（@机器人）事件给机器人。
群里其他人正常聊天产生的是 `GROUP_MESSAGE_CREATE`，**需要「群消息」高级权限**才会推送，个人主体基本申请不下来。

验证方法：`sh qq.sh inbox | tail -5`，如果非 @ 的消息**一条都没有**，就是没推过来。
（如果推过来了但没回，那才是 `groupMode` / `groupProbability` 的问题。）

### Q：群聊回复发一条，第二条失败？

群消息必须走**被动回复**：每条都要带 `msgId`。
本项目 `v2.1.0` 起已让群里每一条都带 `msgId`，老版本只有第一条带，所以第二条会被当主动消息拒掉。

另外单条用户消息最多回 5 条，`reply.maxSegments` 别超过 5。

### Q：群里太吵，怎么让她闭嘴？

```json
"groupMode": "keyword",
"groupKeywords": ["鱼", "白饭"],
"groupProbability": 0
```

## 回复质量

### Q：她只回“在”一个字 / 回空？

- 推理模型可能把 token 花在思考上 → 调大 `maxTokens`（≥600）
- 代码里已有兜底：空回复自动加长预算重试一次
- 看她是不是被 `maxRepliesPerMinute` 限流

### Q：怎么让她一次说两句？

```json
"reply": { "minSegments": 2, "maxSegments": 3 }
```
模型只给一句时，会按句内标点自动切成两条。再配合 `persona.md` 里写「先答他，再补一句自己的」。

### Q：结尾的句号怎么去掉？

`"stripTrailingPunctuation": true`（默认开）。去掉 `。，、；：`，保留 `？！…`。

### Q：回复太慢？

| 位置 | 动作 |
|---|---|
| 群聊 | 设 `groupModel` 为快模型（如 `flash`） |
| prompt | 降 `contextTurns`、`maxPromptChars`、关闭不用的记忆模块 |
| 网络 | 换离 API 更近的节点；`timeoutMs` 别设太大 |

实测（arm64，prompt 2934 字）：私聊 `v4-pro` ≈ 4.7s，群聊 `flash` ≈ 3.4s。
**prompt 长度是主要成本**，群聊 2246 字里一半是历史记录。

## 表情包

### Q：表情包怎么不发了？

1. `reply.sticker.enabled` 是否为 `true`
2. `stickerDir` 是否指向有 `index.json` 的目录
3. 索引里的 `tags` 是否匹配当前情绪（委屈/生气/开心/困…）
4. 代码逻辑是「**宁可不发，也不发错**」，没有匹配情绪的图就静默跳过

### Q：表情图片出现在系统相册里？

放在 `/sdcard/Download/...` 会被媒体扫描。
改到 `/data/adb/qqbot_bridge/stickers`（`stickerDir` 配置），并放一个 `.nomedia`。
已经在相册里的旧图，删掉后重启相册或清媒体缓存即可。

## 进程与连接

### Q：`connected: false` 一直连不上？

1. `appId` / `appSecret` 错了或过期
2. 平台侧「私聊」能力没开
3. 手机没网 / 被省电策略杀
4. 看 `bridge.log` 里的 `START_FAILED` 或 `ERR`

代码有健康检查：**90 秒连不上就自杀**，交给 watchdog 重启，避免僵死。

### Q：为什么 watchdog 一直重启？

```bash
tail -20 /data/adb/qqbot_bridge/log/bridge.log
```
常见：缺 `.so`（`CANNOT LINK EXECUTABLE`）、`config.json` 缺字段、端口被占用。

### Q：重启手机后不自动起来？

- Magisk 用户确认模块已启用，看 `service.sh` 是否执行
- `service.sh` 里睡了 30 秒等网络，别急着测
- 手动：`nohup sh /data/adb/qqbot_bridge/watchdog.sh &`

### Q：内存占用高 / 被系统杀？

`watchdog.sh` 已限制 `--max-old-space-size=64`。
32 位设备改成 48；还不行就加白名单/关省电优化。

## 安全

### Q：Key 会不会被提交？

`.gitignore` 已排除 `config.json` / `ai.json` / `persona.md`。
**你 fork 后自己检查一遍**，尤其别把 `config.json` 里的 `appSecret` 推上去。

### Q：HTTP API 会不会被外面访问？

只监听 `127.0.0.1`，外网访问不到。要远程用就自己套 SSH 隧道，别直接改 `0.0.0.0`。

## 其他

### Q：时间不对 / 免打扰不生效？

`quietHours` 用的是**手机本地时区**。容器里跑（Docker）注意 `TZ` 环境变量。

### Q：能接别的模型吗？

能，只要是 OpenAI 兼容的 `/chat/completions`：DeepSeek、通义、Kimi、Moonshot、Ollama、vLLM…
改 `baseUrl` + `apiKey` + `model` 即可。`effort` 字段是 DeepSeek v4 系专有，别的服务会忽略或报错，不认就置空。