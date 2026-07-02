# Implementation Plan

## Overview

本计划实现 `lore-memory-boundary` spec：把经纬收缩为静态设定库 / Lore，把动态图谱、时间线、角色弧线、伏笔网络、矛盾地图和召回 diagnostics 归入 Narrative Memory；同时建立 `lore.*` / `memory.*` 工具语义与 Agent prompt 边界。任务严格不处理作品诊断、市场雷达、选段写作、多版本、预设市场等 non-goals。

## Tasks

- [x] 1. 盘点当前经纬与叙事记忆入口
  - 文件范围：`packages/novel-plugin/src/pages/writing-workbench/ide/IdeWorkbench.tsx`、`NarrativeMemoryPanel.tsx`、`JingweiGraphWorkspace.tsx`、`jingwei/*`、`useWorkbenchResources` 相关资源节点。
  - 确认左侧 ActivityBar、Sidebar 过滤、经纬图谱入口、伏笔看板入口、角色弧线入口、时间线入口的当前调用链。
  - 盘点结果：IDE 左侧 `jingwei` 当前只渲染 `jingweiSections` 静态条目树；`narrative-memory` 当前只渲染 `NarrativeMemoryPanel` diagnostics/pending events；旧图谱能力集中在 `JingweiGraphWorkspace`；角色弧线/伏笔/运行时状态还挂在 `工具` 节点（`createToolSectionNodes`）和旧 `WorkbenchCanvas` toolPanel 分支里；`scene.spec` 工具描述仍要求 `jingwei.read`；`jingwei.read/write` 已在 schemas、handler registry、tool registry 中注册。
  - 覆盖：R1、R2、R3、设计“新信息架构 / 组件迁移”。

- [x] 2. 收缩“经纬”Sidebar 为静态设定库入口
  - 修改 IDE 左侧“经纬”视图的节点过滤与标题文案，只展示静态设定分类、条目树、条目编辑相关入口。
  - 移除经纬 Sidebar 中图谱、时间线、角色弧线、矛盾地图、伏笔网络的主入口。
  - 保留 `JingweiEntryEditor`、分类树、条目创建/编辑/删除、静态资料导入能力。
  - 验证：打开“经纬”只看到静态设定管理能力，不出现“经纬图谱”。
  - 覆盖：R1、R3、R6。

- [x] 3. 新建 Narrative Memory 图谱工作区包装组件
  - 新建或重命名包装组件：`NarrativeMemoryGraphWorkspace`。
  - 先复用现有 `JingweiGraphWorkspace` / `JingweiGraphView` / `JingweiProgressions` / 角色弧线 / 矛盾地图能力，外层文案和入口改为 Narrative Memory 语义。
  - 禁止在本任务中重写底层数据模型；旧组件内部仍可临时读取 jingwei API，但产品文案必须是“记忆图谱/关系图/时间线/角色弧线/矛盾地图”。
  - 覆盖：R2、R3、设计“组件迁移”。

- [x] 4. 扩展 Narrative Memory Sidebar 为“记忆总览 + 记忆图谱”
  - 将现有 `NarrativeMemoryPanel` 保留为“记忆总览”。
  - 在叙事记忆侧边栏中加入图谱入口：关系图、时间线、角色弧线、伏笔网络、矛盾地图、事件链。
  - 点击各入口应在主区域或侧栏内容区打开对应 Narrative Memory 视图。
  - 验证：叙事记忆入口可以到达 diagnostics、Pending Events 与所有动态图谱入口。
  - 覆盖：R2、R3、Success Criteria 4。

- [x] 5. 迁移伏笔看板入口到 Narrative Memory / 伏笔网络
  - 将 `ForeshadowingBoard` 的主入口从经纬设定区移出，归入 Narrative Memory 的“伏笔网络”。
  - 保留从伏笔项跳转章节的能力。
  - 如 `ForeshadowingBoard` 内部仍读取经纬 entries，应在 UI 文案中标注为“伏笔记忆/伏笔网络”，不再称为经纬功能。
  - 覆盖：R2、R3。

