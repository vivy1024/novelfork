# 通用能力补全 — Tasks

## FR-1: 自定义斜杠命令

- [x] 1.1 在 `types/settings.ts` 添加 `SlashCommand` 接口和 `UserConfig.commands` 字段
- [x] 1.2 在 `user-config-service.ts` 添加 commands 的 sanitize 和 merge 逻辑
- [x] 1.3 在 `settings.ts` 路由添加 `GET/PUT /api/settings/commands` 端点
- [x] 1.4 在套路页添加命令管理 UI（创建/编辑/删除/参数定义）
- [x] 1.5 在 Composer 组件添加 `/` 触发的命令补全弹出层（注入用户自定义命令）
- [x] 1.6 实现命令展开逻辑（模板替换 + 先 Bash 模式）
- [x] 1.7 支持叙事线级命令（`.novelfork/commands.json`）

## FR-2: 全局系统提示词可编辑

- [x] 2.1 在 `settings.ts` 路由添加 `GET/PUT /api/settings/global-prompt` 端点
- [x] 2.2 在 AgentSettingsPanel 添加全局提示词 Textarea 编辑区
- [x] 2.3 显示当前文件路径和候选路径（~/.novelfork/CLAUDE.md）
- [x] 2.4 保存时写入文件，不存在时自动创建

## FR-3: 首 Token 超时 + 自动重试

- [x] 3.1 在 `types/settings.ts` 添加 `firstTokenTimeoutSeconds`、`maxTransientRetries`、`retryBackoffCeilSeconds` 配置
- [x] 3.2 在 `DEFAULT_USER_CONFIG` 添加默认值（60s / 3次 / 30s）
- [x] 3.3 在 provider adapter 的流式 generate 中实现首 token 超时检测
- [x] 3.4 实现指数退避重试包装函数 `withRetry()`
- [x] 3.5 支持自定义可重试错误规则（`runtimeControls.customRetryRules`）
- [x] 3.6 在 RuntimeControlPanel 添加超时/重试配置 UI

## FR-4: 更新系统

- [x] 4.1 在 `types/settings.ts` 的 `ServerSettings` 添加 `updateChannel`、`autoCheckUpdate` 字段
- [x] 4.2 创建 `api/lib/update-checker.ts`：调用 GitHub API 对比版本
- [x] 4.3 在 `settings.ts` 路由添加 `GET /api/settings/check-update` 端点
- [x] 4.4 在"服务器与系统"设置面板添加更新 UI（通道选择 + 检查按钮 + 结果显示）
- [ ] 4.5 启动时自动检查（如果 `autoCheckUpdate` 开启）

## FR-5: 自定义子代理类型

- [x] 5.1 在 `types/settings.ts` 添加 `CustomSubagentType` 接口和 `UserConfig.customSubagents` 字段
- [x] 5.2 在 `user-config-service.ts` 添加 customSubagents 的 sanitize 逻辑
- [x] 5.3 在 `session-tool-executor.ts` 的 Agent handler 中支持自定义类型查找
- [x] 5.4 在套路页添加自定义子代理管理 UI（创建/编辑/删除）
- [x] 5.5 支持工具白名单和默认模型配置

## 学习文档补全

- [ ] 6.1 新增 `docs/learning/13-runtime-capabilities.md` — CLAUDE.md 读取、压缩摘要、Staleness check、文件 dedup
- [ ] 6.2 新增 `docs/learning/14-subagent-system.md` — 子代理类型、后台任务、Fork 模式、Await
- [ ] 6.3 新增 `docs/learning/15-tool-search-and-skills.md` — ToolSearch、Skill 加载、工具过滤
- [ ] 6.4 新增 `docs/learning/16-security-and-sandbox.md` — 沙箱模式、进程管理、目录白名单
- [ ] 6.5 新增 `docs/learning/17-browser-and-terminal.md` — Browser 截图、Terminal 工具
- [ ] 6.6 新增 `docs/learning/18-web-tools.md` — WebSearch、WebFetch
- [ ] 6.7 更新 `docs/learning/README.md` 索引
- [ ] 6.8 更新 `docs/learning/04-narrator-conversation.md` — 新增工具（PlanMode/TaskCreate/AskUser/Recall/Send）
- [ ] 6.9 更新 `docs/learning/06-settings-and-routines.md` — 服务器配置、使用历史真实数据

## 执行顺序

Phase A（后端优先）：FR-3 → FR-2 → FR-5 → FR-1（后端部分）→ FR-4
Phase B（前端 UI）：FR-1（Composer 补全）→ FR-2（设置 UI）→ FR-4（更新 UI）→ FR-5（套路 UI）
Phase C（文档）：6.1-6.9 学习文档补全
