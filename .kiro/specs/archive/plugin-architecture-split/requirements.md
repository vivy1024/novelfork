# 插件架构真拆分 — 需求文档

## 背景

NovelFork 需要同时服务两个领域：
1. **小说创作**（当前主业务）
2. **玉珍健身**（第二领域，已有需求）

当前小说代码硬编码在 `packages/core/` 和 `packages/studio/` 中，无法干净地添加第二个领域。需要真正拆分为：

```
packages/core/           — 纯通用 Agent 基础设施
packages/novel-plugin/   — 小说领域完整插件
packages/fitness-plugin/ — 健身领域完整插件（未来）
packages/studio/         — 通用 Agent 工作台（通过插件加载器加载领域功能）
```

---

## 目标架构

```
studio (通用工作台)
├── Agent 对话界面
├── 工具卡片渲染
├── 设置/供应商管理
├── 插件加载器 ← 核心新增
│   ├── 注册路由
│   ├── 注册前端页面
│   ├── 注册工具 handler
│   └── 注册 Agent 预设
└── 通用工具（Bash/Read/Write/Edit/Glob/Grep/Browser/WebSearch/WebFetch）

core (通用基础设施)
├── storage/ (SQLite + migration runner)
├── plugins/ (插件类型 + 加载器接口)
├── runtime/ (进程适配器)
├── llm/ (LLM 客户端)
├── state/ (状态管理)
├── hooks/ (Hook 系统)
├── mcp/ (MCP 协议)
└── types/ utils/ models/ registry/

novel-plugin (小说领域 — 完整自包含)
├── engine/ (从 core 迁移: pipeline/ agents/ jingwei/ filter/ presets/ compliance/ tools/)
├── routes/ (从 studio 迁移: ai.ts jingwei.ts writing-modes.ts pipeline.ts filter.ts compliance.ts)
├── handlers/ (从 studio 迁移: 各 service 的 handler 逻辑)
├── pages/ (从 studio 迁移: writing-workbench/ 全部面板)
├── schemas/ (已有: tool-schemas.ts category-schemas.ts genre-templates.ts)
└── manifest.ts (已有: 工具声明 + Agent 预设)
```

---

## 分批计划（6 批，每批独立可验证）

### Batch 1：创建插件加载器（studio 侧）

**不动任何小说代码**，只建立加载机制。

- [ ] 1.1 `studio/src/api/lib/plugin-loader.ts` — 插件加载器
  - `loadPlugin(manifest)`: 注册路由 + 工具 handler + Agent 预设
  - `getPluginRoutes()`: 返回所有插件注册的 Hono 路由
  - `getPluginTools()`: 返回所有插件注册的工具定义
  - `getPluginPages()`: 返回所有插件注册的前端页面
- [ ] 1.2 `studio/src/api/server.ts` — 挂载插件路由
  - 在 server 启动时调用 `loadPlugin(novelPluginManifest)`
  - 插件路由挂载到 `/api/plugins/:pluginId/*`
- [ ] 1.3 `studio/src/app-next/plugin-pages.tsx` — 前端插件页面渲染
  - 根据 `getPluginPages()` 动态渲染插件面板
- [ ] 1.4 验证：现有功能不受影响，插件加载器空跑

### Batch 2：迁移 core 小说引擎到 novel-plugin/engine/

**移动文件 + 修改 import**。

- [ ] 2.1 创建 `packages/novel-plugin/src/engine/` 目录
- [ ] 2.2 移动 `core/src/pipeline/` → `novel-plugin/src/engine/pipeline/`
- [ ] 2.3 移动 `core/src/agents/` → `novel-plugin/src/engine/agents/`
- [ ] 2.4 移动 `core/src/jingwei/` → `novel-plugin/src/engine/jingwei/`
- [ ] 2.5 移动 `core/src/filter/` → `novel-plugin/src/engine/filter/`
- [ ] 2.6 移动 `core/src/presets/` → `novel-plugin/src/engine/presets/`
- [ ] 2.7 移动 `core/src/compliance/` → `novel-plugin/src/engine/compliance/`
- [ ] 2.8 移动 `core/src/tools/` → `novel-plugin/src/engine/tools/`
- [ ] 2.9 移动 `core/src/bible/` → `novel-plugin/src/engine/bible/`
- [ ] 2.10 更新所有 import 路径
- [ ] 2.11 `core/src/index.ts` 移除小说 export
- [ ] 2.12 验证：`pnpm --dir packages/core build` + `pnpm --dir packages/novel-plugin exec tsc --noEmit`

### Batch 3：迁移 studio 小说路由到 novel-plugin/routes/

