# NarraFork 功能对齐快速收口执行计划

> 目标不是“继续补页面”，而是用最短路径把剩余工作压缩成少数几个可交付主线包，一次完成一整包，而不是一次磨一个小点。

## 一、当前判断

基于 `07-NarraFork功能对齐任务总表.md` 当前状态：

- 未完成 `[ ]`：35 项
- 半完成 `[~]`：9 项
- 已完成 `[x]`：86 项

但这些条目存在按“模块 / Phase / 验收口径”重复描述的问题，所以**不能按 44 个零散任务去做**。

真正还剩下的是 **5 个主线包**：

1. **执行链收口包（G + E）**
   - 让 Settings / MCP / Permissions / Workflow 的配置真正影响执行器、工具调度、trace 与日志链
2. **运行时交付包（H）**
   - 让启动恢复、单文件分发、embedded 资源、repair/migration 进入可交付闭环
3. **AI 透明化深化包（D）**
   - 让 ToolCall / 执行链从“可看”变成“可重跑、可回放、可定位”
4. **Admin 实时化包（F）**
   - 让 Admin 从“能看快照”进到“能看事件流、能定位系统问题”
5. **创建 / 会话体验收尾包（B + C 深化）**
   - 项目创建直接进入可工作状态；会话恢复 / replay / reset 变成用户可理解的 UI 反馈

---

## 二、这次为什么要换计划方式

旧推进方式的问题是：

- 一次只推进 1~2 个点
- 每一轮都重新切上下文
- 频繁阶段性汇报，打断执行流
- 容易把“主线任务”拆成很多微修补

**新计划原则：**

### 1. 以“包”为单位，而不是以“点”为单位
每一轮只做完整主线包，不做零碎按钮 / 文案 / 小卡片式推进。

### 2. 每包必须完整闭环
每个主线包都必须包含：
- 后端逻辑
- 前端入口 / 反馈
- 测试补齐
- 文档更新
- 一次性验收

### 3. 能并行的并行，不能并行的就冻结
- `执行链收口包` 与 `运行时交付包` 可以并行调查、顺序合并
- `透明化 / Admin / 创建体验` 作为第二梯队跟进
- 不允许再把同一主线拆成 5 次微迭代

### 4. 每次提交的最小单位 = 一个主线包
不是“修一个测试就 commit”，而是“这条主线完整能讲清楚了再 commit”。

---

## 三、快速完成的总体策略

## Wave 1：执行链收口（最高优先级）

### 目标
把已经进入 Settings / WorkflowWorkbench / MCP 的治理配置，真正接到执行链。

### 这包完成后应达到的状态
- `runtimeControls` 不只是“能保存”，而是实际影响：
  - tool allow / prompt / deny
  - MCP strategy
  - retry / backoff / recovery
  - trace / dump / 调试链
- Workflow / MCP / Settings / 执行器口径统一
- 关键 reason / source / trace 能在 UI 上说清楚

### 核心文件
- `packages/studio/src/api/lib/runtime-tool-access.ts`
- `packages/studio/src/api/lib/user-config-service.ts`
- `packages/studio/src/api/lib/session-chat-service.ts`
- `packages/studio/src/api/routes/tools.ts`
- `packages/studio/src/api/routes/mcp.ts`
- `packages/studio/src/api/routes/context-manager.ts`
- `packages/studio/src/pages/WorkflowWorkbench.tsx`
- `packages/studio/src/pages/settings/RuntimeControlPanel.tsx`
- `packages/studio/src/pages/MCPServerManager.tsx`
- `packages/studio/src/shared/tool-access-reasons.ts`

### 完成方式（快速版）
- 先冻结 UI 小修，专注执行链贯通
- 一次性打通 `settings -> runtime config -> route decision -> trace/log feedback -> workbench/admin explanation`
- 所有治理口径只保留一套 shared helper
- 验收时一次性跑：typecheck + tools/mcp/context-manager + governance UI 回归

### 验收标准
- Settings 改动能直接改变执行行为
- MCP 策略真正影响 MCP call
- WorkflowWorkbench 不再只是摘要，而是执行链真实投影
- 所有 reason/source/trace 口径一致

---

## Wave 2：运行时交付闭环（第二优先级）

### 目标
把“开发可跑”推进成“本地交付可用”。

### 这包完成后应达到的状态
- startup orchestrator 不只是报告 recoveryReport，而是具备 repair / migration / fallback 闭环
- embedded/filesystem 双路径可验证
- `bun compile` 单文件产物形成正式 smoke 流程
- 启动失败 / 修复 / 回退有明确出口

### 核心文件
- `packages/studio/src/api/lib/startup-orchestrator.ts`
- `packages/studio/src/api/lib/__tests__/startup-orchestrator.test.ts`
- `packages/studio/src/api/server.ts`
- `packages/studio/src/api/index.ts`
- `packages/studio/src/api/embedded-assets.generated.ts`
- `packages/studio/src/api/static-provider.test.ts`
- `packages/studio/src/api/safety.ts`

