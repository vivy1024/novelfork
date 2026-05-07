# v0.1.0 Release Readiness Design

**版本**: v1.0.0
**创建日期**: 2026-05-07
**状态**: approved
**文档类型**: Kiro design

---

## 1. 设计目标

本设计把 v0.1.0 发版前的“完整功能”定义为一个发布阻塞系统，而不是单点 UI polish。目标是：

1. 用户打开 NovelFork 后获得完整软件体验，而不是开发路由集合。
2. 核心作者路径（首页 → 作品 → 工作台 → 叙述者 → 设置/套路）均可理解、可操作、可验证。
3. 所有 UI current 声明仍绑定真实合同/API/浏览器证据。
4. 所有“体验达标”声明必须有真实浏览器手工记录。
5. v0.1.0 发版资料、产物、tag、GitHub Release 完整一致。

---

## 2. 设计原则

| 原则 | 说明 |
|------|------|
| 不照抄 NarraFork | 借鉴 NarraFork 的对象建模、会话管理、运行透明度和配置收口，不复制 Mantine 或 coding 节点图。 |
| 作者优先 | NovelFork 的核心对象仍是作品、章节、Story/Truth、经纬、候选稿和写作动作。 |
| 真实优先 | API 不存在就标 planned/unsupported，不用假控件或 mock 成 current。 |
| 自动化 + 手工双门槛 | Playwright 证明路径可重复，手工浏览器记录证明体验可发布。 |
| 干净环境验活 | 发布判断不能基于被 E2E provider 和历史测试书籍污染的开发 root。 |
| 分阶段可提交 | 每个阶段完成后都更新文档、CHANGELOG、验证并提交推送。 |

---

## 3. 总体架构

v0.1.0 Release Readiness 分为六条并行但有依赖的工作流：

```text
产品壳入口
  ↓
作品工作台体验 ─────┐
  ↓                 │
叙述者中心/会话页 ←──┤
  ↓                 │
设置/套路/运行控制台 ─┤
  ↓                 │
干净 root 验活 / 测试夹具治理
  ↓
文档归档 / 版本 / 编译 / Release
```

实现时仍遵守现有边界：

- 前端 live route：`packages/studio/src/app-next/`
- 会话 UI：`packages/studio/src/app-next/agent-conversation/surface/`
- 会话中心：`packages/studio/src/app-next/sessions/` 与 `packages/studio/src/components/sessions/`
- Shell 数据：`packages/studio/src/app-next/shell/`
- 工作台：`packages/studio/src/app-next/writing-workbench/`
- Backend Contract：`packages/studio/src/app-next/backend-contract/`
- E2E：`e2e/`
- 当前文档：`docs/01-当前状态/`、`docs/08-测试与质量/`、`docs/90-参考资料/NarraFork参考/`

---

## 4. 子系统设计

### 4.1 产品壳与首页

现状问题：`/next` 更像开发态 Agent Shell，缺作者首页。设计目标是提供作者可理解的第一屏：

- 最近作品卡片。
- 最近会话摘要。
- 当前模型/provider 健康摘要。
- 快捷动作：新建作品、打开作品、继续最近写作会话、进入设置、进入套路。
- 空态：无作品、无 provider、无会话时分别给出下一步。

不新增虚假统计。所有数字来自现有 books/sessions/provider summary API；缺接口时显示 planned/unsupported 或链接到设置。

### 4.2 作品工作台

工作台保留 NovelFork 作者向结构，不改成 NarraFork 节点图。重点是成品化现有资源树和画布：

- 资源树分组更清晰：章节、候选稿、草稿、Story、Truth、经纬、叙事线。
- 当前资源 header 卡片化：类型、路径、读写能力、保存状态、是否 preview/hydrated。
- 写作动作区改为“动作卡片”：每个动作展示结果边界（session/candidate/draft/audit/prompt-preview/unsupported）。
- 空态说明每类资源的用途，降低作者理解成本。
- 保留 dirty guard 和保存后回读。

### 4.3 叙述者中心

现有 `SessionCenterPage` 已存在，是优先复用对象，不新造独立系统。设计目标是达到 NarraFork `/narrators` 的管理能力：

- 顶部：搜索、类型筛选（全部/独立/作品绑定/章节绑定）、状态筛选、排序、归档入口、新建叙述者。
- 列表项：标题、状态、模型、消息数、绑定对象、创建时间、最后消息、工作目录、错误/运行/完成标记。
- 操作：打开、继续最近、fork、归档、恢复。
- 新建独立叙述者：标题、工作目录/绑定对象、模型、权限模式、计划模式。