- [x] 6. 迁移角色弧线入口到 Narrative Memory / 角色弧线
  - 将 `CharacterArcsPanel` 或同等角色弧线视图挂到 Narrative Memory。
  - 如与 `NarrativeMemoryGraphWorkspace` 的角色弧线视图重复，保留一个主入口，另一个作为内部复用组件。
  - 验证：经纬入口不再提供角色弧线主入口；叙事记忆可以打开角色弧线。
  - 覆盖：R2、R3。

- [x] 7. 移除用户可见“经纬图谱”命名
  - 全局搜索用户可见文案、tooltip、命令标题、测试标题、docs 功能地图中“经纬图谱”。
  - 改为“记忆图谱”“关系图”“时间线”“角色弧线”“伏笔网络”等符合新边界的名称。
  - 不改数据库表名或内部历史类型名，除非无需迁移且低风险。
  - 覆盖：R1、R3、R6。

- [x] 8. 新增 `lore.read` / `lore.write` 工具语义
  - 在 novel-plugin 工具 schema / registry / handler 中新增 `lore.read`、`lore.write`，复用当前 `jingwei.read` / `jingwei.write` 静态设定读写能力。
  - 工具说明必须写清：Lore 只返回作者显式维护的静态设定，不返回动态剧情记忆。
  - 保持权限、bookId/session 上下文、错误处理与现有工具一致。
  - 覆盖：R4、设计“工具协议设计 / Lore 工具”。

- [x] 9. 将 `jingwei.read` / `jingwei.write` 标记为兼容别名
  - 保留旧工具名，避免破坏旧会话和旧 prompt。
  - 工具说明中明确 `jingwei.*` 是 deprecated alias of `lore.*`，只读写静态设定。
  - 禁止旧工具说明继续宣称可提供动态叙事记忆或完整上下文。
  - 覆盖：R4、R5、R6。

- [x] 10. 为 Lore 读取增加生命周期与参与标记过滤
  - 检查 `jingwei.read` / 新 `lore.read` 当前读取路径，统一排除 archived、draft、needs-review、`participates_in_ai=0` 或等价 inactive lifecycle/status 标记。
  - 过滤规则必须作用于 brief、category、search、entry 等读取模式；若某模式需要显示归档条目，必须显式 opt-in，默认不得注入 AI。
  - 增加测试覆盖 archived/draft/needs-review/participates_in_ai=0 不进入 Agent 可读结果。
  - 覆盖：R4、R5、设计“Lore 读取过滤与写入门禁”。

- [x] 11. 为 Lore 写入增加轻量确认门禁
  - 检查 `jingwei.write` / 新 `lore.write` 写入路径，写入 canon/rules 层必须携带 reason 与 source/evidence 或等价确认语义。
  - 动态事实、章节后抽取事实、Pending NarrativeEvents 不得直接写入 Lore canon；应返回错误或引导使用 Narrative Memory event 流程。
  - 增加测试覆盖：缺 reason/source 的 canon 写入被拒绝；动态事实写 Lore 被拒绝；reference/note 类写入保持兼容但仍记录 reason。
  - 覆盖：R4、R5、设计“Lore 读取过滤与写入门禁”。

- [x] 12. 新增或暴露 `memory.read` 工具语义
  - 将现有 `buildNarrativeContext` / Narrative Memory retrieval 能力包装为 `memory.read` 工具，或先新增 schema 与 handler 入口调用现有 narrative-memory 服务。
  - 参数至少表达 purpose、chapterNumber、entities、sceneText、budgetTokens、channels。
  - 返回内容应能说明通道来源、ContextCard 摘要、warnings、token budget，而不是静态 Lore 条目列表。
  - 覆盖：R2、R4、R5。

