**创建日期**: 2026-09-28
**状态**: 待作者确认
**文档类型**: design

# Runtime 0.7.10 边界评估（T1.0 / T1.1）

对应 [路线与任务](../路线与任务.md) 的 T1.0（fork 层瘦身评估）与 T1.1（边界表）。事实来源：宿主库 `packages/.narrafork-runtime-fork-staging/`，fork 分支 `novelfork/integration-v0.6.6`（本地含 `006bf829`），上游 `upstream/main` 的 `24f2436a`（v0.7.10），上游插件设计文档 `docs/plugin-system/`。

## T1.0 fork 层能否改用官方插件接口

### fork 层现状

以真正的合并基点 `751ad11b`（上游 v0.6.6 最终发布版）为准，fork 层改动 126 个文件（新增 37、修改 89），去掉测试 71 个。注意宿主库的 tag `v0.6.6` 指向的是更早的 `1b79a9bc`，不能拿它当基线。

| 类别 | 文件数（非测试） | 内容 |
|---|---:|---|
| A 产品接缝 | 约 34 | 产品宿主接口 `server/lib/product-host/`（契约、登记、空实现）及其在 `main.ts`、`app.ts`、叙述者会话、WebSocket、权限、提示词、工具登记处的接入点；学习中心贡献；产品名与版本；产品技能目录（`.novelfork/skills`、`NOVELFORK_HOME`）与数据目录隔离；前端嵌入宿主（`RuntimeFrontendHostProviders`、`EmbeddedNarratorDockHost`、`EmbeddedProviderSettingsHost`）、消息列表里的领域工具结果渲染注入、嵌入 Dock 的连接租约 |
| B 迁移资产 | 24 | `runtime-migrations/`（11 个 SQL 与快照）与优先读取它的 `server/db/run-migrations.ts`。上游不带 SQLite 迁移 SQL，这是打包缺口，不是产品逻辑 |
| C 通用修复 | 约 10 | Chrome 独立配置目录、Windows 代理变量去重、Windows 下 tar 路径、`SQLITE_BUSY` 处理、worktree 快照的 git 参数、数据库 worker 池、推理块文本拼接、通知组件测试开关等 |
| D 依赖与配置 | 3 | `package.json`、`bun.lock`、`tsconfig.json` |

### 产品宿主接口提供什么、插件接口能不能替代

| 产品宿主接口的能力 | 0.7 插件接口 | 结论 |
|---|---|---|
| 在 Runtime 的 HTTP 服务里挂产品路由（`/api/books/…`、`/api/novelfork/…`） | 插件不能挂路由，宿主的 Hono、数据库、JWT 永不暴露 | 保留 |
| 按叙述者解析可信书籍绑定（工作目录、资源绑定） | 插件不读完整工具上下文 | 保留 |
| 领域工具及其风险等级、按权限模式启用、作者 / 高级可见性、工序闸门 | 插件可贡献工具，但权限走插件自己的授权模型，接不进叙述者的权限模式与工序闸门 | 保留 |
| 提示词扩展（小说上下文注入系统提示） | 插件 v1 没有提示词贡献 | 保留 |
| 产品叙述者的访问控制（按书归属拒绝读取状态、处理权限请求） | 插件无此能力 | 保留 |
| 学习中心贡献 | 插件无此能力 | 保留（低价值，可考虑删除） |
| Studio 直接复用 Runtime 的 React 组件（嵌入叙述者面板、供应商设置） | 插件 UI 是运行在 Runtime 界面里的沙箱 iframe，方向相反 | 保留 |
| 叙述者消息里的领域工具结果渲染 | 插件视图只能是 Dock 面板，不能渲染消息 | 保留 |

**结论**：本轮不走插件路线。v1 插件接口刻意不开放上面这些能力，而它们正是 A 类接缝的全部内容。OpenWrite 能改成插件，是因为 dsh 的插件能注册领域工具并直接驱动宿主 Agent；NarraFork v1 的设计原则是插件不进 Agent 循环。

