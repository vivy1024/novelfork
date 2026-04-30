# 真实运行时与Mock清理验收报告

**版本**: v1.0.3
**创建日期**: 2026-04-28
**更新日期**: 2026-04-30
**状态**: ✅ 当前有效
**文档类型**: current

---

## 本文定位

本文记录 `project-wide-real-runtime-cleanup` 与当前主线 `novel-creation-workbench-complete-flow` Phase 6 的验收事实，并给出当前 NovelFork 在 mock、transparent placeholder、typecheck、浏览器 UI 审计、最小创作闭环和最终验证集合上的已知结果。

它是**验收事实文档**，不是未来承诺文档。凡是没有 fresh evidence 的内容，必须明确写成“当前已知”“浏览器审计结论”或“仍待后续处理”，不能包装成已完成。

## 验收范围

本报告聚焦六件事：

1. `project-wide-real-runtime-cleanup` 的任务完成口径。
2. `mock-debt-ledger` 与 `mock-debt-scan` 的当前结果。
3. 浏览器 UI 审计和最小创作闭环的当前结果。
4. `pnpm --dir packages/studio run typecheck` 的当前结果。
5. Phase 6 最终验证集合的当前结果。
6. 仍保留的透明过渡项。

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
| ledger 总条目 | 19 |
| `confirmed-real` | 9 |
| `transparent-placeholder` | 9 |
| `internal-demo` | 1 |
| `must-replace` | 0 |
| `test-only` | 0 |

按风险分级：

| 风险 | 数量 |
|---|---:|
| `critical` | 14 |
| `medium` | 3 |
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
- Writing modes：生成端点可返回 `prompt-preview`；apply route 真实落库 candidate/draft
- 透明 Admin placeholders
- AI complete streaming：`chunked-buffer`
- 发布检查连续性：有审计事实源时返回真实指标；缺事实源时 `unknown`
- Workspace 大纲/经纬缺少上下文时：`UnsupportedCapability`

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
| 总命中 `hits` | 35 |
| 已登记 `registered` | 27 |
| 允许命中 `allowed` | 8 |
| 未登记 `unregistered` | 0 |

### 当前 scan 验收结论

1. 当前生产源码仍然存在 mock debt 相关命中，但**没有未登记高风险命中**。
2. 扫描门禁是有效的：如果出现未登记命中，测试会失败。
3. 当前状态符合“透明治理”目标，不符合“全部清零”叙事；因此文档必须继续保留 transparent placeholder 说明。

## 4. 浏览器 UI 与最小创作闭环当前结论

已运行：

```bash
pnpm exec playwright test e2e/workspace-creation-flow.spec.ts
```

结果：

- **1 个 Playwright 测试通过**
- 浏览器路由：`/next/dashboard` 和 `/next`
- 前端：Vite `127.0.0.1:4587`
- API：`bun run main.ts` 单进程 API，测试端口 `4589`
- 临时项目根：`.novelfork/e2e-workspace-flow-*`

覆盖的关键事实：

- 创建作品。
- 新建章节。
- 写入并保存正文。
- 刷新后重新打开章节并读取已保存内容。
- 通过浏览器上下文调用真实 `writing-modes/apply` route 生成候选稿；该步骤不依赖外部 LLM，也不是前端假节点。
- 候选稿另存草稿。
- 候选稿替换正式章节。
- 全书健康仪表盘展示真实可计算指标，并把质量评分显示为未接入。
- 导出 Markdown 并显示 `fileName` 与章节数。
- 运行 CSSOM 与 `getComputedStyle` 审计，确认主题 utilities 存在且关键按钮状态可区分。

当前代码证据：

- `packages/studio/tailwind.config.js` 已将 `index.css` 中的 CSS variables 映射到 Tailwind colors。
- `packages/studio/src/tailwind-theme.test.ts` 会生成 Tailwind utilities，并断言 `.bg-primary`、`.text-primary`、`.text-primary-foreground`、`.bg-muted`、`.text-muted-foreground`、`.border-border`、`.bg-card`、`.bg-destructive` 存在。
- `packages/studio/src/app-next/visual-audit.test.ts` 覆盖两类状态：同色样式组会失败，主操作/次操作/active/disabled 分层会通过。
- 浏览器脚本位于 `packages/studio/public/audits/app-next-visual-audit.js`，会读取 CSSOM 与 `getComputedStyle(button)`，并输出主题类缺失、样式组和关键按钮对比结果。
- 浏览器闭环测试位于 `e2e/workspace-creation-flow.spec.ts`。
- Playwright 启动配置位于 `playwright.config.ts`。

浏览器手动执行方式：

```js
const audit = await import("/audits/app-next-visual-audit.js");
await audit.runNovelForkAppNextVisualAudit();
```

### 当前不能写成已完成的内容

