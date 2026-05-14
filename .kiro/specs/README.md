# Kiro Specs 索引

本目录记录 NovelFork 的 Kiro specs。已完成 spec 归档到 `archive/`，当前 active spec 保留在本目录下。

---

## 后续规划

### 主线：plugin-architecture-split（当前）

将小说领域代码从通用 Agent 工作台中彻底拆出，使 studio 成为纯通用平台，小说功能作为可插拔插件加载。

```
Batch 1: 插件加载器 ← 当前
  ↓
Batch 2: 迁移 core 小说引擎 → novel-plugin/engine/
  ↓
Batch 3: 迁移 studio 小说路由 → novel-plugin/routes/
  ↓
Batch 4: 迁移 studio 小说服务 → novel-plugin/handlers/
  ↓
Batch 5: 迁移前端面板 → novel-plugin/pages/
  ↓
Batch 6: 验证 + 第二领域骨架
```

完成后 `remaining-closure` Phase 3 自动关闭。

### 第二优先级：小功能收尾

plugin-architecture-split 完成后，按以下顺序扫尾：

| 顺序 | Spec | 剩余项 | 工作量 |
|------|------|--------|--------|
| 1 | coding-agent-quality | Post-Edit 自动验证 + 验证命令检测 | 半天 |
| 2 | ui-visibility-gaps | 5 项（reflecting 广播/自动批准通知/弧线 toast/预设快捷/终端入口） | 1 天 |
| 3 | ui-gap-fixes | 6 项（预设执行路径/节拍映射/叙事线交互/slash 命令/保存统一/套路联动） | 1-2 天 |
| 4 | smart-preset-system | 建书自动启用套装 + 反思模型选预设 + 驾驶舱建议卡 + 写后合规 | 2 天 |
| 5 | novel-creation-closure | 模板市场补全（10 流派模板） | 1 天（内容工作） |

### 第三优先级：remaining-closure 扫尾

| Phase | 内容 | 依赖 |
|-------|------|------|
| Phase 1 | 旧前端残余清理 | 无 |
| Phase 2 | 旧 session 消息 upgrade | 无 |
| Phase 3 | handler 迁移 + 前端插件注入 | plugin-architecture-split 完成 |
| Phase 4 | 预设合规检查 | smart-preset-system Phase 3 完成 |
| Phase 5 | 浏览器烟测验证 | 所有 UI spec 完成 |

### 远期路线图（不阻塞发版）

`narrafork-feature-parity` — 按内测反馈驱动：
- 自重启更新系统
- 评审系统（ConcludeReview）
- IM 网关（QQ/微信/飞书）
- Pixi 高性能渲染
- 容器隔离执行

---

## Active Specs

| Spec | 状态 | 完成度 | 说明 |
|------|------|--------|------|
| `plugin-architecture-split` | 🔥 主线 | 0% | 6 Batch / 60 任务，插件架构真拆分 |
| `coding-agent-quality` | ⏸️ 等待 | 75% | 差 Phase 2（Post-Edit 自动验证） |
| `ui-visibility-gaps` | ⏸️ 等待 | 67% | 差 5 个小功能 |
| `ui-gap-fixes` | ⏸️ 等待 | 70% | 差 6 项 UI 断裂修复 |
| `smart-preset-system` | ⏸️ 等待 | 30% | Phase 1 半完成，Phase 2-3 未开始 |
| `novel-creation-closure` | ⏸️ 等待 | 80% | 差 Phase 4 模板市场补全 |
| `remaining-closure` | ⏸️ 等待 | 40% | 多 Phase 依赖其他 spec 完成 |
| `narrafork-feature-parity` | 📋 远期 | 0% | 纯路线图，按需求驱动 |

---

## 归档 Specs（60+ 个）

`archive/` 下已完成的 spec：

| 分类 | Spec |
|------|------|
| **运行时与健壮性** | agent-runtime-robustness, agent-tool-streaming |
| **对话与交互** | conversation-parity, conversation-parity-v1 |
| **插件与工具** | novel-plugin-and-tool-parity, agent-tool-parity |
| **平台能力** | platform-and-collaboration, narrafork-platform-upgrade |
| **经纬系统** | jingwei-ui-overhaul, novel-bible-v1, onboarding-and-story-jingwei |
| **核心引擎** | agent-writing-pipeline-v1, claude-codex-novel-agent-v1, web-agent-runtime-v1 |
| **前端工作台** | novel-creation-workbench-complete-flow, studio-ide-layout-v1, frontend-refoundation-v1, frontend-live-wiring-v1, studio-frontend-rewrite, studio-frontend-integration-v1 |
| **写作功能** | writing-modes-v1, writing-tools-v1, writing-presets-v1, ai-taste-filter-v1, novel-writing-features |
| **供应商与设置** | provider-integration-rewrite, provider-runtime-control-plane-v1, real-provider-model-runtime, provider-protocol-adapters-v2, provider-block-history |
| **基础设施** | backend-contract-v1, backend-core-refactor-v1, storage-migration, engineering-foundation-v1 |
| **平台与合规** | platform-compliance-v1, novelfork-narrafork-closure |
| **UI 质量** | novelfork-ui-v1, ui-live-parity-hardening-v1, ui-quality-cleanup, workspace-gap-closure-v1, narrafork-ui-parity |
| **审计与缺口** | functionality-audit, real-functionality-closure |
| **清理与退役** | legacy-source-retirement-v1, old-frontend-decommission, project-wide-real-runtime-cleanup |
| **其他** | desktop-app-window, docs-system-rearchitecture, session-memory-enhancement, session-runtime-status, template-market-v2, character-arc-auto-tracking |

---

## 非 Spec 参考资料

### `.narrafork-reference/`

从 NarraFork 0.4.2 爬取的第一手参考，**不是 spec，不产生任务**。用于设计对标时查阅。

| 文件 | 内容 |
|------|------|
| `API-REFERENCE.md` | NarraFork 完整 API 端点 |
| `UI-COMPONENTS.md` | DOM 结构 + 状态指示器 + 设置→对话数据流 |
| `PROVIDERS.md` | 三种 API 模式 + Codex 多账号 + 额度管理 |
| `CONVERSATION-INTERNALS.md` | WebSocket 事件、流式渲染、工具状态机 |
| `PROVIDER-AND-NARRATOR-MANAGEMENT.md` | 供应商、权限、叙述者创建 |
| `FRONTEND-LOGIC.md` | 前端逻辑分析 |
| `ARCHITECTURE-ANALYSIS.md` | 架构分析 |
