# InkOS 桌面端静态审查报告

日期：`2026-04-15`

范围：
- 本报告只审查 `inkos-master/` 中与桌面端工作区、本地文件、AI 写作链路、模型路由、MCP、Plugins 直接相关的代码路径。
- 本次未修改业务代码，只做静态阅读与现有验证结果复核。

已核对的前置事实：
- 已阅读根目录 `OPS_RUNTIME_STATE.md`。
- 已结合此前同轮检查结果复核 `inkos-master` 的类型检查与测试基线。

## 一页结论

1. InkOS 桌面端有本地文件读写能力，但它不是通用 IDE 文件系统，也不是 VS Code/Cursor 那种“任意目录任意文件都能被 AI 直接消费”的实现。
2. “把世界观设定文件放到特定目录让 AI 读取”这件事，当前只对一组约定文件名成立。任意自定义文件不会稳定进入 AI 的工作上下文。
3. “模型路由”在代码里的真实含义是“给不同 agent 分配不同模型或上游”，功能概念本身成立，但 UI/命名/默认值设计很差，普通用户几乎不可能自然看懂。
4. MCP 和 Plugins 都存在“底层零件有一部分、前端页面也有，但接线不完整”的问题，尤其桌面端 Tauri 模式更明显。
5. 除了你提到的能力缺失，桌面端当前还带着几处实质性 bug：OAuth 接线错误、Anthropic 模型列表回退、Relay 写作链路与本地落盘脱节、文风文件命名不一致、测试基线本身为红。

## 1. 本地文件能力到底有多少

- Tauri 桌面壳确实暴露了本地文件命令：`read_file_text`、`write_file_text`、`list_dir`、`delete_path`、`create_dir_all`、`select_workspace`。证据：`packages/desktop/src-tauri/src/commands.rs:44-99`，`packages/desktop/src-tauri/src/main.rs:24-30`。
- 前端桌面存储层 `TauriStorageAdapter` 也确实把数据写进用户选择的工作区，而不是只存内存：`books/<bookId>/book.json`、`chapter_index.json`、`chapters/*.md`、`story/*`、`inkos.json`。证据：`packages/studio/src/storage/tauri-adapter.ts:3`，`79`，`102-136`，`169`，`243`，`249`，`272`。
- UI 里有工作区选择器、书籍/章节树、真相文件页，但没有通用资源管理器。证据：`packages/studio/src/pages/WorkspaceSelector.tsx`，`packages/studio/src/components/Sidebar.tsx:157-174`，`399-437`，`packages/studio/src/pages/TruthFiles.tsx:19-124`。

结论：
- 桌面端的“本地文件能力”是真实存在的。
- 但它是“工作区约束下的专用读写能力”，不是“任意目录通用 IDE + 任意文件通用 Agent”。

## 2. “把设定文件放到特定目录”现在到底能干嘛

### 2.1 真正会被系统稳定读取的，是约定文件名

- 书籍真相文件白名单在 `TRUTH_FILES` 里被写死：`story_bible.md`、`volume_outline.md`、`current_state.md`、`particle_ledger.md`、`pending_hooks.md`、`chapter_summaries.md`、`subplot_board.md`、`emotional_arcs.md`、`character_matrix.md`、`style_guide.md`、`parent_canon.md`、`fanfic_canon.md`、`book_rules.md`、`author_intent.md`、`current_focus.md`。证据：`packages/studio/src/api/routes/storage.ts:19-24`。
- AI 上下文装配也只主动读取这一组约定文件，并且给它们写死了标签。证据：`packages/studio/src/api/routes/ai.ts:483-498`，`528`，`586`。
- 核心 agent 读取的也几乎都是这些约定名字，而不是“遍历整个目录建立知识库”：
  - `writer`：`packages/core/src/agents/writer.ts:126-138`，`422-429`
  - `chapter-analyzer`：`packages/core/src/agents/chapter-analyzer.ts:48-55`
  - `continuity`：`packages/core/src/agents/continuity.ts:337-347`
  - `planner`：`packages/core/src/agents/planner.ts:41-47`，`129`
  - `state manager` / `fs adapter`：`packages/core/src/state/manager.ts:279-345`，`packages/core/src/storage/fs-adapter.ts:20-25`，`145-150`

