**版本**: v0.1.0
**创建日期**: 2026-10-08
**更新日期**: 2026-10-08
**状态**: 评估完成，待用 C3 决策是否执行升级
**文档类型**: reference

# Runtime 0.8.3 升级评估

评估把 Runtime fork 从上游 0.7.12 升到公开 0.8.3 的成本与风险。**只评估，未在主仓落地任何升级改动**；全部操作（远端抓取与两种试合并）均在 `packages/.narrafork-runtime-fork-staging/` 内以只读或 `merge-tree`/`merge-file` 内存方式完成。

## 事实来源与方法

- fork 侧基点：`novelfork/upgrade-0.7.10` 分支头 `42c8648f`（= 当前物化树，内容对齐私有上游 0.7.12 时代的 `3ac2d0df`，见 `UPSTREAM.lock.json`）。
- 公开上游：`https://github.com/NarraFork/NarraFork`（MPL-2.0，本次新增 remote `upstream-public`）。**无任何 tag**；main 头 `4e04d2f2`（2026-10-07，package.json `version: 0.8.3`，`packageManager: bun@1.4.2` 与现行一致）。公开历史含 `release: v0.7.12`（`f275816a4`，2026-09-30）、`release: v0.8.1/0.8.2/0.8.3`（`be6240400`）等发布提交。
- 试合并以 `git merge-tree --write-tree`（git 2.49，与 `git merge` 同一 ort 后端）完成，等价于真实 merge 的冲突面，但没有在检出里留现场。
- fork 层定义：`git diff 3ac2d0df 42c8648f` = 141 个文件（`3ac2d0df` 是 fork 头祖先，差异即纯 fork 层；另有 18 个 fork 侧提交，含合并与接缝基线快照 `5ab50ffe`）。

## 一、上游现状：两条活跃历史线，公开线不承接私有历史

| 上游线 | 位置 | 头 | 与 fork 的关系 |
|---|---|---|---|
| 私有 `NarraFork/narrafork-private` | main `6ecb09ef`（2026-10-06「fix(worktree): 兼容旧版 Git 并核验回退清单」，领先 `3ac2d0df` 共 138 提交） | 仍活跃 | 同一历史线，可常规三方 merge |
| 公开 `NarraFork/NarraFork` | main `4e04d2f2`（2026-10-07，0.8.3），历史全量重写共 1488 提交，根在 2026-02-12 | 活跃、昨天仍在推 | **历史不相交**：`3ac2d0df` 在公开库不存在，直接 merge 报 unrelated histories |

公开库对私有 0.7.12 内容的保真度：公开 `f275816a4` 与私有 `3ac2d0df` 的树差异为 145 文件（+906/-11669），其中大头是**开源消毒**（删除 `.claude/skills`、`.narrafork` 计划、`.spec_now`、`IMPROVEMENT-PLAN.md`、`docs/plans` 等私有内务文档），代码树实质等价。公开库根有 `LICENSE`（MPL-2.0，另有提交 `73b99e50`「明确 MPL-2.0 与贡献者再许可授权」）；私有树从未带 LICENSE 文件。

## 二、变更热点（公开 0.7.12 → 0.8.3）

`f275816a4` → `4e04d2f2`：201 个提交（128 普通 + 73 合并），1615 个文件，+228934/-102833 行。

| 目录 | 文件数 | 行数（+/-） | 备注 |
|---|---:|---:|---|
| frontend/components | 532 | +69091/-14185 | vlist 统一高低文本高度缩限、聊天与分享渲染统一、文件修改面板移除、会话工作区/权限申请统一 |
| server/services | 324 | +78227/-8568 | 异步提问闭环、子代理重启恢复、权限管道大改、project-archive 新服务族、公开分享重构、scheduled-tasks 保留策略 |
| server/lib | 241 | +30354/-2149 | 浏览器内存诊断 Worker 族、db-worker 搜索查询池、更新服务换 GitHub Release+zstd 增量 |
| shared/pretext-layout | 23 | +2816/-109 | fork 碰过 reasoning-segments/segment-adapter |
| remote-executor/internal | 27 | +4520/-18 | 新增 Go 远端执行器 |
| update-server-go | 15+3 | 0/-3125 | **整目录退役**（`88fd18c8` 统一 TS 更新服务），`update-server/`（TS）保留 |
| drizzle-postgres/meta | 6 | +1509/-64657 | PG 迁移快照收敛为单一基线；SQLite `drizzle/` 依旧不入库 |
| scripts/lib | 17 | +5579/-5 | 构建脚本重构 |
| server/db | 6 | +1786/-35 | SQLite schema +309 行（postgres-schema +1288），若干提交触及 |

