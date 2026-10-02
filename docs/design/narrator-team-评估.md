**版本**: v0.1.0
**创建日期**: 2026-10-02
**更新日期**: 2026-10-02
**状态**: current
**文档类型**: reference

# narrator-team 官方插件评估（T5.1）

对应 [路线与任务](../路线与任务.md) 的 T5.1「隔离实例安装，确认派发、状态、上下文交接、计划审查与权限模型」。

**评估结论先行**：narrator-team v0.1.49 真实安装、启用、激活全部走通（隔离实例、Runtime 0.7.10 物化树、插件管理器启用）；9 个 `team.*` 工具 + 1 命令 + 1 面板视图全部被宿主解析注册；授权自动表现在「首装即信任决策」（manifest 声明的全部 host 能力被授予 global scope，不再弹窗）。插件 UI 面板的后端资源链路（session / shell / asset / bootstrap）验证完整。缺少的是入口兜底的「全局权限弹窗宿主组件」与「PluginUiRuntimeProvider 包装」只在 Runtime App 外壳而不是嵌入 DorkHost，接入需两项很小的 fork 层补件。真实对话验证因隔离实例无模型提供商凭据未做，对话链路相关结论按源码与宿主级行为给出，明确标注证据等级。

## 一、评估方法与证据等级

| 证据 | 等级 | 内容 |
|---|---|---|
| 发行物 | 实 | GitHub Release `NarraFork/narrator-team` v0.1.49（2026-09-21，MIT；唯一发行版；无 npm 发布），资产 `narrator-team-0.1.49.zip`（69 374 字节）。本机 GitHub/npm registry 外网可通（仅 127.0.0.1 本地 HTTP 曾被拦，实际 IPv6 localhost 正常）。 |
| 隔离实例真实安装 | 实 | `bun scripts/start-isolated-verify.ts --port=4613`，`bun scripts/start-isolated-verify.ts` 启动日志：`Plugin manager initialized enabled:true`。REST 走通 `install → enable → activate → runtimeState:"active", generation 1, diagnostics:[]`，贡献注册 9 工具 + 1 命令 + 1 视图。 |
| 插件面板后端链路 | 实 | `GET /api/plugins/ui/contributions` 列出 `team-panel`；`POST /api/plugins/ui/sessions` 建 session 返回 shellUrl / entryUrl / styleUrl / bootstrapUrl；shell/asset 全部 200 且 shell 是宿主注入 srcdoc 风格 HTML，直接引用插件自己的 `ui/panel.iife.js` 与 `panel.css`。 |
| 授权模型 | 实 | 安装后 `GET /api/plugins/com.whisent.narrator-team/grants` 显示 17 个能力全部已授予（`grantedBy:"legacy-state"` 是存储层 fallback 语，install 时的 seed 逻辑在 plugin-manager.ts:1764 `seedGrantsFromManifest`）。`grants/pending` 为空。 |
| 工具注入结论 | 源码 | Runtime 的 `plugin-agent-tool-bridge.ts` 把 server 执行插件工具注册进全局 `toolRegistry`；登录态/非产品叙述者 `toolFilter: undefined` 全部可用；产品叙述者的 `toolFilter`（narrator-session.ts:5113）只收口「产品贡献工具」的可见性，不拦插件工具——所以 `team.*` 对产品叙述者与插件自建叙述者默认可用。 |
| 派发/交接/SOP 语义 | 源码 | 插件包内置单元测试 54 条全过（`team-core.test.ts` + e2e 起步处）；dispatch 写 spec 任务 + SOP 篱笆由宿主端专门 seam 支持（narrator-session.ts:3899 的 `TEAM_SOP_MARKER` 与 `setSpecBehaviorFenceForPlugin`）。 |
| 真实对话链路 | 未验 | 隔离实例无模型凭据，无法用真实 LLM 跑一轮 dispatch。按上述源码结论记录，接基线/真书试用阶段再补。 |
| 插件 e2e 测试 | 受限 | 上游 `tests/e2e.test.ts` 以 `../../../narrafork` 相对布局引用宿主源码（上游 CI 布局）。Windows 下 Bun 对 junction 与 `--preserve-symlinks` 均不跟随 symlink resolve，无法在本机重放，记为「受环境限制只跑了单元测试（54/54 通过）」。隔离实例的真实安装即替代性集成验证。 |