结论：
- 目前它不是“把任何世界观文档扔进目录，AI 就会自动理解”。
- 它是“把一组系统认得的文件名放进 `story/` 目录，相关 agent 才会把这些文件稳定纳入上下文”。

### 2.2 自定义文件名的现实状态：能看到，不等于能被 AI 用

- 独立服务端模式下，真相文件列表接口会把 `story/` 目录里的所有 `.md` / `.json` 都列出来。证据：`packages/studio/src/api/routes/storage.ts:264-277`。
- 但是查看和保存单个真相文件时，又只接受 `TRUTH_FILES` 白名单；不在白名单里的文件会直接返回 `Invalid truth file`。证据：`packages/studio/src/api/routes/storage.ts:236-259`。
- 这意味着在 standalone 模式里，会出现“列表里能看见自定义文件名，但点进去/保存时后端不认”的自相矛盾设计。
- Tauri 桌面桥接模式更宽松：`/api/books/:id/truth/:file` 直接把路径传给本地适配器，不做白名单校验。证据：`packages/studio/src/hooks/tauri-api-bridge.ts:703-719`。
- 但即使 Tauri 模式允许读写任意文件名，核心 AI 上下文与 agent 仍然主要只消费上面那组约定文件名；任意文件并不会自动进入 AI 上下文。证据仍是 `packages/studio/src/api/routes/ai.ts:483-498` 以及核心 agent 读取逻辑。

结论：
- “放到特定目录”的当前价值，主要是给约定文件名提供落盘位置。
- 自定义世界观文件即使能在桌面端保存出来，也不会自动成为 AI 的通用知识源。

## 3. 桌面端 AI 会不会直接把结果写回工作目录

- 本地 daemon 写作链路会直接落盘章节并更新 `chapter_index.json`。证据：`packages/studio/src/hooks/tauri-api-bridge.ts:246`，`580`，`599-600`。
- 但桌面端主 AI 客户端实际是 `RelayAIClient`。证据：`packages/studio/src/providers/inkos-context.tsx:87`。
- `RelayAIClient` 的 `writeNext` / `draft` / `revise` 只是：
  - 本地组装 snapshot
  - 发到远端 `/api/ai/*`
  - 把返回结果直接返回给调用方
  - 代码里没有把返回结果回写到本地工作区的实现
  证据：`packages/studio/src/ai/relay-client.ts:65-93`，`108-157`。
- 更直接的证据是 relay 服务端只会把 snapshot 物化到临时目录、跑一遍 pipeline、返回 `{ ok: true, result }`，然后删掉临时目录，不会替用户改回本地工作区。证据：`packages/studio/src/api/routes/ai-relay.ts:3`，`57-60`，`151`，`158-171`，`180-195`，`225-245`。
- `relay-client.ts` 文件头注释写着“receives result, applies mutations back to local storage”，但实现里并没有对应落盘代码。证据：`packages/studio/src/ai/relay-client.ts:1-4` 对比 `108-157`。

结论：
- 代码层面不能把“桌面端有本地文件能力”和“桌面端所有 AI 按钮都会自动把结果写进工作目录”画等号。
- 当前更接近“本地能存文件，但主 AI 按钮走 relay 后未完整落地回写”。

## 4. 模型路由是什么，为什么用户还要额外配置

### 4.1 代码里的真实含义

- `modelOverrides` 是项目配置中的一个映射。证据：`packages/core/src/models/project.ts:65-66`，`129`。
- `PipelineRunner.resolveOverride(agentName)` 会按 agent 名称决定：
  - 没覆盖时，使用项目默认模型/客户端
  - 覆盖值是字符串时，只换模型名
  - 覆盖值是完整对象时，可给该 agent 单独指定 `provider`、`baseUrl`、`apiKeyEnv`
  证据：`packages/core/src/pipeline/runner.ts:359-391`。