结构性事项：

- **服务端 Worker 大量新增**：`server/lib/browser/memory-profile-worker.ts`、`memory-snapshot-worker.ts`、`server/lib/share-preview-worker.ts`、`server/services/project-archive/legacy-import-worker.ts`、`legacy-sync-worker.ts`、`server/services/search/sqlite-worker-runner.ts`、db-worker `search-query.ts`。产品编译脚本的 `RUNTIME_WORKER_ENTRIES` 垫片清单要按契约测试同步补齐（CLAUDE.md 已预见的常规维护）。
- **文件修改面板移除**（`741f1b52`）：`file-panel/FileModificationsDrawer/FileApprovalTab/FileSummaryTab/FileDeletePreviewTab` 删除，`file-panel-id` 挪入 `dock/`；`FilePreviewModal`/`LargeFileGate` 保留。
- **聊天渲染统一**（`6fa098f4`、`742d22bd`）：`frontend/components/chat/RenderChatMessageBody*`、`chat-measure-cache`、`measure-chat-message`、vlist `render/TokenLines.tsx` 删除，功能并入 vlist。
- **公开分享重构**：`public-narrator-share-{lineage,messages,projection,stream}` 被 `share-{service,connections,limits,rate-limit}` 等新族取代。
- 插件权限收紧（`b062cc74`）：波及 `narrator-permission.ts`、`plugin-permission-store`、`plugin-manager`、`device-connection-service`、`narrator-ws.ts` 等 21 个文件（+245）。
- 依赖：Mantine 9.4.1→9.5.1 并新增 `@mantine/dates`、`@babel/parser`（固定 7.29.0）；`monaco-editor` 0.56.0；`bun-pty` 0.4.11。
- 文件总量：fork 树 4579 个；两边共有 4450 个；仅 fork 有 129 个（49 fork 层独有 + 80 上游删除/消毒）；仅公开 0.8.3 有 624 个（0.8.x 新增能力）。

## 三、冲突规模与难度估计

fork 层 141 个文件 = 92 个与上游共有路径（内容均已被 fork 改过）+ 49 个 fork 独有文件。0.7.12→0.8.3 上游动过的 1615 个文件里与 fork 层相交 **39 个**。

### 三种合并路径的冲突面

| 路径 | 做法 | 冲突面 | 备注 |
|---|---|---|---|
| A. 继续私有线 | `merge upstream/main`（私有） | 常规三方合并，复杂区与下方「真实内容冲突」同量级（≈10 个文件） | 私有库仍可访问但存续无保障；无 LICENSE，不能支撑公开发布 |
| B. 公开线冷合 | `merge --allow-unrelated-histories upstream-public/main` | **949 个 add/add 冲突**（实测 merge-tree 空 base）：857 个机械取 theirs（纯上游演进）、82 个机械取 ours（fork 单边修改）、10 个手工 | 数量大但 98% 可脚本化按分类解 |
| C. 公开线树级移植（推荐） | 从公开 0.8.3 开新分支，把 fork 层按 3ac2d0df 为虚拟 base 逐文件三方重放 | **10 个真实内容冲突**（全部 1-3 块），其余 82 个 `git apply -3`/`merge-file` 应能干净落地，49 个 fork 独有文件直接 checkout 过来 | 放弃 merge 血缘，换一张干净的公开谱系起点；之后升级回到常规三方 |

实测三方估计（`git merge-tree --merge-base=3ac2d0df 42c8648f upstream-public/main`）：10 个 CONFLICT (content)，**无** modify/delete、**无** add/add；`bun.lock` 自动并（仍需 `bun install` 验证）、`run-migrations.ts`、`narrator-prompt.ts`、`tools/index.ts` 等接缝自动并。

### 10 个真实冲突文件（merge-file 逐块核定）