Shell 左栏不承担完整管理职责，只展示最近 N 条或折叠后的高优先级会话，并提供“查看全部叙述者”。

### 4.4 会话页

现有 `ConversationSurface`、`ConversationStatusBar`、`Composer` 和 `ConversationRuntimeControls` 已经有真实合同，但布局太原始。设计重排为 5 个区域：

1. **Session Header**
   - 标题、状态 badge、绑定对象、工作区/Git、消息数。
   - 模型/权限/推理控件放入同一控制带，避免拼接成一行文本。

2. **Runtime Summary Cards**
   - Context/Token/Cost。
   - Tool policy。
   - Running/idle/compact/abort。
   - Planned panels 以“未接入能力”小卡显示。

3. **Recovery / Confirmation Lane**
   - recovery notice、permission confirmation、policy denial 显示在消息流上方，视觉上像运行事件。

4. **Message Stream**
   - 空消息时显示作者向空态：当前绑定、可做什么、输入示例、模型状态。
   - 有消息时保留 ToolCallCard、MessageItem 和 raw 脱敏。

5. **Composer Dock**
   - 固定底部完整输入容器。
   - textarea、发送/中断、slash hints、禁用原因、设置入口在同一视觉区。
   - running 时发送按钮切为中断，状态明确。

样式优先使用现有 Tailwind token、`paper-sheet` / `glass-panel` / `card` 色板，不引入 Mantine。

### 4.5 设置 / Provider / Runtime 控制台

保留 `SettingsTruthModel`，新增发布可读性要求：

- Provider 页支持搜索/分组折叠/异常过滤。
- E2E provider 或测试模型不得出现在 clean root。
- 开发 root 可增加测试夹具识别或清理入口，但不能影响生产 root。
- Runtime planned/unsupported 口径继续由 truth model 控制。
- 保存后继续真实回读 `/api/settings/user`。

### 4.6 套路 / 工作流配置台

`/next/routines` 在 v0.1.0 前需要手工验活并补齐文档口径：

- 命令、工具、权限、技能、子代理、MCP、钩子分组是否可达。
- 哪些 current，哪些 readonly/planned/unsupported。
- 不能把旧 UI 中未接能力宣传为可用。

如果当前功能已足够，只做验活和文档；如果入口或状态明显不可信，再追加最小 UI 修复。

### 4.7 干净 root 验活与夹具治理

新增 release smoke 原则：

- 自动化 E2E 使用隔离 root。
- 手工 release smoke 使用全新 clean root。
- clean root 不得出现 E2E Provider、测试书籍、历史 Planner 会话。
- 验活路径至少覆盖：`/`、`/api/mode`、`/next`、首页、作品创建/打开、工作台资源、会话中心、会话页、设置、供应商、套路、关于。

如发现 E2E 会污染默认开发 root，应优先改测试配置或清理逻辑，而不是在发布报告中忽略污染。

### 4.8 发版收口

发版阶段只在所有体验门槛完成后开始：

1. 更新版本号到 `0.1.0`。
2. 移动 CHANGELOG Unreleased 到 `v0.1.0`。
3. 更新 CLAUDE、AGENTS、README、包级 README、测试状态、能力矩阵、spec 索引。
4. 运行 typecheck/test/docs/compile/smoke。
5. 生成 Windows exe 和 SHA256。
6. 提交 release commit。
7. 打 `v0.1.0` tag。
8. 推送 commit/tag。
9. 创建 GitHub Release 并上传产物。

---

## 5. 数据与状态流

### 5.1 Shell 数据

```text
books API + sessions API + provider summary
  → useShellData store
  → AgentShell 首页 / 左栏 / 最近对象
```

Shell 只展示精选会话和主要入口；完整会话管理交给 Session Center。

### 5.2 会话数据

```text
GET /api/sessions/:id/chat/state
WebSocket /api/sessions/:id/chat
PUT /api/sessions/:id
GET /api/sessions/:id/tools
POST /api/sessions/:id/tools/:tool/confirm
  → useAgentConversationRuntime
  → toConversationStatus
  → ConversationSurface
```

UI 重排不能改变现有合同，只改变展示结构和空态。

### 5.3 Provider / Settings 数据

```text
GET /api/settings/user
PUT /api/settings/user
GET /api/providers / summary / status
  → SettingsTruthModel
  → SettingsSectionContent / ProviderSettingsPage
```