**可以做的减重**：
1. C 类约 10 个文件在 T1.3 合并时对照上游 0.7.10，上游已经修掉的直接用上游版本。✅ 2026-09-28 合并后（相对 `24f2436a`）：fork 层 122 个文件，去掉测试与 `runtime-migrations/` 后 50 个（0.6.6 时 71 个）。`worktree-tree-snapshot.ts`（上游已强制 `core.autocrlf=false`）与 `knowledge-service.ts` 的修复被上游覆盖，已回到上游版本；Kiro / Cline 相关改动随上游删除。新增 `server/services/product-narrator-tools.ts`，把产品叙述者判断收成一处，会话与上游新拆出的 `agent-runtime/orchestrator.ts` 共用。
2. 上游没修的通用修复整理成 PR 候选清单，是否提交给上游由作者决定。目前记录到的：
   - 未配置任何供应商时，叙述者面板请求 `GET /api/settings/context-thresholds?model=&provider=` 返回 500（`Invalid string at ModelQuery.upstreamModelId`），每次打开面板都在控制台报错。fork 层没改过这条路由，属上游边界问题。
3. 长期看，最大的减重是向上游提议把「产品宿主接口」做成官方扩展点（嵌入式宿主 SPI）。这需要作者与上游维护者沟通。

**narrator-team 可用**：产品模式下 Runtime 的插件管理器是启用的（隔离实例启动日志 `Plugin manager initialized`，`enabled: true`）。升级到 0.7.7 及以上后即可安装。

## T1.1 Runtime 0.7.x 功能边界表

「采用」= 随升级获得，NovelFork 不需要改；「适配」= 需要 NovelFork 接缝、嵌入或删除重复；「不用」= 不对作者开放。

| 版本 | 功能 | 归类 | NovelFork 要做的事 |
|---|---|---|---|
| 0.7.0 | 叙述者会话公开分享 | 不用 | 会话里含书稿内容，默认不开放；以后按需评估 |
| 0.7.0 | 异步提问、子代理接管与续跑 | 采用 | — |
| 0.7.0 / 0.7.4 / 0.7.6 | Monaco 大文件编辑、文件预览与引用、分栏编辑预览、Markdown 预览滚动同步 | 适配 | T1.4：`chapters/` 只读或跳转写作台；非章节文件交给它，替掉 Studio 自己的 Markdown 查看器 |
| 0.7.0 | 插件宿主的 React 设置视图 | 采用 | 随 T1.7 嵌入 Runtime 设置页一起出现 |
| 0.7.0 | 持久消息队列与交付回执、未保存内容保护、工作区回退安全、大工作区快照转后台 | 采用 | — |
| 0.7.0 | 移除内置 Kiro / Cline 集成，退役交互教程 | 适配 | 清掉 fork 层与 Studio 里的相关引用（fork 改过的 Kiro / Cline 测试在上游已删除） |
| 0.7.1 | 数据目录权限检查与修复弹窗 | 适配 | 确认弹窗在 Studio 外壳里能显示；数据目录是 `NOVELFORK_HOME/.runtime` |
| 0.7.4 | 持久化异步运行时、程序化代理、Eval、事件驱动的任务等待、执行链路追踪 | 采用 | — |
| 0.7.4 / 0.7.10 | 文件变更证据、历史回退、Windows 服务端文件回退 | 适配 | T1.4：章节回退交还写作台；根本解法 T4.2 正文接纳 |
| 0.7.6 | PostgreSQL 双后端 | 不用 | NovelFork 桌面版只用 SQLite；T1.3 处理迁移入口冲突 |
| 0.7.6 | 结构化编辑工具（StructView / StructSed） | 适配 | 写章节时必须触发产品层附带动作（T1.4、T4.2） |
| 0.7.6 / 0.7.8 | Git 管理扩展到本机与远程工作目录、提交图 | 采用 | 核对 Studio 协作面板是否与之重复，重复则下线 |
| 0.7.6 | 例程工具三态（manual / auto / resident） | 采用 | 随 T1.7 嵌入 Runtime 套路页 |
| 0.7.6 | 全局图片查看器、工作区屏障状态卡 | 采用 | — |
| 0.7.6 / 0.7.8 | Kimi 配额、NUG CONNECT 隧道、Codex、gpt-6、模型卡 v2 与本地覆盖、模型菜单设默认 | 采用 | 供应商设置页已是嵌入的 Runtime 原页 |
| 0.7.7 | 叙述者工具栏重构为顶栏 / 菜单 / 底栏三段 | 适配 | T1.5 重接嵌入叙述者面板 |
| 0.7.7 | 前后端版本差异检测 | 适配 | Studio 是前端，要确认不会误判为版本不一致 |
| 0.7.8 | 通知中心（待处理 / 动态双视图） | 适配 | 取代 Studio 的通知设置复制品 |
| 0.7.8 | 按用户统计 AI 用量（图表、CSV 导出） | 适配 | 取代 Studio 的「使用历史」复制品 |
| 0.7.8 | 工具卡排队相位 | 采用 | — |
| 0.7.10 | 插件全局权限弹窗（含永久拒绝） | 适配 | 确认弹窗在 Studio 外壳里能显示，否则 narrator-team 等插件无法授权 |