| 文件 | 冲突块 | fork 改动 | 上游改动 | 成因与解法判断 |
|---|---:|---|---|---|
| server/services/agent-runtime/orchestrator.ts | 3 | 27+/2- | 388+/92- | fork 接产品工具可见性同步与按权限模式过滤；上游上异步提问闭环、上下文口径、附件路径、子代理归因。逐块并集后须对照新 ACL 入口重接 |
| server/services/narrator-session.ts | 1 | 98+/16- | 665+/52- | fork 三态常驻叙述者判断与被拒工具重跑过滤；上游上子代理恢复、提问闭环、字符统计缓存。块虽少但语义紧贴，回归重点 |
| frontend/components/narrator/dock/NarratorDockContext.tsx | 1 | 14+/0- | 50+/41- | fork 加 `onOpenFile` 注入（`127e5c31`）；上游移除文件修改面板并瘦身 context 值。需确认 fork 注入点的宿主 API 仍在（NarratorDock 文件本体未动，预计可并集） |
| frontend/components/narrator/vlist/ExactRow.tsx | 1 | 31+/0- | 80+/8- | fork 注入 `useRuntimeToolResultRenderer`；上游同锚点加长文本折叠/分享只读渲染。沿用上次「按并集解」模式 |
| server/routes/projects.ts | 1 | 17+/5- | 201+/210- | fork 导出 `deleteProjectById` + `requireSqliteProjectMutation` 接入点；上游 0.8.2 重做工作区资源归属与退役保护。警卫顺序要人工排 |
| server/main.ts | 1 | 16+/4- | 147+/56- | fork 挂产品宿主登记；上游上加优雅关闭/恢复、局域网监听修正。机械并集即可但属启动序列，跑冒烟 |
| frontend/components/AppRootLayout.tsx | 1 | 1+/4- | 21+/1033- | fork 接缝基线小改；上游大重构该文件。以 theirs 为主体重嵌 fork 三行级改动 |
| server/lib/browser/pool.ts | 2 | 113+/17- | 25+/15- | fork 的 Chrome 独立配置目录等修复为主；上游小改。大概率以 ours 为主体并上游新增项，属「fork 修复是否已被上游覆盖」判读点 |
| server/lib/__tests__/zstd-patch-file.test.ts | 3 | 10+/6- | 107+/1- | 上游换 GitHub Release 增量更新后夹具大改；fork 的 Windows 修复跟着上游新夹具重放 |
| frontend/lib/narrator-ws-manager.test.ts | 1 | 33+/0- | 39+/0- | 双方同点新增测试断言，并集 |

模式与 0.7.10/0.7.12 两次合并一致：**fork 注入点 vs 上游同锚点新增**，多为并集解；没有需要重设计 fork 接缝的冲突，但 orchestrator/narrator-session/权限三处要语义级核对（fork 的权限过滤代码是插在调用点上，上游 ACL 内核加了一千多行，插点位置大概率变了）。

## 四、接缝兼容性结论（fork → 公开 0.8.3）

结论：**fork 依赖的上游接口全部健在，签名抽查未变；兼容性风险集中在「同文件碰撞」而非「接口消失」**。

| fork 接缝 | 依赖的上游目标 @0.8.3 | 核对结果 |
|---|---|---|
| `EmbeddedNarratorDockHost` | `dock/NarratorDock`、`dock/NarratorDockContext`、`hooks/useNarrator`、fork 自有两个 Context | 均存在；context 碰撞即上表 1 块冲突；上游移除的文件面板 fork 未直接 import |
| `EmbeddedPluginUiHost` | `plugins/index`、`plugins/app-host-local`（`createAppPluginHostLocal(deps)` 签名原样）、`plugins/notifications`、`lib/query-client` | 文件 0 改动；插件权限收紧未触这层 |
| `EmbeddedPluginPermissionRequestHost` | `plugins-admin/PluginPermissionRequestHost`（具名导出不变） | 存在；但其依赖的权限事件经 `b062cc74` 收紧，**嵌入弹窗要做回归**（含 leader 递补测试 `cc1069c7`） |
| `EmbeddedRuntimePageHost` | `routeTree.gen`（codegen，依旧不入库） | 上游 0.8.x 新增独立窗口/路由（`7f7b2523`、`73b4fa56`），嵌入页对路由名变更要重测（`db3d703f` 已修过一次同类问题） |
| `product-host/text-generation` | `agent/provider`（`GenerateMetaResult` 等类型）、`api-request-tracker`（`TrackApiRequestOptions`/`trackApiRequest` 签名原样） | provider +3/-0、tracker +13/-6，兼容 |
| `product-narrator-tools` | `narrator-cwd`（`resolveNarratorSessionCwd`）、product-host 登记 | 存在；真正风险在 orchestrator 调用点碰撞 |
| 工具注册 | `server/lib/agent/tools/index.ts` | 上游仅 +11/-0，并集重放压力小；`tool-executor.ts` 上游 +213/-29，fork 未改它 |
| 权限管道 | `server/services/narrator-permission.ts` | **上游 +1488/-17**（fork 同文件仅 48+/1-，merge 自动并）——fork 的权限模式过滤补丁**必须按新 ACL 结构人工对齐**，是本项目最大单点审查量 |
| 迁移 | `server/db/run-migrations.ts` | 上游 0 改动，fork 的 runtime-migrations 优先逻辑自动保留；schema +309 行需 `bunx drizzle-kit generate` 出新迁移，同步 `drizzle/` 与 `runtime-migrations/` |
| 嵌入主题/配色 | fork 自有（`006bf829`、`3d788013` 等），依附 `RuntimeFrontendHostProviders` | fork 侧文件，无碰撞 |
| 编译垫片 | 上游新增 ≥6 个服务端 Worker（见第二节） | 主仓契约测试会失败，`RUNTIME_WORKER_ENTRIES` 照新清单补 |

