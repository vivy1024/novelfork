# 代码参考

**版本**: v1.0.0  
**创建日期**: 2026-04-20  
**更新日期**: 2026-04-20  
**状态**: 🔄 持续更新

---

本目录存放实现参考与外部项目参考，回答“怎么实现”以及“可以参考谁”。

## 文件列表

- [01-Claude Code实现经验.md](./01-Claude Code实现经验.md)
- [02-Claude Code配置系统参考.md](./02-Claude Code配置系统参考.md)
- [03-Claude Code体验优化参考.md](./03-Claude Code体验优化参考.md)
- [04-NarraFork依赖参考.md](./04-NarraFork依赖参考.md)
- [05-NarraFork更新日志参考.md](./05-NarraFork更新日志参考.md)
- [06-NarraFork-UIUX与交互功能调研.md](./06-NarraFork-UIUX与交互功能调研.md)

## Studio 公共组件 / 工具索引（Package 4-6 收口）

以下是 `packages/studio/src/` 下应优先复用、禁止重复实现的公共 API：

- **`components/RecoveryBadge.tsx`** —— recovery 五态统一展示组件（`variant: "chip" | "inline" | "banner"`，banner 支持 `action` slot）。`SessionCenter` / `ChatWindow` / `Admin/SessionsTab` 必须通过它渲染状态，不得再自己写 `formatRecoveryStateBadge` 之类散落函数。
- **`lib/windowRecoveryPresentation.ts`** —— `getRecoveryPresentation({recoveryState, wsConnected})` 是五态文案/色系的唯一真源，`RecoveryBadge` 与任何跨页面展示都依赖它。
- **`lib/notify.ts`** —— 统一 toast API（`success / error / warning / info / message / dismiss`）。禁止直接引 `sonner`。详见 `../04-开发指南/README.md#notify-使用规范`。
- **`lib/closed-window-hint.ts`** —— `maybeShowClosedWindowHint({hasContent})`：关闭有内容窗口时的首次提示。`ChatWindow.handleClose` 与 `SessionCenter` 卡片「关闭窗口」按钮共用，不要再手写 localStorage 门控。
- **`hooks/use-recovery-toasts.ts`** —— 顶层挂一次即可；订阅 `windowRuntimeStore` 的 `recoveryStates + wsConnections` 生成统一 toast。App 入口已挂，业务代码不要重挂。
- **`api/lib/runtime-mode.ts`** —— `detectRuntimeMode()` 返回 `{ isProd, isCompiledBinary, runtime, metaUrl, exePath }`，启动日志与产品行为判定统一走它。
- **`api/lib/startup-logger.ts`** —— `logStartupEvent({ level, component, msg, ok, reason?, extra? })` 输出单行 JSON。新增启动阶段必须发一条 `startup` 事件。
- **`hooks/use-worktree.ts`** —— `classifyWorktrees()` + `getVisibleWorktrees()`：Admin 与 WorktreeManager 共用的"是否属于当前项目"判定，不要自己用正则比路径。