- [x] 13. 新增或暴露 `memory.graph` 工具语义
  - 提供读取动态图谱的工具入口，支持 view：relationship、timeline、character_arc、foreshadowing、conflict、event_chain、wave。
  - 第一版允许复用现有图谱/经纬/运行时数据源，但工具说明必须是 Narrative Memory 语义。
  - 返回结构应可被 Agent 用于解释关系、时间线、伏笔状态，而不是修改 Lore。
  - 覆盖：R2、R3、R4。

- [x] 14. 新增或暴露 `memory.events` 工具语义
  - 提供 Pending NarrativeEvents 的 list / approve / reject 入口。
  - 第一版至少完成 list；若 approve/reject 已有后端能力则接入，否则在 tasks 备注中标明后续阻塞点，不伪造成功。
  - 工具说明必须明确 pending event 不等于 confirmed memory，更不能自动写入 Lore canon。
  - 覆盖：R2、R4、R5。

- [x] 15. 更新 Agent system prompt 与工具描述
  - 修改小说写作 Agent prompt、核心工具列表、工具使用说明：经纬/Lore 是静态设定，Narrative Memory 是动态记忆。
  - 写作前流程改为 `lore.read → memory.read → scene.spec / plan scene → pipeline.write → pending NarrativeEvents`。
  - 明确禁止把动态事实、诊断结果、市场材料、pending events 直接写入 Lore canon。
  - 覆盖：R5。

- [x] 16. 更新写作链路文档与功能地图
  - 更新 `CLAUDE.md` 功能地图、相关 docs 中的权威写作主链路说明。
  - 将旧 `jingwei.read` 动态上下文心智改为 `lore.read + memory.read`。
  - 更新“经纬图谱”相关文案，避免文档继续误导后续实现。
  - 覆盖：R5、R6。

- [x] 17. 补充自动化测试
  - 覆盖 IDE 侧栏：经纬入口不显示图谱类主入口，叙事记忆入口显示动态图谱入口。
  - 覆盖工具 schema / handler：`lore.*` 可用，`jingwei.*` alias 仍兼容，`memory.*` 工具说明和基础调用可用。
  - 覆盖 prompt 或工具注册快照，防止 `jingwei.read` 重新被描述成动态记忆工具。
  - 覆盖：R1-R6。

- [x] 18. 运行验证命令
  - 运行 `bun run typecheck`。
  - 运行相关单测；若无法定位最小测试集，运行受影响 package 的测试。
  - 失败时按根因修复，不得只更新快照掩盖问题。
  - 验证记录：`bun test packages/novel-plugin/src/handlers/lore-memory-boundary-handlers.test.ts packages/novel-plugin/src/handlers/tool-registry.test.ts packages/novel-plugin/src/engine/narrative-memory/reducer.test.ts packages/novel-plugin/src/pages/writing-workbench/NarrativeMemoryPanel.test.tsx` → 15 pass / 0 fail；`bun run typecheck` → core、novel-plugin、studio 通过。
  - 覆盖：Success Criteria 6。

- [x] 19. Browser 验证 IDE UI
  - 启动应用，打开写作工作台。
  - 截图验证：左侧“经纬”只展示静态设定树与编辑入口。
  - 截图验证：左侧“叙事记忆”能打开记忆总览、关系图、时间线、角色弧线、伏笔网络、矛盾地图。
  - 截图验证：主 UI 不再出现“经纬图谱”命名。
  - 验证记录：Browser 打开 `http://localhost:4567/next/books/lore-memory-验证书`，切换“叙事记忆 → 关系图”，截图保存为 `artifacts/lore-memory-boundary-graph-verified.png`。
  - 覆盖：R6、Success Criteria。

- [x] 20. 完成后记录迁移决策与已知后续项
  - 用 Engram 记录本次经纬/Lore 与 Narrative Memory 实际落地边界。
  - 若发现底层数据源仍临时依赖 jingwei API，记录为后续数据迁移项，不在本 spec 中扩 scope。
  - 覆盖：设计“迁移注意事项”。
