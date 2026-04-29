# 真实运行时与Mock清理验收报告

**版本**: v1.0.1
**创建日期**: 2026-04-28
**更新日期**: 2026-04-28
**状态**: ✅ 当前有效
**文档类型**: current

---

## 本文定位

本文记录 `project-wide-real-runtime-cleanup` 相关验收事实，并给出当前 NovelFork 在 mock、transparent placeholder、typecheck 和浏览器 UI 审计上的已知结果。

它是**验收事实文档**，不是未来承诺文档。凡是没有 fresh evidence 的内容，必须明确写成“当前已知”“浏览器审计结论”或“仍待后续处理”，不能包装成已完成。

## 验收范围

本报告聚焦四件事：

1. `project-wide-real-runtime-cleanup` 的任务完成口径。
2. `mock-debt-ledger` 与 `mock-debt-scan` 的当前结果。
3. 浏览器 UI 审计已经发现、但尚未在本 spec 后续阶段修复的主题 token 问题。
4. `pnpm --dir packages/studio run typecheck` 的当前阻塞项。

## 1. 上游清理 spec 完成口径

已核对：`.kiro/specs/project-wide-real-runtime-cleanup/tasks.md` 当前共有 **30 个任务**，并且没有未勾选项。

执行口径：

- 高风险 mock/fake/noop 命中不要求归零，但必须登记到 ledger 或明确 allowlist。
- 未接入能力必须降级为 `unsupported` 或透明占位，不得 200 success。
- 只有持久化或真实调用层级可以写成“真实可用”。
- 旧双轨 provider / model 配置必须退出生产事实源地位。

## 2. Mock debt ledger 当前统计

已通过脚本读取 `packages/studio/src/api/lib/mock-debt-ledger.ts`，当前统计如下：

| 项 | 数量 |
|---|---:|
| ledger 总条目 | 17 |
| `confirmed-real` | 9 |
| `transparent-placeholder` | 7 |
| `internal-demo` | 1 |
| `must-replace` | 0 |
| `test-only` | 0 |

按风险分级：

| 风险 | 数量 |
|---|---:|
| `critical` | 14 |
| `medium` | 1 |
| `low` | 2 |

### 当前 ledger 中最关键的确认项

#### 已确认真实可用

- Provider runtime store
- Platform integrations（Codex/Kiro JSON 导入）
- Runtime model pool
- Session chat runtime
- Legacy model UI 已退出生产事实源
- Agent config service
- Writing tools health 的真实字段
- CLI / Core 生产源码低风险边界确认

#### 当前保留透明过渡

- 轻量 Book Chat 历史：`process-memory`
- Pipeline runs：`process-memory`
- Monitor status：无事实源时 `unsupported`
- Admin users：本地单用户透明占位
- Writing modes apply：`prompt-preview` / disabled
- 透明 Admin placeholders
- AI complete streaming：`chunked-buffer`

#### 内部示例

- `ToolUsageExample`：仅允许保留为 internal demo，不得重新进入生产主入口

## 3. Mock debt scan 当前结果

已运行：

```bash
pnpm --dir packages/studio exec vitest run src/api/lib/mock-debt-ledger.test.ts src/api/lib/mock-debt-scan.test.ts
```

结果：

- **2 个测试文件通过**
- **8 个测试通过**
- 当前 repo 扫描断言通过：**高风险生产命中均已登记或显式 allowlist**

另外通过脚本统计当前扫描报告：

| 项 | 数量 |
|---|---:|
| 总命中 `hits` | 29 |
| 已登记 `registered` | 21 |
| 允许命中 `allowed` | 8 |
| 未登记 `unregistered` | 0 |

### 当前 scan 验收结论

1. 当前生产源码仍然存在 mock debt 相关命中，但**没有未登记高风险命中**。
2. 扫描门禁是有效的：如果出现未登记命中，测试会失败。
3. 当前状态符合“透明治理”目标，不符合“全部清零”叙事；因此文档必须继续保留 transparent placeholder 说明。

## 4. 浏览器 UI 审计当前结论

本报告记录的是**当前已知浏览器审计结论**，不是本轮 fresh browser run 结果。

已知结论：

- `bg-primary`、`text-primary`、`border-border` 等 Tailwind theme token 未正确生成。
- `/app-next` 中大量按钮在浏览器 computed style 上表现为同一类透明背景、黑字、灰边。
- 这会导致主操作、次操作、危险操作、disabled、active route/resource node 缺乏足够视觉分层。

