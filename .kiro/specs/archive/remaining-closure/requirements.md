# 剩余任务收尾 — 需求文档

## 背景

全量 spec 审计发现：12 个活跃 spec + 5 个错误归档 spec 中，仍有零散未完成任务。本 spec 将所有剩余工作统一收口，完成后可宣布 v0.5.x 全部 spec 清零。

---

## Phase 1：旧前端退役（来自 old-frontend-decommission）

**现状**: 旧前端代码（旧路由/旧 tab shell/旧 provider hooks/旧页面容器）仍在源码树中，占编译时间，造成混淆。

- [ ] 1.1 识别旧前端文件（对比新前端 app-next/ 与旧 components/pages/）
- [ ] 1.2 删除旧路由、旧 tab shell 与旧 provider hooks
- [ ] 1.3 删除旧前端页面容器及对应测试
- [ ] 1.4 清理残余导出和引用
- [ ] 1.5 typecheck + vite build 验证

---

## Phase 2：Tool Call 完整存储（来自 provider-block-history）

**现状**: session-chat-service 的 tool call 结果未存为完整 ConversationItem，旧 session 消息无自动升级。

- [ ] 2.1 tool call 结果存为完整 ConversationItem（含 input + output + duration + status）
- [ ] 2.2 旧 session 消息自动 upgrade（缺失字段补默认值）

---

## Phase 3：插件化收尾（来自 novel-plugin-and-tool-parity Step 6-7）

**现状**: 工具 schema 已迁移到 novel-plugin，但 handler 代码和前端仍在 studio。

- [ ] 3.1 迁移独立 handler 到 novel-plugin/src/handlers/（rhythm-analyzer → questionnaire → cockpit）
- [ ] 3.2 迁移耦合 handler（candidate → narrative → guided）
- [ ] 3.3 前端 writing-workbench 改为插件页面注入（注册机制 + 动态加载）

---

## Phase 4：智能预设合规检查（来自 smart-preset-system Phase 3）

**现状**: 预设注入已通，反思建议 UI 已做，但写后合规检查未实现。

- [ ] 4.1 写完章节后，检查内容是否违反已启用预设的规则
- [ ] 4.2 违规项以卡片形式展示（类似 PresetSuggestionCard）
- [ ] 4.3 用户可选择忽略或修改

---

## Phase 5：杂项验证（来自多个 spec 的验证任务）

- [ ] 5.1 onboarding-and-story-jingwei：首用体验浏览器烟测
- [ ] 5.2 ui-gap-fixes：逐项浏览器验证已有功能
- [ ] 5.3 conversation-parity：消息搜索/跳转功能验证
- [ ] 5.4 coding-agent-quality：累积信任机制（记住用户允许过的操作）

---

## Phase 6：NarraFork 平台能力（长期路线图，来自 narrafork-feature-parity）

- [ ] 6.1 自重启更新系统（客户端下载 patch + 应用 + 重启）
- [ ] 6.2 评审系统（ConcludeReview 代码审查工作流）
- [ ] 6.3 顺便提问（Ask in Passing 非阻塞追问）
- [ ] 6.4 文件修改时间线（Git diff 可视化）
- [ ] 6.5 Pixi 高性能渲染（大图替代 react-flow）
- [ ] 6.6 容器系统（Docker/沙箱隔离执行）
- [ ] 6.7 IM 网关（QQ/微信/飞书接入）
- [ ] 6.8 多用户实时协作（WebSocket 广播 + 冲突解决）

---

## 来源 Spec 映射

本 spec 完成后，以下 spec 可标记为全部完成：

| 原 Spec | 本 spec 对应 Phase |
|---------|-------------------|
| old-frontend-decommission | Phase 1 |
| provider-block-history | Phase 2 |
| novel-plugin-and-tool-parity (Step 6-7) | Phase 3 |
| smart-preset-system (Phase 3) | Phase 4 |
| onboarding-and-story-jingwei (验证) | Phase 5.1 |
| ui-gap-fixes | Phase 5.2 |
| conversation-parity (搜索) | Phase 5.3 |
| coding-agent-quality (信任) | Phase 5.4 |
| narrafork-feature-parity | Phase 6 |
| platform-and-collaboration (多用户) | Phase 6.8 |

## Phase 7：代码架构文档化（分析 + 对比 + 记录）

**现状**: 项目代码量已达 7 万+ 行，开发者（包括自己）记不清各模块的职责、数据流、对标关系。需要系统性文档化。

### 7.1 小说领域前端架构文档

- [ ] 7.1.1 分析 `packages/studio/src/app-next/writing-workbench/` 全部组件
- [ ] 7.1.2 绘制组件树 + 数据流图（哪个组件调哪个 API、状态怎么流转）
- [ ] 7.1.3 记录每个面板的功能、入口、依赖关系
- [ ] 7.1.4 输出 `docs/04-架构与设计/05-小说前端架构.md`

### 7.2 小说领域后端架构文档

- [ ] 7.2.1 分析 `packages/core/src/` 全部模块（pipeline/agents/jingwei/filter/compliance/presets/tools）
- [ ] 7.2.2 分析 `packages/studio/src/api/routes/` 小说相关路由
- [ ] 7.2.3 绘制数据流图（用户操作 → API → 服务 → 存储 → AI 调用）
- [ ] 7.2.4 记录每个服务的职责、输入输出、依赖
- [ ] 7.2.5 输出 `docs/04-架构与设计/06-小说后端架构.md`

### 7.3 Agent 运行时架构文档（对标 Claude Code / Codex CLI / NarraFork）

- [ ] 7.3.1 分析 NovelFork Agent Loop（agent-turn-runtime.ts + session-chat-service.ts + llm-runtime-service.ts）
- [ ] 7.3.2 对比 Claude Code 源码（restored-cli-src/src/）：Tool.ts / QueryEngine.ts / main.tsx 的架构
- [ ] 7.3.3 对比 Codex CLI（codex-rs/）：Rust agent loop / tool execution / sandbox
- [ ] 7.3.4 对比 NarraFork（.narrafork-reference/）：WebSocket 事件 / 工具状态机 / 子代理
- [ ] 7.3.5 绘制四者对比表（Agent Loop / 工具系统 / 上下文管理 / 流式渲染 / 权限 / 子代理）
- [ ] 7.3.6 记录 NovelFork 的差异化设计决策和取舍
- [ ] 7.3.7 输出 `docs/04-架构与设计/07-Agent运行时对比分析.md`

### 7.4 经纬系统架构文档

- [ ] 7.4.1 分析经纬数据模型（Bible 4 表 + jingwei_entries + relations + progressions + cooccurrence + causal_chains）
- [ ] 7.4.2 分析上下文注入链路（buildBibleContext + buildChapterBriefing + buildRecursiveSummaryContext）
- [ ] 7.4.3 分析联想层（extractChapterEntities + updateCooccurrence + propagateSpikes + dream）
- [ ] 7.4.4 对比 NovelCrafter Codex / Sudowrite Story Bible / VCP Wave Memory
- [ ] 7.4.5 输出 `docs/04-架构与设计/08-经纬系统架构.md`

---

## 优先级

```
Phase 1 (1-2 天) — 旧前端退役（减少技术债）
Phase 2 (1 天) — Tool Call 完整存储
Phase 3 (2-3 天) — 插件化收尾
Phase 4 (1 天) — 预设合规检查
Phase 5 (1 天) — 杂项验证
Phase 6 (15-20 天) — 长期路线图
Phase 7 (2-3 天) — 代码架构文档化
```

Phase 1-5 + 7 总计约 8-11 天。Phase 6 是长期迭代。
