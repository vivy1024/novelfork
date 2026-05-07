# v0.1.0 Release Readiness Baseline

**日期**: 2026-05-07
**状态**: Task 1 evidence
**范围**: v0.1.0 全量发布准备基线与可追溯清单

---

## 1. 事实来源

本基线读取并确认以下文件后建立：

| 来源 | 当前事实 |
|---|---|
| `.kiro/specs/v0-1-0-release-readiness/requirements.md` | approved；11 个 requirements；v0.1.0 完整功能、真实 UI 体验、干净 root、Release 产物均为发布阻塞门槛。 |
| `.kiro/specs/v0-1-0-release-readiness/design.md` | approved；要求不照抄 NarraFork，不恢复旧三栏/旧 ChatWindow，复用现有 session runtime、Backend Contract、SettingsTruthModel。 |
| `.kiro/specs/v0-1-0-release-readiness/tasks.md` | 20 项；当前 0/20，Task 1 正在执行。 |
| `.kiro/specs/ui-live-parity-hardening-v1/tasks.md` | 13/14 已完成；Task 14 仍待文档、能力矩阵、CHANGELOG 与最终验收收口。 |
| `docs/90-参考资料/NarraFork参考/03-NarraFork-UIUX与交互功能调研.md` | 第十五节记录 2026-05-07 4567 NovelFork 与 7778 NarraFork 手工 UI 对比。 |
| `docs/01-当前状态/02-Studio能力矩阵.md` | 已引入“体验未达标”状态，明确合同/API/E2E 可用不等于 UI 成熟。 |
| `docs/08-测试与质量/01-当前测试状态.md` | 记录 UI Live Hardening Task 1-13 自动化与 2026-05-07 手工 UI 对比验活；手工对比发现体验风险。 |

---

## 2. 当前 Git / 版本 / 产物基线

### 2.1 Git

| 检查项 | 结果 |
|---|---|
| `git status --short` | 执行 Task 1 写入本文件前无输出，工作树干净。 |
| 最新提交 | `cb269472 docs(release): add v0.1.0 readiness tasks` |
| 近 8 个提交 | `cb269472` readiness tasks；`4bb1fcf0` readiness spec；`1d294ac9` live UI comparison；`958e98be` settings/session E2E；`bb082e97` Codex parity guard；`e006e346` Claude parity guard；`412d7aca` conversation runtime controls；`cc6429c1` conversation runtime facts。 |

### 2.2 版本号

| 文件 | 当前版本 |
|---|---:|
| 根 `package.json` | `0.0.6` |
| `packages/studio/package.json` | `0.0.6` |
| `packages/cli/package.json` | `0.0.6` |
| `packages/core/package.json` | `0.0.6` |
| `CLAUDE.md` | `v0.0.6` |
| `AGENTS.md` | `v0.0.6` |

结论：v0.1.0 版本号尚未开始变更；必须等 release-readiness 体验、验证和 clean root smoke 完成后再进入版本资料任务。

### 2.3 本地 dist 产物

当前 `dist/` 可见：

- `novelfork-v0.0.2-windows-x64.exe`
- `novelfork-v0.0.3-windows-x64.exe`
- `novelfork-v0.0.4-windows-x64.exe`
- `novelfork-v0.0.4-windows-x64.exe.sha256`
- `novelfork-v0.0.5-windows-x64.exe`
- `novelfork-v0.0.5-windows-x64.exe.sha256`
- `novelfork-v0.0.6-windows-x64.exe`
- `novelfork.exe`
- `novelfork.json`

结论：尚无 `dist/novelfork-v0.1.0-windows-x64.exe` 与 SHA256；不得宣称 v0.1.0 release 已构建或已发布。

---

## 3. Requirement → Task → 验证映射

