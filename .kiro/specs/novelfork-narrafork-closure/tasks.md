# Implementation Plan

## Overview

本 tasks.md 只负责把 06/07/08 的**仍未完成主线**转成后续执行入口。它不再维护历史 backlog，也不再围绕 workflow 迁移本身写任务。

## Tasks

> 当前进度：Package 1 / Package 2 / Package 3 已完成并通过相关回归、typecheck 与文档回写；当前主线推进到 Package 4。

- [x] 1. 冻结并确认剩余任务事实
  - 以 07 的剩余项为主事实来源
  - 结合 08 的主线包与 done definition 去重
  - 仅吸收 06 中仍有效的 UI/入口尾项
  - 输出一份“仍未完成的真实任务簇”清单

- [x] 2. 执行 Package 1：Execution / Governance Closure
  - 打通 Settings / Workflow / MCP / Permissions / Tools 的最后一层真实影响链
  - 统一 reason / source / trace / governance 口径
  - 验证：定向测试 + typecheck + governance 相关回归

- [x] 3. 执行 Package 2：Runtime / Delivery Closure
  - 已完成 startup recovery / repair / migration 收口
  - 已完成 compile smoke 与正式交付边界固化
  - 已验证：startup/recovery/admin 相关测试 + typecheck

- [x] 4. 执行 Package 3：Transparency / Admin Deepening
  - 已完成 run-level 回放与统一运行事实源推进
  - 已完成 Admin 跨页联动与系统诊断深度强化
  - 已验证：ToolCall / Admin / run 事件流相关回归 + typecheck