## 二、发行现状与基本事实

- 仓库 `NarraFork/narrator-team`（公开，MIT），当前唯一发行 **v0.1.49**（2026-09-21）。README 明示「测试性插件，未来可能并入 NarraFork 本体」。宿主要求 **NarraFork 0.7.7+**（注释：0.7.7 起宿主的 context_delivery API 移除，插件已按新 `send_message` 投递改写）。
- 发行方式只此 Release zip 一种；未发布 npm；GitHub 自动归档 zip 不能用于安装器中（README 明确）。
- `manifest.json` 关键声明：`pluginId="com.whisent.narrator-team"`、`hostApi>=1.0<2`、`runner:"local-process"`（stdio JSON-RPC，另有 15s 启动 / 30s 激活超时）、UI `shell:"host-controlled"` IIFE。引擎特性 `host_api.requests`、`events.poll`。
- 权限声明 17 项 host 能力 + 网络 `mode:"none"` + 文件 `package:readOnly / pluginData:readWrite / workspace:none` + `process.spawn:none`。即插件本身不访问网络、不起子进程、不读写工作区文件。

### 工具与命令清单

| 贡献 | 类型 | 关键语义（来自 manifest 描述与源码） |
|---|---|---|
| `team.dispatch` | 工具 | 向成员派任务并写共享队列。`priority=high` 先中断成员当前工作；`normal` 排队。**FollowUp=true** 追加指令（仅 Leader，不新任务，记入线程）。派发前先 `team.status`。机制：把任务镜像为成员 `spec://tasks.json` 的 protected 任务 + 注入 `[团队任务 task-N（high\|normal）]` 标记 + 把 Leader 指令与成员角色 SOP 合并成一次性投递（经 `command.narrator.send_message` 或子代理 `send_subagent_message`）。自动把成员 `planReflectionAutoApproveOverride` 置 `on`（宿主端“计划反思自动批准”，不绕过安全检查）。 |
| `team.status` | 工具 | 团队配置、成员忙闲、activeTask、队列（保留终态窗口 + 孤儿任务回收）、每成员 `recentReply` 摘要、任务 `followUps` 线程。 |
| `team.report` | 工具 | Worker 只对带 `[团队任务 task-N]` 标记的任务`taskId`汇报闭环；Leader 无任务时用它发团队消息。与上下文广播分工明确，不替代。 |
| `team.context_broadcast` | 工具 | 探索 Agent 把**精炼结构化结论**（kind: fact/result/decision/artifact/instruction/status）写入团队共享日志并投递给 `targetNarratorIds`（幂等、交付回执插件自存）。明确不要发原始 tool 输出/reasoning/secret/大段内容。 |
| `team.context_log` | 工具 | 读取共享上下文日志，按 kind/source/关键词过滤。Worker 动手前应先查。 |
| `team.setup` | 工具 | 设置团队名、`leaderIds`（多 Leader，旧 `leaderId` 兼容）与 `members`（≤50）。Leader 自动并入成员。 |
| `team.recruit` | 工具 | `role=member` 建 primary narrator 成为正式成员（仅 Leader）；`role=temp` 建 subagent 临时工（任意成员，大事拆分用），完成后 `team.fire`。临时工无独立消息通道，任务经宿主 `send_subagent_message` 投递（运行中缓冲/空闲恢复），结果由招募者汇入团队汇报。 |
| `team.fire` | 工具 | 解雇成员（移团队 + 尽力删除 narrator 记录）。普通成员只能解雇自己招的临时工。 |
| `team.update_member` | 工具 | 改成员 title/model（`__default__` 跟随全局）/reasoningEffort（none–max，null 恢复默认）/Dynamic Spec 文件（仅 `tasks.json`、`index.md`）。权限收窄：仅 Leader 改成员，成员仅改自己招的工。底层走宿主 `updateNarratorProfileForPlugin`（在职 narrator 下一次模型请求即生效）与 `specFileWrite`。 |
| `team.configure` | 命令（server handler） | `project.exists` 时可用，字段与 team.setup 对齐；落脚 Runtime 命令注册表（`plugin-command-registry.ts`；此前 manifest 命令未被调度是一个宿主缺口，现已填上）。 |
| `team-panel` | 视图（focus / workspace surfaces，global scope，单例） | 团队切换、Leader ★ 行切换、成员加/移出、资料编辑、队列查看/删除（行内 ✕ 或右键）；数值自动刷新。UI 是 sandbox iframe 无框架 DOM，宿主镜像 `--mantine-*` 令牌，`connect-src 'none'`，只经 `globalThis.narrafork.request` 桥调宿主。 |