### Studio 里要下线的复制品（T1.7）

| Studio 位置 | 行数（约） | 处理 |
|---|---:|---|
| `app-next/settings/panels/` 通用面板：个人资料、安全、模型、AI 代理、通知、消息网关、代理管理、Chapter 与容器、服务器与系统、实例认证、用户、终端、设备、存储空间、外部依赖、运行时环境、使用历史、关于、初始配置向导、运行时加固、监控、数据 | 设置目录合计约 1.29 万，另有 `runtime-admin/` 约 3800 | 改为嵌入 Runtime 原页 |
| 保留：外观与界面（书房主题）、Embedding 供应商（向量模型）、按书覆盖、写作配置 | — | 保留为 NovelFork 专属 |
| `app-next/routines/` | 约 5200 | 嵌入 Runtime 套路页 |
| `app-next/scheduled-tasks/`、`knowledge/`、`search/`、`learn/` | 约 2800 | 嵌入 Runtime 原页 |

### 嵌入 Runtime 原页的做法（T1.7，2026-09-28）

- **fork 层**（提交 `4a84267c`）：根路由的路由上下文加 `embeddedPage`，为真时根路由只渲染页面本身；`EmbeddedRuntimePageHost` 用 Runtime 自己的路由树 + 内存历史挂一个原页，外面套 Runtime 前端 Provider 与 `DatesProvider`。页面在自己范围内跳转时报告给宿主（`onPathChange`），跳出范围（叙述者链接等）被拦下交给宿主（`onNavigateOutside`）。
- **Bridge**：`@vivy1024/narrafork-runtime-bridge/frontend/runtime-page` 只声明类型，Vite / Vitest 别名到 Runtime 实现。
- **Studio**：`RuntimePageMount` 按入口（搜索、套路、知识库、定时任务、学习）限定路径范围；Studio 地址是 `/next` + Runtime 路径（`/next/knowledge/条目` ↔ `/knowledge/条目`），子路径与查询串原样来回，浏览器前进后退照常。
- **路由树生成**：`routeTree.gen.ts` 是 TanStack Router 插件的生成物，产品构建只构建 Studio，所以 Studio 的 `vite.config.ts` 用 Runtime 依赖里的插件生成它并按路由拆包。插件开发期的路由热替换必须关掉（`codeSplittingOptions.addHmr: false`）：它按路由 id 去 `window.__TSR_ROUTER__` 找旧路由，那是 Studio 自己的路由器，两边都有 `__root__`，Runtime 的根路由会被换进 Studio 的路由器，整个外壳变成 Runtime 的错误页。
- **未覆盖**：应用外壳的插件运行时（插件的 React 设置视图）与全局弹窗宿主（配置向导、插件授权弹窗）。`PluginRuntimeShell` 里的 `useBranding()` 会改写页面标题与图标，不能直接搬进 Studio；插件授权弹窗随阶段 5（narrator-team）一起做。