### 完成方式（快速版）
- 不先做安装器 UI；先把“可交付主链”做实
- 先完成：启动检查、恢复、repair、migration、embedded smoke、compile smoke
- 安装器 / 签名 / 自动更新单列为后续独立交付包，不与主链混做

### 验收标准
- 冷启动、损坏恢复、缺索引恢复都有明确路径
- `bun compile` smoke 有稳定命令和结果
- recoveryReport 不只是打印，而是能驱动恢复决策

---

## Wave 3：AI 透明化 + Admin 实时化（第三优先级）

### 目标
把“看得到一点过程”推进成“能追踪整条执行链”。

### 这包完成后应达到的状态
- ToolCall 支持更深动作：全屏 / 重跑 / 查看源码 / 回放
- 执行链是链级可视，不只是消息级可视
- Admin 可以看实时事件而不只是 HTTP 刷新快照

### 核心文件
- `packages/studio/src/components/ChatWindow.tsx`
- `packages/studio/src/components/ToolCall/ToolCallBlock.tsx`
- `packages/studio/src/components/ToolCall/ToolCallBlock.test.tsx`
- `packages/studio/src/api/routes/runs.ts`
- `packages/studio/src/api/lib/run-store.ts`
- `packages/studio/src/components/Admin/RequestsTab.tsx`
- `packages/studio/src/components/Admin/ResourcesTab.tsx`
- `packages/studio/src/components/Admin/LogsTab.tsx`
- `packages/studio/src/components/Admin/DaemonTab.tsx`
- `packages/studio/src/components/Admin/TerminalTab.tsx`

### 完成方式（快速版）
- 先做“执行链级数据结构”，再做 UI
- ToolCall / Runs / Admin 共享同一条运行事件源
- 不再分别给每个组件补各自的小状态

### 验收标准
- 至少一条完整 run 能在前台与 Admin 双侧追踪
- ToolCall 动作不再只有查看，具备操作能力
- Logs / Requests / Resources 能围绕同一运行事实联动

---

## Wave 4：创建 / 会话体验终态（跟随包）

### 目标
把 B/C 主链剩余体验缺口一次收尾。

### 核心文件
- `packages/studio/src/pages/ProjectCreate.tsx`
- `packages/studio/src/pages/BookCreate.tsx`
- `packages/studio/src/api/book-create.ts`
- `packages/studio/src/api/lib/project-bootstrap.ts`
- `packages/studio/src/components/ChatWindow.tsx`
- `packages/studio/src/pages/SessionCenter.tsx`
- `packages/studio/src/api/routes/session.ts`
- `packages/studio/src/api/lib/session-service.ts`

### 完成方式（快速版）
- 把“首个默认工作流”与“session 恢复可见反馈”一起做掉
- 不再拆成创建流程小改 + 会话提示小改两条线

### 验收标准
- 新项目创建后直接进入可工作状态
- reconnect / replay / reset 有清晰 UI 提示
- ChatWindow 更接近纯 server-first

---

## 四、执行节奏（关键：不再一点一点磨）

## 执行规则

### 规则 1：每次只做一个主线包，但一包做完整
例如：
- 这次只做 Wave 1
- 但 Wave 1 内的后端 / 前端 / 测试 / 文档一次完成
- 不允许“先补按钮，下次再补执行器，再下次再补测试”

### 规则 2：每包只允许两个检查点
- **检查点 A：方案冻结**
- **检查点 B：整包验收**

中间不再频繁停下来做阶段汇报。

### 规则 3：每包必须单独提交
建议提交粒度：
- `feat(studio): wire runtime controls into execution chain`
- `feat(runtime): close startup recovery and compile delivery loop`
- `feat(studio): add run-level transparency and admin live diagnostics`

### 规则 4：最后统一更新总表
不在做每个小点时同步文档，避免文档更新反复打断执行。

---

## 五、推荐顺序（最快完成版）

### 推荐顺序
1. **Wave 1：执行链收口**
2. **Wave 2：运行时交付**
3. **Wave 3：透明化 + Admin 实时化**
4. **Wave 4：创建 / 会话体验终态**

### 为什么这样最快
- Wave 1 直接把“配置能保存但没完全生效”的核心短板补掉，价值最高
- Wave 2 直接把“开发态平台”推进到“可交付平台”
- Wave 3/4 更偏产品完成度，但不应先于 1/2

---

## 六、完成定义（Done Definition）

每个主线包结束时，必须同时满足：

- [ ] 相关后端逻辑完成
- [ ] 相关前端入口 / 反馈完成
- [ ] 相关测试补齐
- [ ] `pnpm --filter @vivy1024/novelfork-studio typecheck` 通过
- [ ] 相关回归测试通过
- [ ] `git status --short` 干净
- [ ] 总计划文档只在包结束时更新一次

---

## 七、一句话执行口径

> **后续不再按零散点位推进，而是按“执行链收口包 → 运行时交付包 → 透明化/Admin 包 → 创建/会话终态包”四个主线包快速收口；每包一次做完整，再统一验收。**