### 存储与稳定性

- 多团队存储布局：`team.<teamId>.config`、`tasks.index`/`tasks.<seq>`、`contexts.index`/`contexts.<id>`（URI 编码），终态保留窗口 + 软限裁剪 + 孤儿任务退役；插件是事件式、非驻留（60 分钟进程上限内闲置会被回收；状态全在 `storage` namespace，所以不影响）。
- 并发设计：narrator 存在性快照按最近发起序号单调生效，不存在者单独入 `missingNarratorIds` 集合避免派发期间重复查询。
- SOP 注入到成员 `spec://behavior_fence` 的注释标签段（`team-sop:com.whisent.narrator-team`），upsert/clear 只动插件标记段、保留用户自己的条目；宿主按篱笆节奏持续注入，长对话/压缩后 Worker 仍记得汇报闭环（宿主 seam：narrator-session.ts `setSpecBehaviorFenceForPlugin`、字符串稳定 `TEAM_SOP_MARKER`）。

## 三、真实安装与激活记录（隔离实例）

环境：`scripts/start-isolated-verify.ts --port=4613 --root=tmp/narrator-team-eval/isolated`，Runtime 物化树 0.7.10（fork 合并 `bc6347b9`），`Plugin manager initialized enabled:true`，注册 `team_eval_admin` 管理员账号。

1. `GET /api/plugins/install/sources` → 列出 `narrator-team-0.1.49.zip`（导入目录即 `NARRAFORK_HOME/plugin-imports/`，本次为隔离 runtime dir 下）。
2. `POST /api/plugins/install {"path": ...}` → 201，`compatibility:"compatible"`，9 工具 + 1 命令 + 1 视图全部登记为贡献。注：安装接口 admin-only；JSON path 走导入目录；multipart 走上传字节流，两者都不执行插件代码。
3. `POST .../enable` → `desiredState:"enabled"`。
4. `POST .../activate` → `runtimeState:"active", runtimeGeneration:1, diagnostics:[], crashCount:0`。
5. `GET /api/plugins` → `[('com.whisent.narrator-team','active')]`。
6. `GET .../grants` → 全部 17 能力 global scope 已授予；`grants/pending` 空。
7. `GET /api/plugins/ui/contributions` → `team-panel` focus/workspace 均 `status:"available"`。
8. `POST /api/plugins/ui/sessions` → sessionId + connectNonce + assetToken；shell / entry / style URL 全部 200，shell HTML 是宿主控制的 srcdoc 模板（无 JWT 无 cookie 无 storage，CSP 语义按设计）。

结论：**宿主插件管理器、贡献解析、RPC transport、能力核定、UI 资产链路在产品模式下全通**。产品模式没有破坏宿主插件系统的任一环节。

## 四、能力对照（T5.1 验收四项）

| 要求 | 结论 | 证据 |
|---|---|---|
| 派发（dispatch） | ✅ | 真实激活 + 命令注册 + SOP 注入 + 计划反思自动批准 seam；分发路径分 high（先 interrupt）/ normal（排队）；followUp 线程。源码含队列维护（终态保留窗口、孤儿回收、幂等、`STATUS_QUEUE_WINDOW=20`）。真实对话跑通未验（无模型）。 |
| 状态（status） | ✅ | 成员忙闲 + activeTask + `recentReply` 摘要 + followUps 线程；多团队枚举 + 分页；插件存储驱动、不依赖面板打开。 |
| 上下文交接 | ✅ | `context_broadcast`（幂等、kind 分类、`targetNarratorIds` 定向、交付回执自存）+ `context_log`（过滤读取）；投递经宿主 `send_message`/`send_subagent_message`，下一安全边界可见，不复制完整会话。 |
| 计划审查 | ✅（宿主侧） | 派发/招募前把 worker 的 `planReflectionAutoApproveOverride=on`，走宿主计划反思循环自动批准；宿主危险反思/权限卡照样生效——不绕过宿主安全检查。 |
| 权限模型 | ✅（见第六节） | 首装即信任决策 + 升级新增能力走 pending 审批 + 运行时缺能力弹窗 + 永久拒绝。 |