当前代码证据：

- `packages/studio/tailwind.config.js` 仍然是：
  - `theme.extend = {}`
  - 没有把 `index.css` 中的 CSS variables 映射到 Tailwind colors

因此本报告保留结论：

> **UI 主题 token 问题仍是 `novel-creation-workbench-complete-flow` Phase 1 的明确阻塞项。**

### 当前不能写成已完成的内容

- 不能写“Tailwind 主题修复已完成”。
- 不能写“按钮状态已经明显分层”。
- 不能把设计稿或 className 设想写成浏览器已验收事实。

## 5. 当前 typecheck 阻塞

已运行：

```bash
pnpm --dir packages/studio run typecheck
```

结果：**失败，退出码 2**。

当前错误集中在三类：

### 5.1 `routes` 模块缺失

涉及文件包括：

- `src/components/Admin/Admin.tsx`
- `src/components/CommandPalette.tsx`
- `src/hooks/use-tabs.test.ts`
- `src/hooks/use-tabs.ts`
- `src/route-utils.ts`
- `src/routes.test.ts`

典型错误：

```text
Cannot find module '../routes' or its corresponding type declarations.
```

### 5.2 `novelfork-context` 模块缺失

涉及文件包括：

- `src/components/Routines/Routines.tsx`
- `src/components/Sidebar.tsx`
- `src/components/UpdateChecker.tsx`
- `src/hooks/use-backup.ts`
- `src/hooks/use-crash-recovery.ts`
- `src/hooks/use-llm-config.ts`

典型错误：

```text
Cannot find module '../providers/novelfork-context' or its corresponding type declarations.
```

### 5.3 `use-tabs.ts` 类型错误

典型错误：

```text
Type 'Route' is not assignable to type 'never'.
```

### 当前结论

- `pnpm --dir packages/studio run typecheck` **还没有通过**。
- Requirement 11 / Task 41 仍然是当前 spec 的明确后续任务。
- 在 typecheck 修复前，不能把本 spec 写成“已完成验收”。

## 6. 与当前文档体系的关系

本报告与以下 current 文档协同使用：

- [01-当前状态/02-Studio能力矩阵.md](../01-当前状态/02-Studio能力矩阵.md)
- [06-API与数据契约/01-Studio API总览.md](../06-API与数据契约/01-Studio%20API总览.md)
- [06-API与数据契约/02-创作工作台接口.md](../06-API与数据契约/02-创作工作台接口.md)
- [07-运行运维/03-排障手册.md](../07-运行运维/03-排障手册.md)

这几份文档共同约束：

- `process-memory` 只能表述为当前进程临时状态。
- `prompt-preview` 只能表述为提示词预览，不代表正文已经改动。
- `unsupported` 不能写成已完成。
- `chunked-buffer` 不能写成原生流式。

## 7. 当前仍保留的透明过渡项

以下能力仍然必须按透明过渡理解：

| 能力 | 当前口径 |
|---|---|
| 轻量 Book Chat 历史 | `process-memory`，仅当前进程临时状态 |
| Pipeline runs | `process-memory` |
| Monitor status | 无事实源时 `unsupported` |
| Writing modes apply | `prompt-preview` + disabled/原因文案 |
| Admin users | 本地单用户透明占位 |
| AI complete streaming | `chunked-buffer` |

## 8. 本报告的验收结论

基于当前已运行的测试和读取到的代码事实，可以确认：

1. `archive/project-wide-real-runtime-cleanup` 的 30 个任务当前已全部勾选完成。
2. `mock-debt-ledger` 与 `mock-debt-scan` 的门禁当前有效。
3. 当前没有未登记的高风险 mock debt 命中。
4. Tailwind 主题 token 问题仍是后续 spec 的实际阻塞项。
5. Studio `typecheck` 当前仍失败，不能写成通过。
6. 透明过渡项仍然存在，且必须继续透明表达。

## 9. 相关验证命令

```bash
pnpm --dir packages/studio exec vitest run src/api/lib/mock-debt-ledger.test.ts src/api/lib/mock-debt-scan.test.ts
pnpm --dir packages/studio test src/app-next/visual-audit.test.ts
pnpm --dir packages/studio dev
pnpm --dir packages/studio run typecheck
bun run docs:verify
```