所有“已接入”来自 schema、API 或 verified inventory；planned/unsupported 不参与 current claim。

---

## 6. 测试策略

### 6.1 单元 / 组件测试

- `ConversationSurface.test.tsx`
  - header cards、runtime cards、empty state、composer dock、running/idle controls。
- `StudioNextApp.test.tsx`
  - Shell 左栏最近会话/进入会话中心、session config 回读不回归。
- `SessionCenterPage.test.tsx` / `SessionCenter` tests
  - 筛选、排序、归档/恢复、打开会话、新建叙述者。
- `ProviderSettingsPage` / `SettingsTruthModel` tests
  - provider 过滤、E2E fixture 不污染 clean root、planned/unsupported 口径。

### 6.2 Playwright E2E

- 干净 root 首次打开：无测试 provider/书籍/会话。
- 首页 → 创建/打开作品 → 工作台资源 → 写作动作创建 session → 会话页。
- 会话中心：搜索、筛选、排序、归档/恢复。
- 会话页：空态、消息流、工具卡、权限确认、模型/权限/推理更新、running abort。
- 设置页：provider 可读性、runtime truthfulness。
- Routines 页：主要分组可达。

### 6.3 Release 验证

- `pnpm --dir packages/studio test -- app-next`
- `pnpm --dir packages/studio test -- backend-contract`
- `pnpm --dir packages/studio typecheck`
- `pnpm --dir packages/cli test`
- `pnpm docs:verify`
- `pnpm --dir packages/studio compile`
- compiled exe clean root smoke
- `git diff --check`

若某命令不适用或失败，必须记录真实原因，不能虚构通过。

---

## 7. 文档策略

需要同步：

- `.kiro/specs/README.md`
- `.kiro/specs/ui-live-parity-hardening-v1/tasks.md`
- `docs/01-当前状态/01-项目当前状态.md`
- `docs/01-当前状态/02-Studio能力矩阵.md`
- `docs/01-当前状态/03-当前执行主线.md`
- `docs/08-测试与质量/01-当前测试状态.md`
- `docs/90-参考资料/NarraFork参考/03-NarraFork-UIUX与交互功能调研.md`
- `packages/studio/README.md`
- root `README.md` / `AGENTS.md` / `CLAUDE.md`（版本与发布口径变化时）
- `CHANGELOG.md`

文档必须区分：

- current
- partial
- planned
- unsupported
- non-goal
- experience-not-ready
- verified-by-browser
- verified-by-release-smoke

---

## 8. 迁移与兼容

- 不恢复旧三栏、旧 ChatWindow 或 legacy route。
- 不为旧 UI 新增 shim/noop adapter。
- UI 重排必须复用当前 session runtime、Backend Contract client 和 SettingsTruthModel。
- 对外 URL 尽量保持：`/next`、`/next/books/:bookId`、`/next/narrators/:sessionId`、`/next/settings`、`/next/routines`、`/next/sessions`。
- 如果需要新增首页或会话中心子路由，应保持旧入口可跳转，不破坏已写 E2E。

---

## 9. 发布阻塞规则

以下任一情况存在时，不得发布 v0.1.0：

1. `/next/narrators/:sessionId` 仍被手工验活记录为基础 HTML 观感。
2. clean root 中出现 E2E Provider 或测试书籍。
3. 会话中心缺搜索/筛选/归档管理，导致会话只能在左栏长列表查找。
4. 设置页把 planned/unsupported 能力显示为已接入。
5. 作品工作台保存、刷新读回或 dirty guard 回归。
6. 文档仍宣称未验活路径为 current。
7. 编译产物未实际打开验证。
8. Git tag 或 GitHub Release 产物缺失。

---

## 10. 实施顺序建议

1. 固化本 spec 并生成 tasks。
2. 会话页 UI 成品化。
3. 会话中心与 Shell 左栏管理成品化。
4. 产品首页/作品入口成品化。
5. 工作台视觉与动作说明补齐。
6. 设置/Provider 可读性与夹具治理。
7. Routines 验活与必要修复。
8. 干净 root 手工验活。
9. ui-live-parity-hardening Task 14 最终收口与归档。
10. v0.1.0 release commit/tag/GitHub Release。

---

## 11. 自审

- 无 `TBD` / `TODO` 占位。
- 未要求照抄 NarraFork UI 库或节点图。
- 明确区分功能合同通过与 UI 体验达标。
- 将干净 root 与 E2E 夹具污染列为发布阻塞。
- 覆盖用户要求的“完整功能才发布 v0.1.0”。