直白解释：
- “模型路由”不是网络路由。
- 它其实是“writer、reviser、continuity、planner 这些 agent，分别走哪个模型/哪个上游”。

### 4.2 为什么你会完全看不懂

- 配置页同时存在两套概念：
  - LLM Profiles：项目整体默认模型配置。证据：`packages/studio/src/pages/ConfigView.tsx:291`，`311`，`334`，`341`。
  - Model Routing：按 agent 单独覆盖。证据：`packages/studio/src/pages/ConfigView.tsx:196`，`661`，`684`，`707-739`。
- Agent 面板还会把每个 agent 的 `provider`、`baseUrl` 单独展示出来。证据：`packages/studio/src/pages/AgentPanel.tsx:51`，`150-154`。
- 桌面端 Tauri 本地桥也单独维护一套 LLM Profiles，本质上形成“默认配置一套 + 覆盖路由一套”的双层概念。证据：`packages/studio/src/hooks/tauri-api-bridge.ts:165`，`198-205`，`741-760`，`1429-1517`。

结论：
- 功能概念本身并不是假的。
- 但现在的产品表达非常差，用户先要理解“默认 LLM 配置”和“按 agent 覆盖”这两层，再理解 `provider/baseUrl/model`，普通用户几乎一定会困惑。

## 5. MCP：页面有，底层也有一点，但桌面端基本没接通

- Studio 服务端只在 `standalone` 模式挂载 MCP 路由。证据：`packages/studio/src/api/server.ts:180-195`。
- `routes/index.ts` 里确实只导出了 `createMCPRouter`，没有别的 MCP 变体。证据：`packages/studio/src/api/routes/index.ts:1-10`。
- MCP 管理路由本身是简化版：
  - 配置保存在 `inkos.json`
  - 运行状态存在进程内 `runningServers`
  - 启动时直接 `spawn`
  - 注释明确写了“简化版：假设启动后立即可用，实际应等待 MCP 初始化握手”
  - 工具列表 `tools/list` 也是 TODO
  证据：`packages/studio/src/api/routes/mcp.ts:27`，`51-84`，`84-132`，尤其 `111`
- 侧边栏在桌面端 Tauri 也会显示 “MCP Server” 入口。证据：`packages/studio/src/components/Sidebar.tsx:318`，`321`。
- 但我对 `packages/studio/src/hooks/tauri-api-bridge.ts` 做了代码搜索，`api/mcp`、`/plugins`、`/api/auth/oauth2` 均无匹配；也就是桌面端本地桥根本没有接这些接口。证据：本次搜索结果 `NO_MATCH in tauri-api-bridge.ts`。

结论：
- MCP 在 standalone 模式下是“简化可用但不完整”。
- MCP 在桌面端 Tauri 模式下是“菜单已经露出来，但本地桥没接接口”，用户体感上基本等于不可配置。

## 6. Plugins：有核心框架，有前端页面，但后端路由没接

- 核心层确实有真正的插件系统：`PluginManager` 能 discover、load、initialize、activate、enable、disable、updateConfig。证据：`packages/core/src/plugins/plugin-manager.ts:47-58`，`60-121`，`129-292`，`298-386`。
- 仓库里也确实有插件示例：`plugins/auto-backup/index.ts`。
- 前端插件页会请求这些接口：
  - `GET /plugins`
  - `POST /plugins/enable`
  - `POST /plugins/disable`
  - `POST /plugins/config`
  证据：`packages/studio/src/pages/PluginManager.tsx:39`，`51`，`53`，`68`。