- [ ] 3.1 创建 `packages/novel-plugin/src/routes/` 目录
- [ ] 3.2 移动 `studio/src/api/routes/ai.ts` → `novel-plugin/src/routes/ai.ts`
- [ ] 3.3 移动 `studio/src/api/routes/jingwei.ts` → `novel-plugin/src/routes/jingwei.ts`
- [ ] 3.4 移动 `studio/src/api/routes/writing-modes.ts` → `novel-plugin/src/routes/writing-modes.ts`
- [ ] 3.5 移动 `studio/src/api/routes/pipeline.ts` → `novel-plugin/src/routes/pipeline.ts`
- [ ] 3.6 移动 `studio/src/api/routes/filter.ts` → `novel-plugin/src/routes/filter.ts`
- [ ] 3.7 移动 `studio/src/api/routes/compliance.ts` → `novel-plugin/src/routes/compliance.ts`
- [ ] 3.8 移动 `studio/src/api/routes/bible.ts` → `novel-plugin/src/routes/bible.ts`
- [ ] 3.9 novel-plugin manifest 注册路由工厂
- [ ] 3.10 studio server.ts 通过插件加载器挂载路由
- [ ] 3.11 验证：API 端点仍然可访问

### Batch 4：迁移 studio 小说服务到 novel-plugin/handlers/

- [ ] 4.1 移动 `studio/src/api/lib/cockpit-service.ts` → `novel-plugin/src/handlers/`
- [ ] 4.2 移动 `studio/src/api/lib/candidate-tool-service.ts` → `novel-plugin/src/handlers/`
- [ ] 4.3 移动 `studio/src/api/lib/pgi-tool-service.ts` → `novel-plugin/src/handlers/`
- [ ] 4.4 移动 `studio/src/api/lib/guided-generation-tool-service.ts` → `novel-plugin/src/handlers/`
- [ ] 4.5 移动 `studio/src/api/lib/questionnaire-tool-service.ts` → `novel-plugin/src/handlers/`
- [ ] 4.6 移动 `studio/src/api/lib/narrative-line-service.ts` → `novel-plugin/src/handlers/`
- [ ] 4.7 移动 `studio/src/api/lib/novel-init-handler.ts` → `novel-plugin/src/handlers/`
- [ ] 4.8 移动 `studio/src/api/lib/novel-audit-handler.ts` → `novel-plugin/src/handlers/`
- [ ] 4.9 移动 `studio/src/api/lib/session-tool-registry-novel.ts` → `novel-plugin/src/handlers/`
- [ ] 4.10 验证：工具调用仍然正常

### Batch 5：迁移前端面板到 novel-plugin/pages/

- [ ] 5.1 创建 `packages/novel-plugin/src/pages/` 目录
- [ ] 5.2 移动 `studio/src/app-next/writing-workbench/` → `novel-plugin/src/pages/writing-workbench/`
- [ ] 5.3 novel-plugin manifest 注册前端页面
- [ ] 5.4 studio 通过插件加载器动态渲染插件页面
- [ ] 5.5 验证：写作工作台仍然可用

### Batch 6：验证 + 清理

- [ ] 6.1 验证：`packages/core/` 不再有任何小说特有代码
- [ ] 6.2 验证：`packages/studio/` 不再直接 import 小说模块
- [ ] 6.3 验证：拔掉 novel-plugin 后 studio 仍然编译通过（纯通用 Agent 工作台）
- [ ] 6.4 创建 `packages/fitness-plugin/` 骨架（证明第二领域可以干净添加）
- [ ] 6.5 更新架构文档

---

## 约束

- 每个 Batch 独立提交，独立可验证
- Batch 之间不能有半完成状态（每个 Batch 结束时全部编译通过）
- 移动文件时用 `git mv`（保留历史）
- 如果某个文件被通用代码和小说代码同时依赖，留在 core 里
- storage/ 的 migration 文件留在 core（所有领域共享同一个 DB）
- 小说特有的 migration（0012-0014）移到 novel-plugin 但仍由 core 的 migration runner 执行

---

## 风险

| 风险 | 缓解 |
|------|------|
| 循环依赖 | novel-plugin 依赖 core，core 不依赖 novel-plugin |
| 前端 lazy import 失败 | 用 Suspense + fallback |
| 测试路径断裂 | 每个 Batch 后跑 typecheck |
| 编译时间增加 | novel-plugin 独立编译，不影响 core/studio |

---

## 预估

- Batch 1：1 天（插件加载器）
- Batch 2：2 天（引擎迁移，文件最多）
- Batch 3：1 天（路由迁移）
- Batch 4：1 天（服务迁移）
- Batch 5：1 天（前端迁移）
- Batch 6：0.5 天（验证 + 清理）

总计约 **6-7 天**。