另补：Worker 隔离调度上，成员是独立 primary/subagent 叙述者（`command.narrator.create`），可被 `interrupt`、`delete`、按模型独立设置（`update_member` 的 model/reasoningEffort/标题/spec）；隔离粒度即叙述者粒度，与 NovelFork 现有叙述者同构。

## 五、UI 面板与配置面在 NovelFork 里的呈现

- **后端配套已通**：上面第三条的全链路 200（session/shell/asset/bootstrap）。
- **面板打开入口**：叙述者顶栏 `plugins`（`PluginContributionPicker`）已内嵌在 `NarratorDock`（panels 注册 `plugin: PluginDockPanel`），嵌入 Dock（`EmbeddedNarratorDockHost`）天然带出来。
- **缺口 1 — PluginUiRuntimeProvider 未随嵌入宿主携带**：它只在 Runtime 自身 `App.tsx` 挂（frontend/App.tsx:272），`RuntimeFrontendHostProviders` 里没有。`PluginDockPanel` 依赖 `PluginPanelSlot`（PluginUiRuntimeProvider.tsx:20 引用）。在 Studio 嵌入 Dock 打开 `team-panel` 时 Provider 缺失会失败 → **需要 fork 层**把 Provider 包进嵌入宿主（改动很小）。
- **缺口 2 — 插件权限全局弹窗宿主未挂到 Studio**：`PluginPermissionRequestHost` 只挂在 Runtime `AppRootLayout`（frontend/components/AppRootLayout.tsx:1106）。运行时 raise 的 pending 授权弹窗在 Studio 外壳里不显示 → 用户看不到审批卡，授权静默 fail-closed。任务书/T1.6 已记录“插件授权弹窗随阶段 5 一起做” → **需要 fork 层 / Bridge 再导出 + Studio 侧挂载**（组件本身 Runtime 前端已有）。
- **缺口 3 — 可选 host-react 插件运行时产物**：仅当插件 view 声明 `runtime:"host-react"` 时才需要 `plugin-runtime/vendor.js`。narrator-team 是 `shell:"host-controlled"` 的纯 IIFE，**不依赖该产物**。当前 0.7.10 行内未见 host-react 插件用例，`vendor.js` 缺失不是 narrator-team 的阻塞项；后续接第三方 host-react 插件时再由产品编译补产物（见 T1.6 记录，插件系统总账）。
- **配置面**：`team.setup` / `team.configure` 与 UI 面板等价（命令路由 + 面板）。NovelFork 的「模型/供应商设置」与叙述者面板配置无关：插件修改经 Runtime 叙述者 REST（`updateNarratorProfile`）生效，Studio 的供应商管理嵌入 Runtime 原页已生效。tldr：Studio 模型面板不用动；叙述者面板要能把插件成员（普通叙述者）展示出来即可（当前产品叙述者列表是独立的；普通叙述者已经在 Runtime 的 narrator API 里可见，`assertRawNarratorAccess` 对无绑定的叙述者放行——见 services/narrator-access.ts:84-89）。

## 六、权限模型与授权弹窗（事实）

1. **首装即信任决策**（plugin-manager.ts:1751-1773 注释直书）：install 时按 manifest 请求的 host 能力 `seedGrantsFromManifest` 全部种为 global grants，不弹窗。故 novel 用户装上 v0.1.49 时不会有任何权限卡。
2. **升级新能力**：升级保留已授能力；新增能力 fail-closed 不授 → 写入 pendingRequests + 发 `plugin:permission_request` 事件（含 requestId），经 `grants/requests/:id/approve` / `:deny` 决定（admin 权限）（plugin-manager.ts:3135-3204）。
3. **运行时缺能力**：broker 拒绝时回调 `handlePermissionRequest` 建 pending + 事件（除已被永久拒绝/插件非 enabled/隔离态/失败态，静默返回）。
4. **永久拒绝**：deny 落 `grants/denials`，同（capability,scope）不再排 pending（plugin-permission-store.ts:977-…）。`grants/denials/remove` 可重置。
5. **呈现**：全局弹窗宿主是 `PluginPermissionRequestHost`（待审批队列排队弹）。**Studio 外壳未挂载**（见缺口 2）。
6. **命令无「插件声明的该团队 effect」扩展**：插件能力就没法按团队/书本 scope 收窄，安装即 global scope。NovelFork 若想把 worker 写成「仅本书可见」需要产品上另行做绑定（当前 worker 只有 Runtime 叙述者身份，与书籍无关联）。

