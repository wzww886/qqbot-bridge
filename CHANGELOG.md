# 更新日志

## v2.1.0
### 变更
- **默认数据目录改为 `/data/adb/qqbot_bridge_data`**：不再默认指向 `Operit` 插件目录（没装 Operit 的设备根本不会存在那个路径）。全新安装直接使用新目录；老设备若旧目录里已有 `ai.json` 则**自动沿用旧目录**（避免 memory / inbox 历史丢失），可用 `QQBRIDGE_STATE` 手动切换；旧路径 `config.json` 仍作兜底候选。
### 新增
- `groupModel`：群聊独立模型（默认 `deepseek-flash`），私聊仍用主模型，群聊首字延迟从 ~4.7s 降到 ~3.4s
- `groupMaxTokens` / `groupTemperature` / `groupEffort`：群聊独立采样参数
- `reply.minSegments`：一条用户消息至少回几条；模型只给一句时按句内标点自动拆两条
- `reply.stripTrailingPunctuation`：去掉每条结尾的 `。，、；：`，保留 `？！…`
- `stickerDir`：表情包目录可配置（挪到 `/data/adb` 下就不会被相册扫描）
- `QQBRIDGE_ROOT` / `QQBRIDGE_STATE` / `QQBRIDGE_CONFIG` / `QQBRIDGE_PORT` / `QQBRIDGE_API` 环境变量，路径与端口全可覆盖
- 群聊**每一条**回复都带 `msgId` 走被动回复（以前只有第一条带，第二条会被当主动消息拒发）

### 修复
- 表情包散图出现在系统相册（改为可配置目录 + `.nomedia`）
- 群聊第二条消息被拒发
- 推理模型把 token 花在思考上导致空回复 → 加长预算重试一次

### 工程
- 零依赖 ZIP 打包器 `scripts/pack.mjs`（系统无 zip 也能出模块包）
- `scripts/fetch-runtime.sh`：从 Termux 复制 node + 依赖 so，支持任意 ABI
- `scripts/import-stickers.sh`：扫描图片自动生成 `index.json`
- 全部配置脱敏为 `*.example.json`，密钥不入库

## v2.0.0
- 重写为 Node ESM：QQ 官方 SDK + OpenAI 兼容接口
- 记忆系统：事实 / 摘要 / 规则 / 日记，分层落盘
- 看门狗、健康检查、日志轮转