- 但 Studio 路由导出表里根本没有 plugins router，服务端挂载表里也没有任何 plugins route。证据：`packages/studio/src/api/routes/index.ts:1-10`，`packages/studio/src/api/server.ts:173-195`。
- 侧边栏仍然展示了 “Plugin 管理” 入口。证据：`packages/studio/src/components/Sidebar.tsx:330`，`333`。
- 国际化文案还把插件描述成“基于 MCP 的外部工具集成”，说明产品概念上也有混淆。证据：`packages/studio/src/hooks/use-i18n.ts:335-338`。

结论：
- Plugins 不是完全不存在。
- 但从 Studio 当前代码看，插件页更像“已做 UI、底层也有框架、接口层没接上”的半成品。

## 7. 已确认的其他实质性 bug

### 7.1 桌面端 Sub2API OAuth 接线错误

- 配置页桌面端按钮直接跳 `/api/auth/oauth2/initiate`。证据：`packages/studio/src/pages/ConfigView.tsx:380`。
- 这个 OAuth 路由只存在于 Web 服务器侧。证据：`packages/studio/src/api/routes/auth.ts:114-152`。
- Tauri 本地桥里没有 `/api/auth/oauth2/*` 分支。证据：本次对 `packages/studio/src/hooks/tauri-api-bridge.ts` 的搜索结果为 `NO_MATCH in tauri-api-bridge.ts`。
- Sub2API 授权端本身还要求用户已登录，否则直接 `User not authenticated`。证据：`twosub2api-main/backend/internal/handler/oauth2_handler.go:62`。

结论：
- 桌面端这条 OAuth 链按当前代码是断的。

### 7.2 Anthropic 模型发现逻辑回退

- Tauri 桥的 `fetchUpstreamModels` 对 Anthropic 改成“尝试请求 `/v1/models`，失败就返回空数组”。证据：`packages/studio/src/hooks/tauri-api-bridge.ts:268-301`。

结论：
- 如果上游不支持这个端点，用户会看到“模型列表空了，只能自己手填”，这会直接放大“模型路由为什么还要配置”的困惑。

### 7.3 文风导入写进了 AI 不读的文件名

- 核心 agent 和上下文装配统一读取的是 `style_guide.md`。证据：`packages/core/src/agents/writer.ts:128`，`packages/core/src/agents/continuity.ts:340`，`packages/core/src/agents/reviser.ts:80`，`packages/studio/src/api/routes/ai.ts:493`，`packages/studio/src/api/routes/storage.ts:23`。
- 但 Tauri 桥的“导入风格到书籍”却保存成了 `style-guide.json`。证据：`packages/studio/src/hooks/tauri-api-bridge.ts:1292-1305`。

结论：
- 这是明显的命名体系不一致，用户就算导入了文风，也未必能进入后续 AI 写作上下文。

### 7.4 真相文件列表与查看接口语义不一致

- `GET /api/books/:id/truth` 会列出所有 `.md/.json`。
- `GET/PUT /api/books/:id/truth/:file` 却只接受白名单。

结论：
- standalone 模式下，用户可能看到某个自定义设定文件出现在列表里，但无法正常查看/保存，这会直接造成“看着像支持，实际上又不支持”的体验。

## 8. 对你问题的直接回答

- “那我把它放到特定目录让它读取我的世界观设定文件，它完全做不到吗？”
  - 不是完全做不到。
  - 但它现在只会稳定读取一组约定文件名，不会把任意自定义设定文件自动当成知识库。

- “放到特定目录能干嘛？”
  - 主要作用是让这些约定文件有固定落盘位置，并在 writer / planner / reviser / continuity / chapter-analyzer 这几条链路里被稳定读取。
  - 对任意文件名来说，放进去最多只是“本地有了一个文件”，不等于“AI 会用它”。

- “模型路由是啥？”
  - 代码里的意思是“按 agent 指定不同模型或上游”。
  - 它不该以现在这种表达方式直接砸给普通用户。

- “MCP 和 plugins 为什么没法配？”
  - 因为从代码上看，它们都不是完整打通状态。
  - MCP 只有 standalone 路由，而且实现本身还是简化版。
  - Plugins 连 Studio 后端路由都没挂出来，前端页面先走在前面了。

