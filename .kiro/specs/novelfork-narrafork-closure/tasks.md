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

  > 分工口径：**Cascade 负责事实源 / 运行时 / 协议 / 测试**；**薛小川负责产品交互 / UI 终态 / 文案 / 人工验收**。两侧接口以 `windowRuntimeStore` / `SessionChatSnapshot` / `recoveryStatus` 语义为契约，不得绕过。

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

  - [ ] 5.5 **（narrafork）初始化工作流产品化 UI** — 建书后首次会话落地

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

  - [ ] 5.6 **（narrafork）recovery 五态统一 UI** — 让"网断了"和"网好了"都**看得见**

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

  - [ ] 5.7 **（narrafork）ChatWindow 心智降格的 UI 表达** — "窗口是视图,会话是对象"

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

  - [ ] 5.8 **（narrafork）人工验收 & 包级文档回写**

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
  > 分工口径：延续 Package 4 —— **Cascade 负责构建 / 持久化 / 协议 / 测试**；**薛小川负责交互落地、文案、手动验收**；两侧以 `windowRuntimeStore` / Admin 面板 / Toast API 为契约。

  - [x] 7.1 **（Cascade）客户端 bundle 路由级拆分**（🔴 必须，风险最低）
    - 已落地：`App.tsx` 用 `React.lazy + Suspense` 拆了 21 个 pages/Admin；`vite.config.ts` 补 `manualChunks` 把 tiptap/novel/grid/markdown/dnd/icons/mcp 拆成独立 vendor chunk
    - 实测：entry chunk **2085 KB → 267 KB**（-87%），rollup 大包警告消失，build 9 s
    - 顺手修复 `AppInner` 里 `React.useRef(nav)` 的 hooks-order 违规（被 Suspense 暴露）

  - [ ] 7.2 **（Cascade）TipTap 版本收敛**（🔴 必须，隐性风险）
    - 现状：根 `pnpm-lock.yaml` 同时存在 `@tiptap/core@2.27.2` 与 `@tiptap/react@3.22.3`，pnpm 能解析但跨版本行为不一致；`novel` 依赖也要一起看
    - 做法：统一升到 `@tiptap/* ^3`（含 `@tiptap/core / @tiptap/react / @tiptap/pm / starter-kit / extension-*`），或统一降到 `^2`（**优先升 3**，因为 novel 已走 3）
    - 验收：`pnpm why @tiptap/core` 只有一个主版本；所有编辑器相关场景（剧情卡片、大纲、标题、章节正文）手动冒烟一次
    - 回归：`pnpm --filter @vivy1024/novelfork-studio test` 中编辑器相关用例全绿

  - [ ] 7.3 **（Cascade + narrafork）统一 Toast / 通知中心**（🟡 UX 欠账）

    - [x] 7.3.1 **（Cascade 已完成）基建**：`sonner` 已装；`@d:\DESKTOP\novelfork\packages\studio\src\lib\notify.ts` 提供 `success / error / warning / info / message / dismiss` 六通道；`App.tsx` 挂 `<Toaster position="bottom-right" richColors closeButton />`；5 个单测覆盖载荷构造与类型路由

    - [ ] 7.3.2 **（narrafork）把散落的 console.warn / alert 替换到 notify**

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

    - [ ] 7.3.3 **（narrafork）recovery 五态强制 toast 打点**

      在 `@d:\DESKTOP\novelfork\packages\studio\src\stores\windowRuntimeStore.ts` 的 `setRecoveryState` 调用处或上层消费处，做以下打点：

      | 状态跳变 | toast |
      |---|---|
      | `idle → reconnecting` | `notify.warning("连接中断，正在重连…", { id: "recovery-" + windowId })` |
      | `reconnecting → replaying` | `notify.info("正在回放历史…", { id: "recovery-" + windowId })` |
      | `replaying → idle` | `notify.success("会话已恢复", { id: "recovery-" + windowId })` |
      | `* → resetting` | `notify.error("会话已重置", { description: "历史记录可能已丢失", id: "recovery-" + windowId })` |

      用**相同 id** 保证同一 window 的 recovery 生命周期始终只有一条 toast，后续状态覆盖前一条。

    - [ ] 7.3.4 **（narrafork）三处最小打点验收**
      - `@d:\DESKTOP\novelfork\packages\studio\src\pages\SessionCenter.tsx`：新建/删除 session 成功失败
      - `@d:\DESKTOP\novelfork\packages\studio\src\components\ChatWindow.tsx`：保存失败、发送失败、复制 sessionId 成功（5.7.1）
      - `@d:\DESKTOP\novelfork\packages\studio\src\components\Admin\SessionsTab.tsx`：操作类按钮（若存在）的成功失败

  - [x] 7.4 **（Cascade）Markdown 能力扩展（GFM + 数学）**（🟡 低成本高感知）
    - 已落地：安装 `remark-gfm`/`remark-math`/`rehype-katex`/`katex`；升级 `MarkdownRenderer.tsx` 加 remarkPlugins/rehypePlugins；GFM 表格/任务列表/删除线 + 行内/块级数学全部支持；KaTeX CSS 走 lazy import
    - 已新增：`MarkdownRenderer.test.tsx` 6 个用例（表格 / 任务列表 / 删除线 / 代码块 / 行内数学 / 块数学）

  - [x] 7.5 **（Cascade）本地持久化升级评估 —— better-sqlite3 + drizzle**（⚪ 长期方向，仅 spike）
    - 产出：`@d:\DESKTOP\novelfork\docs\04-开发指南\05-调研规划\10-持久化迁移spike.md`
    - 结论：**暂不迁**；若将来迁，首选方案 C（Node 侧 `better-sqlite3 + drizzle-orm`，Tauri 侧 `@tauri-apps/plugin-sql`，通过 `storage/adapter.ts` 接口隔离）；首个迁移对象是 `sessions.json` + `session-history/`，**不**迁章节正文（破坏"可手动 git 管"的心智）

  - [x] 7.6 **（Cascade）Bash 工具安全审查 —— tree-sitter 引入评估**（⚪ 可选）
    - 产出：`@d:\DESKTOP\novelfork\docs\04-开发指南\05-调研规划\11-Bash-AST审查spike.md`
    - 结论：**暂不引入**；推荐先做 3 件 ROI 更高的小事（补 4 条正则 / 黑名单移到 JSON 清单 / BashTool 加 dry-run 模式）

  - [ ] 7.7 **（narrafork）TerminalTab / RadarView 空壳落地决策**（⚪ 非阻塞）

    **目标**：对两个长期处于"有壳无后端"状态的入口做一次性产品决策，避免后续继续悬而未决。

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