- 不能把外部 LLM 生成写成已验收；当前候选稿验收使用真实 `writing-modes/apply` 写入路径，不要求外部模型可用。
- 不能把 `/next` 页面上所有按钮都写成已经完成浏览器验收；当前只覆盖最小创作闭环和视觉审计目标。
- 不能把 `unknown`、`prompt-preview`、`UnsupportedCapability` 写成真实完成。

## 5. 当前 typecheck 结果

已运行：

```bash
pnpm --dir packages/studio run typecheck
```

结果：**通过**。

当前结论：

- Requirement 11 / Task 41 的 typecheck 阻塞已修复。
- 状态类型收敛后，Workspace/API/resource adapter 边界已显式归一旧状态。
- 最终完成声明前仍需在 Task 45 中重新运行一次完整验证集合。

## 6. 当前文档与 diff 检查结果

已运行：

```bash
bun run docs:verify
git diff --check
```

结果：

- `docs:verify` 通过：83 个 Markdown 文件、22 个目录。
- `git diff --check` 退出码为 0；当前输出仅包含 Windows 工作区换行提示，未发现 whitespace error。

## 7. Phase 6 最终验证集合

已运行：

```bash
pnpm --filter @vivy1024/novelfork-core test -- src/__tests__/status-models.test.ts src/__tests__/compliance-publish-readiness.test.ts
pnpm --filter @vivy1024/novelfork-studio test -- src/api/lib/mock-debt-ledger.test.ts src/api/lib/mock-debt-scan.test.ts src/api/routes/compliance.test.ts src/api/__tests__/server-integration.test.ts src/app-next/workspace/resource-adapter.test.ts src/app-next/workspace/resource-view-registry.test.ts src/app-next/workspace/WorkspacePage.test.tsx src/app-next/visual-audit.test.ts src/tailwind-theme.test.ts
pnpm --dir packages/studio run typecheck
bun run docs:verify
git diff --check
pnpm exec playwright test e2e/workspace-creation-flow.spec.ts
```

结果：

| 验证项 | 结果 |
|---|---|
| Core 状态/发布检查测试 | 2 个测试文件通过，5 个测试通过 |
| Studio mock/route/UI/visual/Tailwind 测试 | 9 个测试文件通过，114 个测试通过 |
| Studio typecheck | 通过 |
| docs verify | 通过，83 个 Markdown 文件、22 个目录 |
| git diff check | 退出码 0，仅有 Windows 换行提示，无 whitespace error |
| Playwright 最小创作闭环 | 1 个浏览器测试通过 |

浏览器启动期间仍会输出非阻塞运行诊断，包括临时 E2E 项目根缺少单文件产物、未配置 OpenAI API Key、检测到外部 worktree 和孤儿会话文件。这些诊断没有阻断本次浏览器验收，但不应被写成已解决。

## 8. 与当前文档体系的关系

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

## 9. 当前仍保留的透明过渡项

以下能力仍然必须按透明过渡理解：

| 能力 | 当前口径 |
|---|---|
| 轻量 Book Chat 历史 | `process-memory`，仅当前进程临时状态 |
| Pipeline runs | `process-memory` |
| Monitor status | 无事实源时 `unsupported` |
| Writing modes apply | 生成端点可返回 `prompt-preview`；apply route 另行持久化 candidate/draft，章节 insert/replace 转候选稿 |
| Admin users | 本地单用户透明占位，CRUD 返回 `unsupported` |
| AI complete streaming | `chunked-buffer` |
| 发布检查连续性 | 有章节审计事实源时返回 `passed` / `has-issues` 指标；缺事实源或格式异常时返回 `unknown` |
| Workspace 大纲/经纬缺上下文 | `UnsupportedCapability`，缺少 `bookId` 或分类映射时不伪造成功 |

## 10. 本报告的验收结论

基于当前已运行的测试和读取到的代码事实，可以确认：

1. `archive/project-wide-real-runtime-cleanup` 的 30 个任务当前已全部勾选完成。
2. `mock-debt-ledger` 与 `mock-debt-scan` 的门禁当前有效。
3. 当前没有未登记的高风险 mock debt 命中。
4. Tailwind 主题 token 与关键按钮状态已有单元测试和浏览器 CSSOM 证据。
5. Studio `typecheck` 当前已通过。
6. 最小创作闭环浏览器验收已通过。
7. Phase 6 最终验证集合已完成。
8. Phase 7 透明过渡项已收敛：provider key 提示、发布检查连续性、process-memory 边界、prompt-preview apply 闭环、unsupported 占位上下文均有明确事实源或透明边界。
9. 透明过渡项和非阻塞运行诊断仍然存在，但必须按本报告口径继续透明表达。

## 11. 相关验证命令

```bash
pnpm --dir packages/studio exec vitest run src/api/lib/mock-debt-ledger.test.ts src/api/lib/mock-debt-scan.test.ts
pnpm --dir packages/studio test src/app-next/visual-audit.test.ts
pnpm exec playwright test e2e/workspace-creation-flow.spec.ts
pnpm --dir packages/studio run typecheck
bun run docs:verify
git diff --check
```