## 9. 验证记录

- 已读：`OPS_RUNTIME_STATE.md`
- 已核对：相关代码路径的静态实现
- 已有结果复核：
  - `pnpm --dir inkos-master --filter @actalk/inkos-studio typecheck` 之前已通过
  - `pnpm --dir inkos-master --filter @actalk/inkos-studio test` 之前已失败，现有基线问题包括：
    - `@actalk/inkos-core` mock 缺少 `pipelineEvents`
    - `App.test.ts` / 第三方 CSS 导入问题
    - 证据：`packages/core/src/index.ts:13`，`packages/studio/src/api/routes/pipeline.ts:4`，`41`，`packages/studio/src/main.tsx:1`
- 本次未做浏览器实测
- 本次未做桌面端实机验活
- 本次未改业务代码

## 10. 第二轮复核：你补充的 11 条 Bug

状态说明：
- `成立`：代码证据足够，描述基本准确
- `部分成立`：问题方向对，但表述需要收紧

### 10.1 成立的项

1. `Tauri 路径穿越漏洞`：成立。
   - `read_file_text`、`write_file_text`、`list_dir`、`delete_path`、`create_dir_all` 都直接接收前端传入路径并操作文件系统，没有做工作区约束或 `canonicalize` 校验。证据：`packages/desktop/src-tauri/src/commands.rs:44-95`。

2. `Tauri updater / process 插件未注册`：成立。
   - 前端确实调用了 `@tauri-apps/plugin-updater` 和 `@tauri-apps/plugin-process`。证据：`packages/studio/src/components/UpdateChecker.tsx:25-26`，`62-63`，`78-79`。
   - 但桌面端后端只注册了 `dialog`、`fs`、`deep-link`、`single-instance`，没有 `updater` / `process`。证据：`packages/desktop/src-tauri/src/main.rs:11-18`。
   - `Cargo.toml` 里也没有对应依赖。证据：`packages/desktop/src-tauri/Cargo.toml`。

3. `select_workspace 在 async 命令里调用 blocking_pick_folder`：成立。
   - 代码就是 `pub async fn select_workspace(...)` 内部直接调用 `blocking_pick_folder()`。证据：`packages/desktop/src-tauri/src/commands.rs:99-100`。
   - 这至少是明确的阻塞式实现，不是纯异步文件选择流程。

4. `Vite external 配置错误`：成立。
   - `packages/studio/package.json` 把 `@tauri-apps/api`、`@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process` 作为正常依赖声明。证据：`packages/studio/package.json`。
   - 但 `vite.config.ts` 又把这些包标记成 `external`。证据：`packages/studio/vite.config.ts:23-30`。
   - 与当前 `UpdateChecker` / `tauri-adapter` 中的动态 import 组合后，存在很高的打包运行风险。

5. `TauriStorageAdapter.listBooks 存在 IPC N+1`：成立。
   - 先 `list_books` 拿书本 ID，再对每本书单独调一次 `read_book_config` 和一次 `list_dir`。证据：`packages/studio/src/storage/tauri-adapter.ts:52-65`，尤其 `57` 和 `59`。
   - 本数一多，IPC 次数线性放大。

6. `Core 对 node:sqlite 的版本依赖未正确约束`：成立。
   - `memory-db.ts` 明写 `node:sqlite, Node 22+`。证据：`packages/core/src/state/memory-db.ts:4`，`74-75`。
   - 但 `@actalk/inkos-core/package.json` 没有 `engines` 字段。证据：`packages/core/package.json:2-3`，且无 `engines`。
   - 仓库根 `package.json` 甚至还是 `node >=20`，与实际运行需求不一致；CLI 初始化却写入 `.nvmrc` / `.node-version` 为 `22`。证据：`package.json:32-33`，`packages/cli/src/commands/init.ts:64-65`。