## 五、升级步骤建议

参照 CLAUDE.md「升级流程（当前有效）」调整（差异在起点与来源；验证与物化步骤不变）：

1. **决策来源**（决策点见下）。建议借本次升级**切换到公开线**：`upstream` 改指 `NarraFork/NarraFork`（本次已拉 `upstream-public` 到宿主库）；私有库留作存档。
2. 从公开 0.8.3 开分支 `novelfork/upgrade-0.8.3`（基点 `be6240400` 或 main 头 `4e04d2f2`，公开库无 tag，二选一并写进 provenance）。
3. 树级移植 fork 层（走路径 C）：
   - 49 个 fork 独有文件（`frontend/components/host/*`、`server/lib/product-host/*`、`product-narrator-tools.ts`、`runtime-migrations/*`（12 SQL + 13 meta）、`EmbeddedNarratorDockHost` 等）`git checkout 42c8648f -- <paths>`；
   - 82 个 fork 单边修改按 `git diff 3ac2d0df..42c8648f -- <f> | git apply -3`（或逐文件 `git merge-file`）重放，预期干净；
   - 10 个冲突文件按第四节判读手工解，解完逐个跑对应测试；
   - `package.json`/`bun.lock`：取上游 0.8.3，重放 fork 定制（`zod` 固定 `4.3.6`、`bun-pty` 固定 `0.4.11`、5 个 `workbox-*` 依赖），`bun install` 重建；
   - 上游删除/消毒集（`.claude/skills/release`、`.spec_now`、`.narrafork` 计划、`update-server-go`、`chat/` 旧渲染族等 80 个）跟随上游删除——fork 未修改过这些文件，保留只会留下死代码。
4. 迁移：`bunx drizzle-kit generate` 对 `runtime-migrations` 末版快照（`0011_tense_shadow_king`）求差，生成新迁移，两处同步；数据回填沿用 `data-backfills.ts` 按列存在性触发的惯例。
5. 验证（沿用既有关卡，全部与**公开 0.8.3 纯基线** worktree 对照，不看绝对错误数）：
   - `bun run typecheck`（tsgo；bridge 用 tsc）；已知 codegen 恒红项照旧豁免；
   - fork 层与会话/权限/嵌入宿主相关测试套件（上次为 63-65 个文件量级）分批跑（Windows/bun 全量长跑已知不稳区：revert 系列、EBUSY，用基线同现性判读）；
   - 语义审查三处：orchestrator 权限过滤插点、narrator-session 三态常驻、EmbeddedPluginPermissionRequestHost 对收紧后权限事件的兼容；
   - 主仓侧：`RUNTIME_WORKER_ENTRIES` 契约测试、`pnpm run typecheck` 全工作区；
   - 隔离实例真实启动验证（`bun scripts/start-isolated-verify.ts`）。
6. 推送 fork 分支 → 备份物化目录 → 重写 `UPSTREAM.lock.json`（`repository`/`remote` 换公开库，provenance 记录虚拟 base `3ac2d0df`、公开基点、逐文件移植方式与 10 处手工冲突处理）→ `pnpm runtime:sync` → 冒烟 → 全工作区 typecheck → EXE 功能核验。
7. 升级完成后更新 CLAUDE.md 已知基线段与升级流程文档（remote 指向、无 tag 的基点记法、公开历史校验步骤）。