## 七、与 NovelFork 现有工作流（/workflow-runs、候选）的分工建议

并行不冲突，职责正交。

**narrator-team 接（未来）**：
- 每道工序的实际执行：多 worker 叙述者派发、排程、单机中断/续跑、followUp、汇报；
- 跨工序上下文交接（探索结论 → 实施者）、状态总览；
- 成员资料/模型/思考强度的运行时调整。

**NovelFork 继续留**：
- 配方与节点图（起点/工序/汇合/终点、并行分支、打回）、草稿→已发布、版本号（核心 Novel Plugin 资产）；
- 工序闸门：越出当前工序的写工具拦截（Runtime fork 层/产品 policy，与插件无耦合）；
- `/workflow-runs` 执行监视画布（并行时每道待确认/受阻工序一张卡）、状态轮询、画布组态；
- 叙述者可信书籍绑定与产品叙述者创建入口（worker 要想持有 `chapter.write` 等领域工具，必须经 NovelFork 的叙述者创建路径产生产品叙述者，再由 `team.setup` 收编为团队 worker；直接用 `team.recruit` 建出的是**普通 Runtime 叙述者**，无产品 domain 工具与 trusted cwd）；
- 结果卡「在画布打开」/领域工具结果渲染（Runtime 已提供扩展点，与插件面板无关）。

## 八、接入建议（明确「需要 fork 层」「不需要 fork 层」）

### 需要 fork 层（Runtime 本体接缝）

| 项 | 挂哪里 | 内容 |
|---|---|---|
| F1 嵌入宿主带插件 UI Provider | `frontend/components/host/RuntimeFrontendHostProviders.tsx` | 把 `PluginUiRuntimeProvider`（frontend/components/plugins/PluginUiRuntimeProvider.tsx）包进去，或在其外层包。小改动，使 `PluginDockPanel` 在嵌入 Dock 中可初始化。 |
| F2 全局权限弹窗宿主外置 | `frontend/components/plugins-admin/PluginPermissionRequestHost.tsx` 已存在；把挂载点从 `AppRootLayout` 拆出，经 Bridge（`@vivy1024/narrafork-runtime-bridge`）导出，Studio 外壳（产品壳顶层）挂载一次。 | 仅“挂载拆分”，组件不动。 |
| F3 成员叙述者的产品化扩展 | `server/services/plugin-public-api.ts` 的 `narratorCommands.createNarrator` 适配层（或 fork 层 product host SPI 接缝 `server/lib/product-host/` 增加 hook） | 让插件起的叙述者可选走产品叙述者创建路径（绑定书 + traits + trusted cwd），这对阶段 5 的「成员 worker 写章节」是硬需求。给 hook 默认返回 false 保持上游行为。 |
| F4 （可选）host-react 插件运行时产物 | `frontend/build/plugin-ui-runtime.ts` 已有构建脚本；产品编译链（`scripts/compile-product-runtime.ts`）加把 `plugin-runtime/vendor.js/css` 生成并进 `dist/frontend`。 | narrator-team 不阻塞；接入第三方 host-react 插件前完成即可。 |

### 不需要 fork 层（已就位 / 产品侧可独立完成）