| Requirement | 对应任务 | 主要子系统 | 核心验证 |
|---|---|---|---|
| R1 产品入口必须像软件 | Task 7-8、13-14、20 | `/next`、Agent Shell 首页、Shell 数据 | RED 组件测试、Playwright 主路径、clean root 手工验活。 |
| R2 作品工作台发布级体验 | Task 9-10、13-14、20 | Writing Workbench、资源树、WorkbenchCanvas、写作动作 | 聚焦组件测试、`e2e/workbench-resource-edit.spec.ts`、release-readiness E2E、手工验活。 |
| R3 发布级叙述者中心 | Task 5-6、13-14、20 | SessionCenter、Shell 左栏、session domain client | RED/ GREEN 组件测试、会话中心 E2E、手工验活。 |
| R4 发布级会话页 | Task 2-4、13-14、20 | ConversationSurface、StatusBar、Composer、RuntimeControls | RED/GREEN 组件测试、settings-session E2E 扩展、会话页手工检查点。 |
| R5 设置 / Provider / Runtime 可读可信 | Task 11、13-14、20 | SettingsTruthModel、ProviderSettingsPage、E2E fixtures | Provider/Settings 回归、clean root 无测试 provider、手工检查。 |
| R6 Routines / 工作流配置台验活 | Task 12-14、20 | `/next/routines`、MCP/skills/tools/commands 管理页 | Browser/Playwright 验活、planned/unsupported 口径审计。 |
| R7 干净 root 实际软件验活 | Task 13-14、18、20 | dev server 或编译产物、clean root | release-readiness E2E、compiled smoke、真实浏览器记录。 |
| R8 E2E 与夹具不污染发布验收 | Task 11、13-14、20 | Playwright fixtures、provider/settings/book/session 数据 | clean root 断言、fixture 隔离或清理、手工 provider 列表检查。 |
| R9 旧 spec 收口或归档 | Task 15、20 | `ui-live-parity-hardening-v1`、spec 索引、能力矩阵 | docs verify、spec 任务状态一致、known gaps 归类。 |
| R10 v0.1.0 版本资料和发布产物 | Task 17-19、20 | package versions、CHANGELOG、compile、Git tag、GitHub Release | 全仓版本搜索、compile、SHA256、tag/release/附件验证。 |
| R11 验证命令和手工证据可追溯 | Task 1、4、12-20 | 测试状态、手工记录、release 报告 | 命令输出、路径、root、端口、截图/文字证据、未运行项记录。 |

---

## 4. 当前发布阻塞项

| 阻塞项 | 当前证据 | 对应任务 |
|---|---|---|
| 会话页视觉仍像基础 HTML | 2026-05-07 4567/7778 手工 UI 对比记录；NovelFork header/控件拥挤、composer 贴底。 | Task 2-4 |
| 缺正式叙述者中心体验 | 左栏堆叠 Planner/写作会话，缺搜索/筛选/排序/归档。 | Task 5-6 |
| `/next` 仍偏开发态工作台入口 | 手工记录指出缺书籍/项目总览与作者向首页。 | Task 7-8 |
| 工作台信息层级仍需成品化 | 能打开 Story/Truth/章节，但按钮/徽标密集，当前资源说明不足。 | Task 9-10 |
| E2E provider 污染开发样本 | 手工记录显示模型下拉存在多批 `E2E Provider ...`。 | Task 11、13-14 |
| Routines 发布前未完成正式验活记录 | 当前已有 route 挂载，但 release readiness 尚未记录 current/planned/unsupported 项。 | Task 12 |
| clean root 软件验活未执行 | 当前证据来自开发 root 与 E2E isolated root，尚无 v0.1.0 clean root smoke。 | Task 13-14、18 |
| ui-live-parity-hardening-v1 未最终归档 | Task 14 未完成。 | Task 15 |
| 版本号仍为 0.0.6，未构建 v0.1.0 产物 | package/CLAUDE/AGENTS 均为 0.0.6；dist 无 v0.1.0 exe。 | Task 17-19 |

---

## 5. 执行约束确认

- 不恢复旧三栏、旧 ChatWindow、windowStore 会话事实源或 legacy route shim。
- 不新增 mock/fake/noop 假成功层。
- UI 重排必须复用现有 session runtime、Backend Contract client、Writing Workbench 和 SettingsTruthModel。
- 所有 RED 测试必须先失败且失败原因正确，再实现。
- 所有 current 声明必须绑定真实 API、测试或手工浏览器证据。
- v0.1.0 只有在完整功能、真实 UI 体验、clean root 验活和 Release 产物全部达标后才能发布。

---

## 6. Task 1 结论

本轮发布准备基线已固化：当前仓库仍处于 `0.0.6`，无 v0.1.0 产物，`v0-1-0-release-readiness` 共有 20 个任务且当前只完成 Task 1。下一步应进入 Task 2：为会话页 UI 成品化补 RED 组件测试。
