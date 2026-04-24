# TipTap 版本收敛 Spike

> 日期：2026-04-24
> 关联任务：`.kiro/specs/novelfork-narrafork-closure/tasks.md` 7.2
> 状态：**已收敛到 2.27.2**；升 3.x 延后，等上游 `novel` 更新

## 背景

Package 6 的 tasks.md 7.2 记述的假想现状是「根 `pnpm-lock.yaml` 同时存在 `@tiptap/core@2.27.2` 与 `@tiptap/react@3.22.3`，pnpm 能解析但跨版本行为不一致」。

真机核对后发现这一描述**已过时**：

- `@d:\DESKTOP\novelfork\package.json:51-60` 的 `pnpm.overrides` 已把所有关键 `@tiptap/*` 固定到 `2.27.2`
- `pnpm-lock.yaml` 内 **grep `@tiptap/[^']+@3\.` 结果为 0**，完全没有 3.x 条目
- `node_modules/.pnpm/` 下只有一套 `@tiptap+*@2.27.2` 目录

所以 7.2 验收项「`pnpm why @tiptap/core` 只有一个主版本」**实际上已经满足**，只是通过 `pnpm.overrides` 这条明显的强制路径，不是自然解析结果。

## 不升 3.x 的决策理由

### 1. 上游 peer 版本锁

| 间接依赖 | 对 `@tiptap/core` 的 peer 约束 | 升 3 影响 |
|---|---|---|
| `novel@1.0.2` | `^2.11.2`（直接依赖，非 peer，deep） | **阻塞**：升 3 后 novel 内部会重复装 2.x，`useEditor` hook 跨 instance 串了 |
| `tiptap-markdown@0.8.10` | `^2.0.3`（peer） | warning，运行时可能 OK，但协议不保证 |
| `tiptap-extension-global-drag-handle@0.1.18` | `>=2.1.0`（peer） | 3.x 不在上界，warning |

`novel@1.0.2` 是重点：它把 tiptap 当直接依赖装进自己的 `node_modules`，`pnpm.overrides` 能强制它吃 workspace 里的版本，但只有在版本仍满足 `novel` 的内部 peer 约束时才安全。升到 3.x 会跨大版本 API 变更：

- 命令链 API 在 3.x 有 breaking（`editor.chain().focus().toggleBold().run()` 的返回值语义变化）
- `Extension.create` 的 schema 合并规则变化
- ProseMirror 的 plugin view 生命周期对齐 React 19 的 concurrent 渲染

这三条都不是 novel 维护者能自动享受的，得等 novel 主动升。

### 2. 当前阻塞不出现

- 编辑器场景（InkEditor / MessageEditor / IntentEditor / Routines 路由编辑器）在 `pnpm test` 2.27.2 下全绿
- `packages/studio/src/extensions/ghost-text.ts` 只用 `@tiptap/core` 的 `Extension` 和 `@tiptap/pm/state|view`，API 跨 2.x 已稳定
- 打包体积：升 3 不会显著减少 bundle（tiptap 3 做了 tree-shaking 但 novel 仍拖旧代码），ROI 低

### 3. 未来触发升级的信号

满足**任一**时再开 TipTap 3 spike：

- `novel` 发新版明确支持 `@tiptap/*@^3`
- 换掉 `novel`（自研 bubble menu / suggestion 层）
- `tiptap-markdown` 或 `global-drag-handle` 发 3 兼容版
- Tauri 端的 React 19 concurrent rendering 与 tiptap 2.x 的 ProseMirror plugin view 产生实际冲突

## 本次动作

- **不做**：不升 3.x，不动 `pnpm.overrides`
- **做**：用这篇 spike 关 7.2；把 tasks.md 描述订正为「overrides 强制 2.27.2，升 3 延后」
- **做**：7.2 的验收项改为：
  1. `Select-String pnpm-lock.yaml "@tiptap/[^']+@3\."` → 0 条
  2. `pnpm test` 全绿（537/537，排除预先存在的 Windows `sleep` 平台问题）
  3. `pnpm --filter @vivy1024/novelfork-studio build:client` 通过（主 chunk 预算在 7.8 验收）
  4. 编辑器场景手动冒烟：InkEditor / MessageEditor / IntentEditor / Routines — 由 7.8 阶段的真机回归负责

## 已知风险与对冲

- `pnpm.overrides` 是全局强制，任何新引入的依赖若以 `^3` 声明 tiptap peer，会被默默降到 2.27.2。引入新依赖时需 code review 检查 peer 冲突。
- 如果某天 novel 修了 bug 但版本号没升，我们吃不到。对冲：`package.json` 里给 `novel` 也做一次 overrides 钉版，避免意外 minor 升级。