| 项 | 说明 |
|---|---|
| 安装/升级/授权 API | `/api/plugins/*` 全部就绪（install/enable/activate/grants/grants requests approve-deny/denials/remove），产品模式无破坏。管理员 life-cycle 走 REST 即可。 |
| Studio 模型/供应商面板 | 已嵌入 Runtime 原页。插件的 “provider.use” 与叙述者模型设置走 Runtime 的叙述者资料接口（`updateNarratorProfile`），不需 Studio 处理。 |
| 叙述者 Dock 插件入口 | `PluginContributionPicker` 已绑在 NarratorDock 顶栏 `plugins` 菜单（NarratorToolbarItem.tsx:93-106），嵌入面板自带。 |
| 面板后端资源（session/shell/asset/bootstrap） | 实测 200，伺服 shell IIFE 与插件 CSS；narrator-team 面板本身是 host-controlled（无 host-react 依赖）。 |
| 结果渲染（team.* 工具行详情） | Studio 侧用现有 `toolResultRenderer` 扩展点（fork 层已提供给 `EmbeddedNarratorDockHost` 的 prop）。 |
| 工序闸门与配方图 | Novel Plugin 现有机制，与插件解耦。 |
| 团队状态/队列轮询 | 插件在自身 `storage` namespace 维护，面板与状态卡走插件 UI 视图；前端不再需要接 Runtime event bus。 |

## 九、风险与限制

1. **插件作者写明“测试性，未来可能并入 NarraFork 本体”**：API 可能变动；接入点（F1–F3）尽量引用其公共 manifest 字段而非内部，升到 v0.1.50+ 时以 manifest 兼容性 + e2e 验证为准（0.7.7 起宿主要求版本对齐，插件听 hello 握手强校验 manifest version，硬编码会导致 `HELLO_VERSION_MISMATCH`——该版本对齐已由插件自处理）。
2. **无 npm 注册**：单一发行源 GitHub Release。发布管道与 SBOM 已随包（`sbom.spdx.json`）。
3. **真实对话链路未验**：本机隔离实例无模型凭据。对话级验收（plan 反思自动批准、followUp 线程近期兑现、report 闭环跨 malicious 针对 worker 的边界）应在基线/真书试用阶段补跑，并作为 Base7「原作者试用」的标准场景。
4. **member role 模型不外显普通叙述者的绑定**：F3 不做完前，想要 worker 写章节只能让 NovelFork 先把叙述者经自己的 entry 建出来，再 `team.setup` 收进团队——这是推荐的 0 步骤顺序，Unblocked 当前评估。
5. **`assertRawNarratorAccess`**：插件创建的无绑定叙述者经产品访问控制是放行（向后兼容，services/narrator-access.ts:84-89），产品侧 UI 要不要把这些普通叙述者放到“我的叙述者”列表需要产品决定（默认建议：属于团队而由插件创建的叙述者在产品 UI 归「团队」附属，别散列表）。
6. **运行时授权静默 fail-closed 的风险**：一旦升级增加能力或宿主策略要求 pending 审批，若 F2 未做，用户不会在 Studio 里看到审批卡（REST 或 Runtime 原页见）。故 F2 应列入阶段 5 的硬门槛，不是 nice-to-have。
7. **单元测试 env**：插件 53+1 单元测试全过；上游 e2e 因布局限制未重放，已通过宿主真实安装弥补。Windows junction Bun 不 resolve 已踩坑，别把时间再耗在这里。
8. **污染与清理**：本次评估仅在 `tmp/narrator-team-eval/` + `tmp/narrafork-mirror/` 写数据；隔离实例的所有 NovelFork 相关变量由脚本统一隔离（NOVELFORK_HOME/PROJECT_ROOT/BOOKS_ROOT/RUNTIME_DIR/SESSION_STORE_DIR/STORAGE_DB_PATH/MARKET_DIR），未接触用户真实数据；实例已停、数据已按任务要求清理。

## 十、完成状态对照（T5.1 验收）

| 完成标准 | 状态 |
|---|---|
| 隔离实例安装 | ✅ 真实安装、启用、激活、面板资源链路 200 |
| 确认派发 | ✅ 源码级语义 + 真实注册 + SOP 宿主 seam；真实对话待基线 |
| 确认状态 | ✅ 真实 `team.status` 贡献注册；`team-*` 面板 `available` |
| 确认上下文交接 | ✅ 源码级（broadcast + log + 交付回执、幂等、多团队隔离） |
| 确认计划审查 | ✅ 宿主侧 plan-reflection auto-approve override seam（不绕过宿主安全） |
| 确认权限模型 | ✅ 首装信任决策 / 升级 pending / 运行时 pending / 永久拒绝；全局弹窗宿主在 Runtime 完整 App，Studio 外壳挂载未做（F2） |
| 评估结论与接入方案 | ✅ 本文第八节（F1/F2 需要 fork 层；F3 需要 fork 层；F4 可选 fork 层；其余不需要） |