7. `CLI findProjectRoot() 直接返回 process.cwd()`：成立。
   - 代码是直接返回当前工作目录。证据：`packages/cli/src/utils.ts:27-29`。
   - 在子目录执行时，确实没有向上查找 `inkos.json` 的逻辑。

8. `CLI rewrite 先删后写，失败会造成数据丢失`：成立。
   - `rewrite` 先删除目标章与后续章文件，再裁剪 index，再恢复 state，最后才重新调用 `writeNextChapter`。证据：`packages/cli/src/commands/write.ts:120-173`。
   - 如果 LLM 调用失败，原章节文件不会自动恢复。
   - 仓库测试甚至已经把“重写失败后 next chapter 回到 2、state 回到旧快照”当作现有行为在验证，但没有验证原章节正文被保留。证据：`packages/cli/src/__tests__/cli-integration.test.ts:593-651`。

9. `config set llm.apiKey 与 Core 读取逻辑冲突`：成立，而且比描述更严重。
   - CLI `config set` 明确允许 `llm.apiKey` 写入 `inkos.json`。证据：`packages/cli/src/commands/config.ts:12`。
   - `config show` 甚至会把 `inkos.json` 里的 `llm.apiKey` 读出来做掩码展示。证据：`packages/cli/src/commands/config.ts:153-154`。
   - 但 Core `loadProjectConfig` 注释明确写着 “API key ONLY from env — never stored in inkos.json”，最后直接 `llm.apiKey = apiKey ?? ""`。证据：`packages/core/src/utils/config-loader.ts:104-125`。
   - 结果是：`inkos.json` 里的 `llm.apiKey` 基本是死字段，用户能写、能看到，但运行时不生效。

### 10.2 部分成立的项

10. `JWT 解码失败风险 / localStorage 适配问题`：部分成立。
   - `loginWithToken` 的确直接用 `atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))` 解 JWT payload，没有补 padding，也没有用 `TextDecoder` 处理 UTF-8。证据：`packages/studio/src/providers/inkos-context.tsx:127-151`，尤其 `143`。
   - 认证 token 也确实直接放进了 `localStorage`。证据：`packages/studio/src/providers/inkos-context.tsx:156`。
   - 所以“解析稳健性差、存储策略偏脆弱”是成立的。
   - 但“纯本地环境一定错误”这个说法要收一点：当前桌面端本身就仍然依赖 relay 鉴权，不是纯离线本地 IDE。

11. `Core 存在 SaaS / 外部服务硬编码 URL`：部分成立。
   - 硬编码 URL 确实很多：
     - GPTZero：`packages/core/src/relay/local-relay.ts:134`
     - 番茄 / 起点：`packages/core/src/agents/radar-source.ts:61`，`95`
     - Telegram：`packages/core/src/notify/telegram.ts:10`
     - Tavily：`packages/core/src/utils/web-search.ts:20-31`
   - 这些默认外部依赖在 IDE 离线或内网环境下确实会直接失效。
   - 但也不能一概说“完全无法配置”：
     - Radar 留了 `RadarSource` 扩展接口，也允许通过 `PipelineConfig.radarSources` 注入替代源。证据：`packages/core/src/agents/radar-source.ts:11-35`，`packages/core/src/agents/radar.ts:18-23`，`packages/core/src/pipeline/runner.ts:68`，`436`。
     - Telegram 不是完全写死，它是通知渠道的一种固定目标实现。
   - 更准确的说法应是：默认外部依赖写死较多，很多能力缺少统一配置入口，在桌面 IDE/受限网络环境中可移植性较差。

## 11. 优先级建议

如果后续要把它往“可用桌面 IDE/写作工作台”推进，建议顺序是：

1. 先统一“哪些文件会被 AI 读”的契约。
2. 先修桌面端 OAuth / Relay 回写 / 文风文件命名这些直接断主流程的 bug。
3. 再决定模型路由要不要继续保留“高级功能”定位，否则应默认隐藏在专家设置。
4. 最后再做 MCP / Plugins，因为这两块现在连基础接线都没完整。