- [ ] 5. 执行 Package 4：Creation / Session Endgame

  > 分工口径（**2026-04-24 更新**）：**Cascade 负责事实源 / 运行时 / 协议 / 测试 + 所有 UI/UX 落地**；**薛小川 & narrafork 负责后端其他工作**。两侧接口以 `windowRuntimeStore` / `SessionChatSnapshot` / `recoveryStatus` 语义为契约。

  - [x] 5.1 **（Cascade）会话事实源 server-first 收敛**
    - 削弱 `packages/studio/src/components/ChatWindow.tsx` 中的本地 `sessionMessages` / `sessionMessagesRef` / `recoveryStatus` 副本，改为以 `SessionChatSnapshot` + `windowRuntimeStore` 为单一事实源
    - `packages/studio/src/stores/windowStore.ts` 的 `persist` 只保留布局与 `sessionId` 关联，不再承载任何会话内容心智
    - `packages/studio/src/api/lib/session-chat-service.ts` 的 snapshot / state / message / history / ack 协议补齐边界（空会话、超时、resetRequired、超过 MAX_SESSION_MESSAGES）
    - 移除 `ChatWindow` 内 `persistSessionMessages` 直接 `PUT /api/sessions/:id` 的本地回写路径，改由服务端广播为唯一来源
    - 单测：session-chat-service 协议回归 + ChatWindow 快照/回放/重置路径
  - [x] 5.2 **（Cascade）bootstrap 初始化工作流后端链**
    - 打通"建书完成 → 默认工作流进入 → 首个 session 可直达"的后端串联（project bootstrap → default session scaffolding → session snapshot 就绪）
    - 统一 bootstrap 完成信号，通过已有事件/快照体系而不是新增本地状态通知前端
    - 回归：既有 startup / recovery / admin 测试不得被回退
  - [x] 5.3 **（Cascade）recovery 状态机补齐**
    - `WindowRecoveryState` 的五态（idle/recovering/reconnecting/replaying/resetting）在**后端事件**与**前端 store**之间一一对应，不允许仅靠前端本地定时器驱动
    - resetRequired / sinceSeq 越界 / 服务端主动 reset 的终态语义补齐并有测试
  - [x] 5.4 **（Cascade）typecheck 与自动化回归**
    - `pnpm --filter @vivy1024/novelfork-studio typecheck` 通过
    - 创建流 / 会话恢复 / ChatWindow / SessionCenter 相关单元与集成测试通过
    - `git status --short` 干净（Cascade 侧）

  - [x] 5.5 **（Cascade）初始化工作流产品化 UI** — 建书后首次会话落地

    **目标**：用户点完"创建书籍"后，在**不需要看文档、不需要问"下一步点哪里"**的前提下，自然走到第一个可用的 narrator 会话。

    **5.5.1 建书成功后的跳转策略**
    - 改 `@d:\DESKTOP\novelfork\packages\studio\src\pages\BookCreate.tsx` 的成功回调：建书成功后**不要**跳回 Dashboard；改为直接打开 `SessionCenter`（复用 `nav.toSessions()`），并让 `SessionCenter` 自动高亮由 5.2 后端创建好的 default session
    - `BookCreate.tsx` 成功 toast：`notify.success("《{title}》已创建", { description: "默认工作流已就绪，可直接开始写作" })`（`notify` 来自 `@/lib/notify`）
    - 验收：建书 → 自动落到 SessionCenter → 默认 session 卡片**已选中状态**，卡片底部有 "打开会话" CTA，点了即进入 ChatWindow

    **5.5.2 `SessionCenter` 首启空态文案**
    - 文件：`@d:\DESKTOP\novelfork\packages\studio\src\pages\SessionCenter.tsx`
    - 当 `windows.length === 0 && sessions.length === 0`（既没开过窗又没 session）时的空态，当前文案需审阅；建议：
      - 标题："还没有会话"
      - 描述："新建一本书后，默认工作流会自动创建第一个 narrator 会话"
      - 主 CTA："新建书籍" → `nav.toBookCreate()`
      - 副 CTA："新建空会话" → 打开新建会话对话框
    - 验收：空态下 CTA 按钮可点击，指向正确

    **5.5.3 新建会话对话框的默认模板**
    - 文件：`@d:\DESKTOP\novelfork\packages\studio\src\pages\SessionCenter.tsx` 里的 `CreateSessionDialog` / `SessionCenter` 内联 form
    - 当前 `sessionMode` 字段有 `chat` / `writer` / `editor` 三选；确定**默认选中**哪一个（建议：`chat`，最通用）
    - 三个模式在对话框里要有**一句话说明**（例如 chat="自由对话" / writer="写作模式" / editor="审稿模式"），不要让用户只看到英文字段
    - 验收：打开对话框默认聚焦 title 输入框；sessionMode 单选 + 中文说明；创建后 toast 成功

  - [x] 5.6 **（Cascade）recovery 五态统一 UI** — 让"网断了"和"网好了"都**看得见**

    **目标**：`idle / recovering / reconnecting / replaying / resetting` 五态在三处入口的 Badge / 颜色 / 文案完全一致；稳定态也给**正反馈**而不是沉默。

    **5.6.1 抽一个共享展示组件**
    - 当前展示逻辑散落：
      - `@d:\DESKTOP\novelfork\packages\studio\src\lib\windowRecoveryPresentation.ts`（已存在，是唯一真源）
      - `@d:\DESKTOP\novelfork\packages\studio\src\pages\SessionCenter.tsx` 里的 `formatRecoveryStateBadge` / `formatRecoveryStateDescription`
      - `@d:\DESKTOP\novelfork\packages\studio\src\components\ChatWindow.tsx` 头部状态显示
      - `@d:\DESKTOP\novelfork\packages\studio\src\components\Admin\SessionsTab.tsx`
    - 做法：新建 `@d:\DESKTOP\novelfork\packages\studio\src\components\RecoveryBadge.tsx`，封装 `<RecoveryBadge state={…} wsConnected={…} variant="chip|inline|card-corner" />`；内部调 `windowRecoveryPresentation.ts`；三处 call site 全部替换为该组件
    - 验收：grep `recoveryState === "recovering"` / `formatRecoveryStateBadge` / `formatRecoveryStateDescription` 在 Page/Component 层应全部消失，只剩 `RecoveryBadge` 引用和一个共享 presentation 模块

    **5.6.2 五态 Badge 视觉规范**（强制对齐，写进注释不要漏）
    - `idle` + `wsConnected=true` → 绿点 + "已连接" **（新增正反馈，不再隐藏）**
    - `idle` + `wsConnected=false` → 灰点 + "离线"
    - `recovering` → 蓝色旋转 + "恢复中…"
    - `reconnecting` → 琥珀色脉冲 + "重连中…"
    - `replaying` → 紫色箭头 + "回放历史"
    - `resetting` → 红色 + "重置会话"
    - 颜色走 Tailwind token（`emerald-500 / slate-400 / blue-500 / amber-500 / violet-500 / rose-500`），不要写死 hex

    **5.6.3 resetting 时的输入框状态**
    - `ChatWindow.tsx` 底部输入框：`recoveryStatus === "resetting"` 时禁用并显 placeholder "会话重置中,稍候…"
    - `replaying` / `reconnecting` 时**可输入但 send 按钮禁用**，提示 tooltip "等待连接恢复后发送"
    - 验收：断网手动冒烟三种状态下输入框行为明确

    **5.6.4 Admin SessionsTab 联动**
    - 在 Admin 会话联动视图（`SessionsTab.tsx`）的每行尾部放一个 `RecoveryBadge variant="chip"`，让运维侧不用打开 ChatWindow 也能看到五态分布

  - [x] 5.7 **（Cascade）ChatWindow 心智降格的 UI 表达** — "窗口是视图,会话是对象"

    **目标**：关闭 window 不再让用户怀疑"会话是不是丢了"。

    **5.7.1 标题栏信息密度**
    - 文件：`@d:\DESKTOP\novelfork\packages\studio\src\components\ChatWindow.tsx` 头部区域
    - 当前显示：title + recoveryStatus badge
    - 补齐：`title · {sessionMode} · {messageCount} 条消息 · #{sessionId.slice(0,6)}`
    - sessionMode 做成小 chip（`chat` / `writer` / `editor` 各一色）
    - sessionId 可点击 → `navigator.clipboard.writeText(sessionId)` + `notify.success("会话 ID 已复制")`

    **5.7.2 窗口关闭按钮语义**
    - 关闭 "×" 按钮的 tooltip / aria-label：`关闭窗口（会话保留在 SessionCenter）`
    - 第一次关闭一个有内容的 window 时（`messageCount > 0`），弹 toast：`notify.info("窗口已关闭", { description: "会话仍在 SessionCenter 可继续", duration: 3000 })`
    - 判断"第一次"可以用 `localStorage` 记一个 `closed-window-hint-shown` 标志，第二次起不再提示

    **5.7.3 空内容窗口的关闭**
    - `messageCount === 0 && sessionMessages.length === 0` 时，关闭按钮 tooltip 改为 "关闭（会话为空）"，不弹 toast
    - 这避免"点了一下就关"的用户收到无意义通知

    **5.7.4 重开窗口的正反馈**
    - 当 `SessionCenter` 里点"重新打开"一个已关闭 window 对应的 session 时：
      - 如果 5.1 的 snapshot 命中 → toast `notify.success("已恢复会话（{messageCount} 条消息）")`
      - 如果需要走 `/chat/state` 重新拉 → 先 toast `notify.info("加载会话…")`，拉到后再 `success`

  - [ ] 5.8 **（Cascade）自动化回归验收 & 包级文档回写**

    当前进度：typecheck 通过；`pnpm test` 487/491 绿（4 个失败为 Package 4 前的旧发，与本次 UI/UX 改动无关）；新增 16 个用例（`RecoveryBadge.test` 8 + `use-recovery-toasts.test` 8）。人工冒烟 + 文档回写待执行。

    **5.8.1 手动回归清单**（每一条写完用 ✅ / ❌ 标注结果）
    1. 新建书籍 → 自动落到 SessionCenter → default session 高亮
    2. 打开 default session → ChatWindow 能正常发送一条消息 → 有 assistant 回复
    3. 发消息后关闭 window → 回 SessionCenter 卡片 messageCount 已更新
    4. 再点开同一 session → 消息历史完整恢复，没有白屏/loading 残留
    5. 中途断网（devtools offline）→ ChatWindow 头部 Badge 变为 `reconnecting`
    6. 恢复网络 → Badge 依次走 `reconnecting → replaying → idle(已连接)`，toast 提示恢复成功
    7. 手动触发 reset（找到入口；若没有入口记为 ❌ 待补）→ Badge 变红 + 输入框禁用
    8. 关掉 Studio 进程 → 重新启动 → `SessionCenter` 里上次的 session 还在，点开能继续

    **5.8.2 文档回写分发**（Package 4 完成时执行一次；不新建临时报告）
    - `@d:\DESKTOP\novelfork\docs\03-代码参考\` —— 若新增 `RecoveryBadge.tsx` 等公共组件，补到组件索引
    - `@d:\DESKTOP\novelfork\docs\02-核心架构\` —— "窗口/会话/快照三者关系" 的一段话（≤ 200 字）
    - `@d:\DESKTOP\novelfork\docs\04-开发指南\` —— notify 使用规范的一段话
    - **不**新建独立 report .md 文件

- [ ] 6. 执行 Package 5：Top-Level Model & Final Acceptance
  - 明确并推进 `Project / Chapter / Narrator` 三层对象模型最小闭环
  - 统一最终验收口径
  - 明确真正剩余的长期愿景项

- [ ] 7. 执行 Package 6：NarraFork Parity & Platform Hardening

  > 背景：2026-04 体检（见 `05-调研与规划/06-narrafork-ui-ux.md` 以及当轮对话中的依赖/体量/稳定性分析）发现，NovelFork 在**对象建模**与 **recovery 心智**上已对齐 NarraFork，但在**构建产物**、**本地持久化**、**运行时面板落地度**、**Markdown / 终端 / 抓取**能力上仍有系统性欠账。本包按"先降风险、再补能力"的次序推进，不再追求 UI 组件库层面的 1:1。
  >
  > 分工口径（**2026-04-24 更新**）：延续 Package 4 —— **Cascade 承接所有 UI/UX + 构建/持久化/协议/测试**；**薛小川 & narrafork 做其他后端工作**。两侧以 `windowRuntimeStore` / Admin 面板 / `notify` API 为契约。

  - [x] 7.1 **（Cascade）客户端 bundle 路由级拆分**（🔴 必须，风险最低）
    - 已落地：`App.tsx` 用 `React.lazy + Suspense` 拆了 21 个 pages/Admin；`vite.config.ts` 补 `manualChunks` 把 tiptap/novel/grid/markdown/dnd/icons/mcp 拆成独立 vendor chunk
    - 实测：entry chunk **2085 KB → 267 KB**（-87%），rollup 大包警告消失，build 9 s
    - 顺手修复 `AppInner` 里 `React.useRef(nav)` 的 hooks-order 违规（被 Suspense 暴露）

  - [x] 7.2 **（Cascade）TipTap 版本收敛**（🔴 必须，隐性风险）— 已收敛到 2.27.2（2026-04-24）
    - 真机核对订正：`@d:\DESKTOP\novelfork\package.json:51-60` 的 `pnpm.overrides` 已把所有关键 `@tiptap/*` 固定到 `2.27.2`；`pnpm-lock.yaml` 内无任何 3.x 条目；`node_modules/.pnpm/` 下只有一套 `@tiptap+*@2.27.2`。原 tasks.md 描述的「2.x/3.x 共存」已过时。
    - 升 3.x 决策：**不升**。阻塞点为 `novel@1.0.2` 把 tiptap 当直接依赖装进自身 `node_modules`，peer 锁定 `^2.11.2`；升 3 会跨大版本 API 变更（命令链返回值、schema 合并、ProseMirror plugin view 与 React 19 concurrent 的对齐）。在 `novel` 上游升 3 或被替换前不动。
    - 决策落档：`@d:\DESKTOP\novelfork\docs\04-开发指南\05-调研规划\12-TipTap版本收敛spike.md`（含触发升级的信号、对冲建议）。
    - 验收（2026-04-24）：`Select-String pnpm-lock.yaml "@tiptap/[^']+@3\."` → 0 条；`pnpm --filter @vivy1024/novelfork-studio test` 全绿；编辑器场景真机冒烟由 7.8 阶段负责。

  - [ ] 7.3 **（Cascade + narrafork）统一 Toast / 通知中心**（🟡 UX 欠账）

    - [x] 7.3.1 **（Cascade 已完成）基建**：`sonner` 已装；`@d:\DESKTOP\novelfork\packages\studio\src\lib\notify.ts` 提供 `success / error / warning / info / message / dismiss` 六通道；`App.tsx` 挂 `<Toaster position="bottom-right" richColors closeButton />`；5 个单测覆盖载荷构造与类型路由

    - [x] 7.3.2 **（Cascade）把散落的 console.warn / alert 替换到 notify**

      已落地：grep `^\s*alert\(` 结果 = 0；`notify.*` 调用覆盖 BookCreate / BookDetail / ChapterReader / ConfigView / DaemonControl / DataPanel / Dashboard / DetectionConfigView / GenreManager / LLMAdvancedConfig / NotifyConfig / SchedulerConfig / TruthFiles / WorktreeManager / AgentConfigPanel / ChatWindow 等 16 个文件。纯 debug 用的 `console.warn` 按规则保留。

      **执行清单**（grep 找出、逐个替换）：

      ```powershell
      # 运行这两条命令得到所有待替换点
      rg "console\.warn\(|console\.error\(" packages/studio/src --type ts --type tsx -l
      rg "alert\(" packages/studio/src --type ts --type tsx -l
      ```

      **替换规则**：
      - 纯 debug 用途的 `console.warn`（如 `console.warn("[debug] …")`）→ **保留**
      - 用户可见的错误（"保存失败" / "网络错误" / "权限不足" / catch 后提示）→ `notify.error(…)`
      - 成功提示（保存成功、复制成功）→ `notify.success(…)`
      - 进度性提示（"加载中…"）→ `notify.info(…, { id: "…" })`（用固定 id 让后续 success 替换同一条）
      - 所有 `alert(…)` → **必须**改为 `notify.warning` 或 `notify.error`（alert 阻塞 UI，不可保留）

    - [x] 7.3.3 **（Cascade）recovery 五态强制 toast 打点**

      已落地：`@d:\DESKTOP\novelfork\packages\studio\src\hooks\use-recovery-toasts.ts` 订阅 `windowRuntimeStore.recoveryStates`，在 `idle→reconnecting` / `reconnecting→replaying` / `replaying→idle` / `*→resetting` 跳变上发 toast，统一 id = `recovery-<windowId>`。App 入口 `useRecoveryToasts()` 挂载。同步 8 个单测覆盖动、不重复用、同 id 覆盖、首次出现不启 toast。

      在 `@d:\DESKTOP\novelfork\packages\studio\src\stores\windowRuntimeStore.ts` 的 `setRecoveryState` 调用处或上层消费处，做以下打点：

      | 状态跳变 | toast |
      |---|---|
      | `idle → reconnecting` | `notify.warning("连接中断，正在重连…", { id: "recovery-" + windowId })` |
      | `reconnecting → replaying` | `notify.info("正在回放历史…", { id: "recovery-" + windowId })` |
      | `replaying → idle` | `notify.success("会话已恢复", { id: "recovery-" + windowId })` |
      | `* → resetting` | `notify.error("会话已重置", { description: "历史记录可能已丢失", id: "recovery-" + windowId })` |

      用**相同 id** 保证同一 window 的 recovery 生命周期始终只有一条 toast，后续状态覆盖前一条。

    - [x] 7.3.4 **（Cascade）三处最小打点验收**

      验收结果：
      - `SessionCenter.tsx`：新建 session 已走 `notify` (5.5 已落)；delete/archive 操作依托 `useRecoveryToasts` + `notify` 在外层反馈。
      - `ChatWindow.tsx`：复制 sessionId 成功/失败两条 `notify` 打点 (5.7.1)；关闭非空窗口的一次性提示 (5.7.2)。
      - `Admin/SessionsTab.tsx`：目前只读，无操作按钮，`RecoveryBadge` 已统一反馈。

  - [x] 7.4 **（Cascade）Markdown 能力扩展（GFM + 数学）**（🟡 低成本高感知）
    - 已落地：安装 `remark-gfm`/`remark-math`/`rehype-katex`/`katex`；升级 `MarkdownRenderer.tsx` 加 remarkPlugins/rehypePlugins；GFM 表格/任务列表/删除线 + 行内/块级数学全部支持；KaTeX CSS 走 lazy import
    - 已新增：`MarkdownRenderer.test.tsx` 6 个用例（表格 / 任务列表 / 删除线 / 代码块 / 行内数学 / 块数学）

  - [x] 7.5 **（Cascade）本地持久化升级评估 —— better-sqlite3 + drizzle**（⚪ 长期方向，仅 spike）
    - 产出：`@d:\DESKTOP\novelfork\docs\04-开发指南\05-调研规划\10-持久化迁移spike.md`
    - 结论：**暂不迁**；若将来迁，首选方案 C（Node 侧 `better-sqlite3 + drizzle-orm`，Tauri 侧 `@tauri-apps/plugin-sql`，通过 `storage/adapter.ts` 接口隔离）；首个迁移对象是 `sessions.json` + `session-history/`，**不**迁章节正文（破坏"可手动 git 管"的心智）

  - [x] 7.6 **（Cascade）Bash 工具安全审查 —— tree-sitter 引入评估**（⚪ 可选）
    - 产出：`@d:\DESKTOP\novelfork\docs\04-开发指南\05-调研规划\11-Bash-AST审查spike.md`
    - 结论：**暂不引入**；推荐先做 3 件 ROI 更高的小事（补 4 条正则 / 黑名单移到 JSON 清单 / BashTool 加 dry-run 模式）

  - [x] 7.7 **（Cascade）TerminalTab / RadarView 空壳落地决策**（⚪ 非阻塞）

    **目标**：对两个长期处于"有壳无后端"状态的入口做一次性产品决策，避免后续继续悬而未决。

    **决策结果（2026-04-24）**：
    - **TerminalTab → 选 C：立即删除**。`Admin/TerminalTab.tsx` 及其单测已移除；`Admin.tsx` / `routes.ts` / `use-tabs.ts` / `Admin.test.tsx` / `use-tabs.test.ts` 中的 `"terminal"` AdminSection 已清理。理由：LogsTab 已提供只读日志流，当前不需要第二个终端入口；若将来真需 shell，可重新拆 spec。
    - **RadarView → 选 A：保留，有真后端**。原惑案被订正：`packages/studio/src/api/routes/ai.ts` 中 `/api/radar/scan` 映射到 `PipelineRunner.runRadar()`，且 `server.ts` 配置与 `scheduler` 都引用 `radarCron`。`pages/RadarView.tsx` 及路由均保留不动。

    **7.7.1 TerminalTab**
    - 文件：`@d:\DESKTOP\novelfork\packages\studio\src\components\Admin\TerminalTab.tsx`
    - 对照：NarraFork 用 bun-pty + xterm 做真正的终端
    - 决策选项：
      - **A. 保留并做**：拆独立 spec，评估 `@xterm/xterm` + `node-pty`（或 Tauri Rust sidecar）接入代价；Windows 下需要 `conpty`
      - **B. 保留但做"只读日志流"降级**：改成复用 `LogViewer` + 实时 tail，去掉"可输入"的心智
      - **C. 立即删除**：移除文件、移除 Admin 路由项、清理相关路由枚举
    - 建议：**B**（ROI 最高，且与现有 LogViewer 复用）
    - 若选 C：同步删除 `@d:\DESKTOP\novelfork\packages\studio\src\components\Admin\Admin.tsx` 里对 TerminalTab 的引用

    **7.7.2 RadarView**
    - 文件：`@d:\DESKTOP\novelfork\packages\studio\src\pages\RadarView.tsx`
    - 对照：NarraFork 用 puppeteer-core + @mozilla/readability 抓取外部小说资讯
    - 决策选项：
      - **A. 保留并做**：拆独立 spec，引入 puppeteer 或换轻量方案（fetch + cheerio + readability），后端加代理路由避 CORS；存在法务风险
      - **B. 改为"链接聚合器"降级**：去掉抓取，只做手动收藏/分类，失去"自动雷达"心智
      - **C. 立即删除**：移除 `pages/RadarView.tsx`、`App.tsx` 里的 lazy import 和 `routes.ts` 的 `"radar"` 分支
    - 建议：**C**（NovelFork 是"写作工具"，外部抓取偏离核心价值；法务风险不小）

    **7.7.3 决策落档**
    - 在 `@d:\DESKTOP\novelfork\docs\04-开发指南\05-调研规划\06-Studio-UIUX改造清单.md` 末尾追加一节 "## 附录 A：TerminalTab / RadarView 取舍（2026-04）"，记录选了哪条 + 一行理由
    - 若决策为 C，代码清理由 narrafork 执行；若为 A/B，拆独立 spec，**不**在本包实现

  - [ ] 7.8 **（Cascade）Package 6 done definition**
    - `pnpm --filter @vivy1024/novelfork-studio typecheck` 通过
    - `pnpm --filter @vivy1024/novelfork-studio test` 全绿（ChatWindow / Admin / SessionCenter 回归不得劣化）
    - `pnpm --filter @vivy1024/novelfork-studio build:client` 主 chunk < 900 KB 且无 rollup 大包警告
    - `git status --short` 干净
    - 按任务 8 的 done definition 回写 `02-核心架构` / `03-代码参考` / `04-开发指南`，不新建临时报告

- [x] 7.9 **（Cascade）Package 6 真机回归修复清单**（🔴 2026-04-24 发现 / 高优先级）

  > **背景**：Package 4/5/6 的自动化测试与构建全部通过，但真机冒烟（本地 exe + Vite dev）暴露出一批 runtime 级 bug，核心症结是"启动链路透明度不足 + WebSocket 未挂 + 构建产物模式不明"。参考 NarraFork 的结构化启动日志标准重建诊断链。
  >
  > **执行节奏**：先做 **7.9A runtime hotfix**（7.9.1 / 7.9.3 / 7.9.4 / 7.9.7 / 7.9.8 / 7.9.9），保证 Studio 真机主链可用；再做 **7.9B NarraFork parity hardening**（7.9.2 / 7.9.5 / 7.9.6 / 7.9.10），补齐发布与运行态成熟度。7.9A 可独立验证、独立提交，不必等待 7.9B 全部完成。

  - [x] 7.9.1 **（Cascade / P0 / 7.9A）session chat WebSocket 未注册导致 ChatWindow 整体不通** — 已完成（自动化 + 真实 UI 冒烟通过）
    - 现象：打开 SessionCenter → 打开工作台 → ChatWindow 常驻「重连中」；DevTools 报 `ws://.../api/sessions/<id>/chat → 400`；`/api/sessions/:id/chat/state` HTTP 200 但 WS 握手失败
    - 根因：`@d:\DESKTOP\novelfork\packages\studio\src\api\server.ts` 的 `startStudioServer` 只调用了 `setupAdminWebSocket(startedServer)`，**从未调用** `setupSessionChatWebSocket(startedServer)`；此外 `setupSessionChatWebSocket` 原签名只接受 `@hono/node-server.ServerType`，不支持 bun runtime（编译后的 exe 场景）
    - 状态拆分：
      - [x] 扩展 `@d:\DESKTOP\novelfork\packages\studio\src\api\start-http-server.ts::BunWebSocketRoute` 增加 `matchPath?(pathname): boolean`，让 bun 端支持含 `:id` 的动态 path 匹配；`fetch` 路由器改为 `matchPath || path===pathname`
      - [x] 重写 `@d:\DESKTOP\novelfork\packages\studio\src\api\lib\session-chat-service.ts::setupSessionChatWebSocket` 为 runtime-agnostic：接受 `StartedHttpServer`，bun 分支走 `registerWebSocketRoute`（通过 `socket.data.routePath/sessionId/resumeFromSeq` 传 context），node 分支保留原 `wss.handleUpgrade`
      - [x] 在 `server.ts` 挂载 `setupSessionChatWebSocket(startedServer)`，并打结构化启动日志 `[startup] WebSocket routes registered: /api/admin/resources/ws, /api/sessions/:id/chat`
      - [x] `packages/studio/vite.config.ts` 的 `/api` 代理补 `ws: true`，让 dev 模式 WebSocket 能穿透 Vite 代理
      - [x] `@d:\DESKTOP\novelfork\packages\studio\src\api\server.test.ts` 增加 `expect(setupSessionChatWebSocketMock).toHaveBeenCalledWith(startedServer)` 断言（与现有 admin WS 的断言同形）
      - [x] `session-chat-service.test.ts` 补 bun 注册路径的最小覆盖（mock `registerWebSocketRoute` 调用次数 + `matchPath("/api/sessions/x/chat")` 返回 true）
      - [x] 手动冒烟：dev 模式 ChatWindow 从 `reconnecting → idle`、发送按钮解禁、消息往返正常；真实 UI 发现并修复 `replaying` 卡住问题
      - [x] 手动冒烟：exe 模式 ChatWindow 可连接、可发、可收
      - [x] UX 打磨：`@d:\DESKTOP\novelfork\packages\studio\src\components\ChatWindow.tsx` 在 RecoveryBadge banner 叠一个「立即重连」按钮（仅 `!wsConnected || reconnecting` 时显示），点击走 `manualReconnectRef` 跳过默认 5 秒退避，close 现有 ws 并立刻 `connectWs()`；不破坏 `ChatWindow.test.tsx` 19/19 绿
    - 自动化验证（2026-04-24）：`src/api/server.test.ts`、`src/api/lib/session-chat-service.test.ts` 覆盖通过；全量 `pnpm --filter @vivy1024/novelfork-studio test` 通过。

  - [x] 7.9.2 **（narrafork 后端 / P0-release / 7.9B）exe 是否真正走 embedded assets 不透明** — 已完成（2026-04-24）
    - 现象：`pnpm bun:compile` 产出 `dist/novelfork.exe`（~117 MB），但**无法确认**运行时到底加载的是 embedded assets 还是 filesystem `packages/studio/dist/`；当前启动日志里只有 `static-delivery filesystem`
    - 优先级口径：这是发布阻塞项（P0-release），但不阻断 7.9A 的日常 Studio 主链修复；若当前目标是先恢复 dev / 本地工作台体验，可排在 WebSocket、tab、Radar 错误之后
    - 参考：NarraFork 启动日志 `{"msg":"NarraFork server running","isProd":true,"isCompiledBinary":true,"assetSource":"embedded"}` 一行表达清晰
    - 做法：
      - 在 `@d:\DESKTOP\novelfork\packages\studio\src\api\static-provider.ts`（以及 embedded 版本）里暴露 `describe(): { source: "embedded" | "filesystem"; root?: string; assetCount?: number }`
      - `server.ts` 启动完成时打一行结构化日志：`{"level":"info","msg":"NovelFork Studio running","url":"http://localhost:<port>","isProd":...,"isCompiledBinary":...,"assetSource":"embedded|filesystem","metaUrl":import.meta.url,"exePath":process.execPath,"projectRoot":...}`
      - `isCompiledBinary` 判定：`typeof (globalThis as any).Bun !== "undefined" && import.meta.url.startsWith("file:") && process.execPath.endsWith(".exe")` 等组合条件，放独立 `detectRuntimeMode()` 函数并单测
    - 验收：exe 启动日志必须含 `isCompiledBinary:true` + `assetSource:"embedded"`；dev/node 启动含 `isCompiledBinary:false` + `assetSource:"filesystem"`
    - 已落地：`static-provider.ts` 暴露 `describe()`；新增 `runtime-mode.ts::detectRuntimeMode()`；`server.ts` 启动时输出结构化 `static.provider` 与 `server.listen`，包含 `assetSource` / `isProd` / `isCompiledBinary` / `runtime` / `metaUrl` / `exePath` / `projectRoot`。
    - 自动化验证（2026-04-24）：`src/api/static-provider.test.ts`、`src/api/lib/runtime-mode.test.ts`、`src/api/server.test.ts` 覆盖通过；`pnpm bun:compile` 成功产出 `dist/novelfork.exe`。

  - [x] 7.9.3 **（Cascade / P1 / 7.9A）routeToTabLabel 在无 section 时仍拼 "undefined"** — 已完成（2026-04-24）
    - 现象：用户点侧边栏「管理中心」/「设置」后，tab 标题显示 `管理 · undefined` / `设置 · undefined`
    - 根因确认：`parseOptionalString` 把字面字符串 `"undefined"` / `"null"` 当有效值透传；`routeToTabLabel` 又信任 section 值直接拼 label
    - 已落地：
      - [x] `@d:\DESKTOP\novelfork\packages\studio\src\routes.ts::parseOptionalString` 过滤 `"undefined" / "null" / ""`（去空白后）
      - [x] `@d:\DESKTOP\novelfork\packages\studio\src\hooks\use-tabs.ts::routeToTabLabel` admin/settings 两个分支都加白名单回落
      - [x] `use-tabs.test.ts` 补 4 个回归用例覆盖 `section=undefined` / `section="undefined"` / 未知 section / settings 分支；全量 35/35 通过

  - [x] 7.9.4 **（Cascade / P1 / 7.9A）RadarView 错误直出原始英文 CLI 提示** — 已完成（2026-04-24）
    - 决策口径：RadarView 已在 7.7 订正为「保留，有真后端」，本项只修错误可读性与配置跳转，不再重新讨论删除入口
    - 现象：RadarView → 扫描市场 → 显示 `Error: NOVELFORK_LLM_API_KEY not set. Run 'novelfork config set-global' or add it to project .env file.`；POST `/api/radar/scan` 500
    - 已落地：
      - [x] 后端：`@d:\DESKTOP\novelfork\packages\studio\src\api\routes\ai.ts` 的 `/api/radar/scan` 捕获缺少 LLM API Key 的已知错误签名，返回 `{ code: "LLM_CONFIG_MISSING", message, hint }` 结构，HTTP 400 而非 500
      - [x] 前端：`@d:\DESKTOP\novelfork\packages\studio\src\pages\RadarView.tsx` 已用 `describeLlmError` 渲染中文错误卡片；`@d:\DESKTOP\novelfork\packages\studio\src\lib\llm-error.ts` 支持后端结构化 `code`，并保留「去配置供应商」跳转
    - 自动化验证（2026-04-24）：`src/api/server.test.ts` 覆盖结构化 400；`src/lib/llm-error.test.ts` 覆盖结构化 code 映射；全量 `pnpm --filter @vivy1024/novelfork-studio test` 通过。
    - 真实 UI 复核（2026-04-24）：真机缺 API Key 点击扫描显示中文「模型配置未完成」卡片，不显示英文 CLI 原文 / 堆栈；「去配置供应商」跳转到 Admin Providers。复核时发现 ProvidersTab 渲染对象模型会白屏，已修复为兼容 string/object 模型。

  - [x] 7.9.5 **（narrafork 后端 / P1 / 7.9B）启动日志结构化改造（对标 NarraFork）** — 已完成（2026-04-24）
    - 目标：每个 startup stage 都有结构化 JSON，含 `level/msg/component/ok|skipped|failed/reason/userImpact`
    - 做法：
      - 新建 `@d:\DESKTOP\novelfork\packages\studio\src\api\lib\startup-logger.ts`：`logStartupEvent({ level, component, msg, ok, reason?, extra? })` 输出单行 JSON（dev 环境可切 pretty）
      - 迁移点（按现有 `startup-orchestrator.ts` 阶段）：
        - `config.load` / `database.migrate` / `search.index.rebuild`（含 `reason: "unclean_shutdown" | "first_run" | null`）
        - `git.detect`（含 `version`）
        - `static.provider`（含 `source: embedded|filesystem`）
        - `websocket.register`（每条路由一行）
        - `mcp.init` / `mcp.connected`（若已有 MCP 调度）
        - `server.listen`（含完整 runtime 矩阵，见 7.9.2）
      - 最后打印一行 `startup.summary`：`{ ok: n, skipped: m, failed: k, durationMs }`
    - 不动项：现有 `startupSummary` / `recoveryReport` UI 层字段保持兼容，日志仅增补不替换
    - 已落地：新增 `api/lib/startup-logger.ts`，统一输出单行 JSON；`server.ts` 接入 `config.load`、`static.provider`、`server.listen`、`websocket.register`；保留现有 `Startup recovery report` 与 Admin startup summary 数据结构。
    - 自动化验证（2026-04-24）：`src/api/lib/startup-logger.test.ts`、`src/api/server.test.ts` 覆盖通过；定向 7.9B 测试 9 files / 66 tests 通过。

  - [x] 7.9.6 **（narrafork 后端 / P1 / 7.9B）startup repair 增强：对标 NarraFork 的自愈链** — 已完成（2026-04-24）
    - 现有覆盖（Package 2 已做）：startup recovery report / migration / compile smoke
    - 新增检查项：
      - `unclean-shutdown` 标记文件（启动时写入 `.novelfork/running.pid`，优雅退出时删除；启动检测到残留即判定为 unclean）
      - `git-worktree pollution`：扫描 `.novelfork-worktrees/`（或等价路径）里凡是绝对路径**不落在当前 `projectRoot` 下**的 entry → 报告为污染，提供「修复」按钮（由用户确认后 `git worktree remove`）；同时排查 P2.7 提到的 `D:/DESKTOP/sub2api/inkos-master/...feature-test` 残留
      - `session-store repair`：校验 `sessions.json` + `session-history/` 目录一致性（orphan history files / dangling snapshots）
      - `search-index rebuild reason` 明确（首启 / unclean shutdown / 手动触发）
      - `websocket-route matrix` 打点（见 7.9.5）
      - `provider/gateway availability` 打点（"OpenAI 网关可达" / "Claude key 未配"）
    - 数据打到 `startupSummary`，在 Dashboard / Admin 一个「系统自愈报告」卡里展示
    - 已落地：新增 `api/lib/startup-diagnostics.ts`，覆盖 `unclean-shutdown` marker、session-store 一致性、git worktree pollution、provider availability；`startup-orchestrator.ts` 扩展 diagnostics 输入并将失败写入 `recoveryReport.actions` / `failures`；`server.ts` 启动时收集 diagnostics 并传入 startup recovery。
    - 安全边界：外部 worktree 仅检测与报告，不自动删除；危险修复仍保留人工确认/后续 UI 操作，不误删兄弟项目数据。
    - 自动化验证（2026-04-24）：`src/api/lib/startup-diagnostics.test.ts`、`src/api/lib/__tests__/startup-orchestrator.test.ts`、`src/api/server.test.ts` 覆盖通过。

  - [x] 7.9.7 **（Cascade / P2 / 7.9A）PWA manifest 144x144 图标尺寸不匹配** — 已完成（2026-04-24）
    - 现象：DevTools 稳定报 `Error while trying to use the following icon from the Manifest: /icons/icon-144x144.png — Resource size is not correct`
    - 根因：`public/icons/*.svg` 是真实尺寸，但 `*.png` 全是同一张 300×298 占位图被 manifest 全部引用
    - 已落地：用 PowerShell + System.Drawing 按 SVG 同配色（`#3b82f6` 蓝底 + 白字 NovelFork/NF）批量生成 8 张尺寸正确的 PNG（72/96/128/144/152/192/384/512）
    - 验收：每张 PNG 像素维度与 manifest `sizes` 一一对应，reload 后 console 无报错

  - [x] 7.9.8 **（Cascade / P2 / 7.9A）新建书籍弹窗表单可访问性** — 已完成（2026-04-24）
    - 现象：BookCreate dialog 打开时 DevTools 报 `No label associated with a form field (count: 11)` / `A form field element should have an id or name attribute (count: 6)`
    - 已落地（`@d:\DESKTOP\novelfork\packages\studio\src\pages\BookCreate.tsx`）：
      - 7 个 `<input>`（title / genre repo path / clone url / git branch / worktree name / chapter words / target chapters）补齐 `id` + `name` + `<label htmlFor>` + 语义 `type`（url / number + min）
      - 5 个 button-group（repoSource / workflow / template / genre / platform）从孤儿 `<label>` 改为 `role="group" aria-labelledby` + 子按钮 `aria-pressed` 指示选中态
      - `BookCreate.test.tsx` 4/4 测试保持绿；typecheck 干净

  - [x] 7.9.9 **（Cascade / P2 / 7.9A）WorktreeManager 跨项目路径泄漏** — 已完成（2026-04-24）
    - 现象：Admin → Worktree 管理 显示 `D:/DESKTOP/sub2api/inkos-master/packages/studio/.test-workspace/.inkos-worktrees/feature-test` 等非当前项目路径
    - 已落地：
      - [x] `@d:\DESKTOP\novelfork\packages\studio\src\api\lib\git-utils.ts`：新增 `isPathInsideRoot()`，统一判断 worktree 是否属于当前项目根
      - [x] `@d:\DESKTOP\novelfork\packages\studio\src\api\routes\worktree.ts`：`/api/worktree/list` 为每个 entry 返回 `isExternal`
      - [x] `@d:\DESKTOP\novelfork\packages\studio\src\api\routes\admin.ts`：新增 `/api/admin/worktrees` 快照，统一返回主仓库/附加 worktree、变更计数、`isPrimary`、`isExternal`
      - [x] `@d:\DESKTOP\novelfork\packages\studio\src\hooks\use-worktree.ts`：`Worktree` 新增 `isExternal` / `externalReason`；新增 `classifyWorktrees()`（backend flag 优先 + 最长公共前缀 fallback 启发式）与 `getVisibleWorktrees(list, showExternal)`
      - [x] `@d:\DESKTOP\novelfork\packages\studio\src\pages\WorktreeManager.tsx`：加「仅显示当前项目」checkbox（默认开）+ 已过滤数量 chip + 空态「显示 N 个外部 Worktree」兜底按钮；外部项目卡片角标「外部项目（推测）/ 外部项目」区分来源
      - [x] `use-worktree.test.ts` 7 用例（空 / 内部子路径 / 外部启发式 / backend flag 覆盖启发式 / 大小写-分隔符归一化 / 全 bare / `getVisibleWorktrees` 切换），全绿
    - 自动化验证（2026-04-24）：`src/hooks/use-worktree.test.ts`、`src/components/Admin/WorktreesTab.test.tsx`、`src/api/routes/admin.test.ts` 与全量 `pnpm --filter @vivy1024/novelfork-studio test` 通过。
    - 真实 UI 复核（2026-04-24）：Admin → Worktree 管理默认隐藏兄弟项目路径，仅显示当前项目 worktree；点击「显示外部 Worktree」后才显示 `sub2api` 外部路径并标记「外部项目」。复核时发现 Admin 未实际挂载 `WorktreesTab`，已补齐。

  - [x] 7.9.10 **（P2 / 7.9B）node-server `Failed to find Response internal state key` 警告** — 已完成（2026-04-24）
    - 现象：standalone server 启动日志偶发出现 `Failed to find Response internal state key`
    - 初判：`@hono/node-server` 某条路径上拿 `Response` 内部字段时版本不匹配；不阻塞功能但污染日志
    - 做法：
      - 确认 `@hono/node-server` 与 `hono` 的版本匹配（当前 `@hono/node-server@1.13.0` + `hono@4.7.0`）
      - 若升级后仍存在，加 node-server PR / issue 链接并在启动日志里 rate-limit 这一行（5s 内同样 msg 只打一次）
    - 验收：启动日志 5 秒内不出现重复的 `Failed to find Response internal state key`
    - 已落地：`start-http-server.ts` 新增 `createRateLimitedWarningSink()`，node fallback 安装 `console.warn` 过滤器；同一 `Failed to find Response internal state key` 5 秒内只保留首条，不影响其他 warning。
    - 自动化验证（2026-04-24）：`src/api/start-http-server.test.ts` 覆盖 5 秒窗口去重与普通 warning 保留；全量测试通过。

  - [x] 7.9.11 **（Cascade）done definition** — 已完成（7.9A/7.9B 自动化 + exe smoke + 真人 UI 复核完成）
    - **7.9A 可先收口并提交**：`pnpm --filter @vivy1024/novelfork-studio typecheck` 通过；相关测试全绿（WS / routeToTabLabel 防御 / Radar 错误渲染 / a11y / Worktree 过滤）；手动冒烟「新建书籍 → 进 SessionCenter → ChatWindow 可发可收 → 断网能重连；RadarView 缺 key 有中文提示与跳转按钮；管理/设置 tab 标题正确」通过；`git status --short` 中仅剩与 7.9B 相关的未提交项或已干净
    - 自动化验证进度（2026-04-24）：
      - [x] `pnpm --filter @vivy1024/novelfork-studio exec vitest run src/api/server.test.ts src/api/lib/session-chat-service.test.ts src/hooks/use-worktree.test.ts src/lib/llm-error.test.ts src/components/Admin/Admin.test.tsx src/App.test.tsx src/components/Admin/WorktreesTab.test.tsx`：59 tests 通过
      - [x] `pnpm --filter @vivy1024/novelfork-studio exec vitest run src/api/routes/admin.test.ts`：10 tests 通过
      - [x] `pnpm --filter @vivy1024/novelfork-studio typecheck`：通过
      - [x] `pnpm --filter @vivy1024/novelfork-studio test`：75 files / 510 tests 通过
      - [x] `pnpm --filter @vivy1024/novelfork-studio exec vitest run src/api/static-provider.test.ts src/api/lib/runtime-mode.test.ts src/api/lib/startup-logger.test.ts src/api/lib/startup-diagnostics.test.ts src/api/lib/__tests__/startup-orchestrator.test.ts src/api/start-http-server.test.ts src/api/server.test.ts src/api/routes/admin.test.ts src/components/Admin/ResourcesTab.test.tsx`：9 files / 66 tests 通过
      - [x] `pnpm --filter @vivy1024/novelfork-studio typecheck`：通过
      - [x] `pnpm --filter @vivy1024/novelfork-studio test`：79 files / 524 tests 通过
      - [x] `pnpm bun:compile`：通过，生成 `dist/novelfork.exe`；构建日志含既有 Rollup pure annotation / dynamic import 警告，不阻断编译
      - [x] exe 冒烟（2026-04-24）：`./dist/novelfork.exe --port=4579 --root=D:/DESKTOP/novelfork` 启动成功；日志确认 `isProd:true` + `isCompiledBinary:true` + `assetSource:"embedded"` + `WebSocket routes registered` 两条路由。
      - [x] exe HTTP/WS 冒烟（2026-04-24）：`GET /` 返回 embedded index；`POST /api/sessions` 成功；`ws://127.0.0.1:4579/api/sessions/<id>/chat` 返回 `session:snapshot`；`POST /api/radar/scan` 在缺 key 时返回结构化 400 + 中文 message；`GET /api/admin/worktrees` 可识别外部 worktree。
      - [x] 真人 UI 复核（2026-04-24）：dev 模式 ChatWindow 完整发收与断网恢复通过；RadarView 缺 key 中文错误与供应商跳转通过；Admin Worktree UI 默认隐藏外部路径、点击后可显示外部路径通过。
      - [x] `git status --short` 在 7.9B 提交后干净；7.9B 代码提交：`83879f2 feat(studio): complete 7.9B startup hardening`
    - UI/UX 交互复核（2026-04-24，提交 `1f150ec` + `d3d837c`）：
      - [x] `ChatWindow` 手动重连竞态：`manualReconnect` 先解除旧 ws handlers 再 `close()`，避免旧 `onclose` 把 `wsConnected` 翻回 false / 重复排 5s timer 造成第三次连接
      - [x] `WorktreeManager` render 内 setState：viewingChangesPath 对应 worktree 被删时的回退从 render 迁移到 `useEffect`
      - [x] `WorktreeManager.handleOpenWorktree` clipboard 静默成功：改为 `await + try/catch`，拒绝时发 `notify.error`
      - [x] `RecoveryBadge` banner 新增 `action` slot，`ChatWindow` 的「立即重连」从 `absolute` 浮层改为 banner 内 flex 子项，不再遮挡描述文字；新增 3 个回归测试（in-flow 渲染 / bannerVisible=false 不渲染 / 非 banner variant 忽略 action）
      - [x] `use-recovery-toasts` 增补 `idle+online → idle+offline` 的 `会话暂时离线` warning toast，非 idle 态不重复叠加；+3 测试
      - [x] `@/lib/closed-window-hint.ts` 抽出首次关窗提示，`ChatWindow.handleClose` 与 `SessionCenter` 卡片「关闭窗口」共用一套 first-run hint；in-memory + localStorage 双重去重，兼容 embedded / file:// 抛错；+4 测试
      - [x] `MonitorWidget` 僵尸重连修复：cleanup 前解除旧 ws handlers、`disposed` 标志阻断 `onclose` 的 5s 重连 timer
      - 自动化验证（2026-04-24）：`pnpm --filter @vivy1024/novelfork-studio typecheck` 通过；`pnpm --filter @vivy1024/novelfork-studio test`：534 tests 中 533 passed，1 failed 是预先存在的 Windows `sleep` 平台问题（`src/api/__tests__/tools-worktree.test.ts`），与本次修复无关
    - **7.9B 自动化与 exe smoke 已完成并提交**：`pnpm --filter @vivy1024/novelfork-studio test` 全绿（新增 startup logger / runtime mode / startup repair / node warning 相关用例）；`pnpm bun:compile` 产出 exe；启动日志确认 `isCompiledBinary:true` + `assetSource:"embedded"` + `WebSocket routes registered`。
    - **真实 UI 复核补丁（2026-04-24）**：修复 ChatWindow 重连回放后不退出 `replaying`、ProvidersTab 对象模型渲染白屏、Admin Worktree 子页未挂载、WorktreesTab 默认暴露外部项目路径、bun CLI 被误判为 compiled binary。验证：定向 5 files / 32 tests 通过；typecheck 通过；全量 80 files / 537 tests 通过；`pnpm bun:compile` 通过；bun main 日志 `isCompiledBinary:false`，exe 日志 `isCompiledBinary:true`。
    - Package 6 最终收口：`git status --short` 干净，并按任务 8 的 done definition 回写相关文档

- [ ] 8. 每个 package 完成时执行统一 done definition
  - 已完成：Package 1 / 2 / 3 已按该口径完成后端、前端入口/反馈、测试、typecheck、相关回归与文档回写
  - 待继续：Package 4 / 5 / 6 完成时继续执行同一 done definition
  - 检查项：后端完成
  - 检查项：前端入口/反馈完成
  - 检查项：测试补齐
  - 检查项：typecheck 通过
  - 检查项：相关回归测试通过
  - 检查项：`git status --short` 干净
  - 检查项：文档在包结束时回写一次

- [ ] 9. 当且仅当本 Kiro spec 已完整承接旧文档有效内容时，再退役旧文档
  - 删除 06 / 07 / 08
  - 删除旧自由 plan 文件
  - 保证后续入口只剩 `.kiro/specs/<feature>/requirements.md + design.md + tasks.md`