## 六、风险与验收要求

| 风险 | 等级 | 说明与对策 |
|---|---|---|
| 继续跟私有线 vs 切公开线 | **决策点** | 私有线 merge 便宜但无 LICENSE 保障、存续由上游单方面决定，且不支撑 NovelFork 公开发布；公开线一次手术（本报告路径 C）后一劳永逸。建议切公开线 |
| MPL-2.0 合规 | 高（合规项非工程项） | 0.8.3 起上游带 MPL-2.0：fork 修改 MPL 文件的分发形态（编译 EXE）触发 MPL §3.2 源码提供义务，与「Runtime 保持私有、不公开物化树」的现行边界冲突。升级前需要作者就公开 fork 或源码提供机制作出决定 |
| 公开历史再次重写 | 中 | 公开库历史本就是重写产物（1488 提交自 2026-02-12）；未来若再 rewrite，本次建立的谱系会再次断裂。对策：升级流程加「上次基点提交是否仍在公开历史」检查（`git merge-base --is-ancestor <lastBase> upstream-public/main`），失败即回到树级移植 |
| 权限管道语义偏移 | 中-高 | `narrator-permission.ts` +1488 行大改 + `b062cc74` 插件权限收紧：fork 的按权限模式过滤、被拒工具重跑过滤、嵌入权限弹窗三处必须人工对齐新结构，并用权限边界测试套件（`permission-boundary.test.ts` 等）验收 |
| 迁移缺口 | 中 | 上游照例不带 SQLite `drizzle/`：新迁移由我们 generate；若漏生成，EXE 启动即迁移失败。验收：全新隔离实例从零迁移到最新版、再打开既有库升级为序 |
| 编译垫片漂移 | 低-中 | 新增 Worker 未补进 `RUNTIME_WORKER_ENTRIES` 时契约测试先红，按单补齐即可 |
| 环境噪声误判 | 低 | 宿主库 stat 假脏约 2689 文件（本次 checkout 即被其阻断过）；物化树 tsgo 恒红；revert/EBUSY 已知不稳。全部以纯公开 0.8.3 基线同现性判读 |

验收最低集合：① 与公开 0.8.3 纯基线对照 tsgo 无合并独有错误；② fork 层测试套件无合并独有失败（基线分批同跑）；③ 隔离实例冷启动 + 叙述者写作工具经工序闸门与权限过滤各跑通一例；④ Windows EXE 冒烟（含嵌入面板、权限弹窗、Monaco 主题跟随）。

## 附：关键数据与复现命令

```bash
# 基点与头
fork=42c8648f            # novelfork/upgrade-0.7.10（物化树=上游 0.7.12 内容 3ac2d0df）
public0712=f275816a4     # 公开 release: v0.7.12（2026-09-30）
public083=be6240400      # 公开 release: v0.8.3
pubHead=4e04d2f2         # 公开 main 头（2026-10-07，0.8.3 + 2 提交）
privateHead=6ecb09ef     # 私有 narrafork-private main（2026-10-06，领先 3ac2d0df 138 提交）

# fork 层与上游变更面
git diff --name-only 3ac2d0df 42c8648f | wc -l                 # 141（fork 层）
git diff --numstat f275816a4 4e04d2f2                          # 1615 文件 +228934/-102833
comm -12 <fork层> <上游touched> | wc -l                        # 39（双边触碰）

# 两类试合并（git 2.49，merge-tree=ort 后端）
git merge-tree --write-tree --merge-base=3ac2d0df 42c8648f upstream-public/main
#   → 退出码 1，CONFLICT (content) × 10（无 modify/delete、无 add/add）
git merge-tree --write-tree --merge-base=$(git hash-object -t tree /dev/null) 42c8648f upstream-public/main
#   → 949 个 CONFLICT (add/add)：857 theirs / 82 ours / 10 手工
```

环境注记：宿主库当前检出仍在 `novelfork/integration-v0.5.23`；本次评估未切任何分支（公开试合并全部以 merge-tree 内存方式完成）；本次新增 remote `upstream-public`（https），`upstream`（私有库）指向未动；检出上原有的 `package.json` 本地改动（0.5.23 时代的 144 行缩进差异）已原样恢复。
