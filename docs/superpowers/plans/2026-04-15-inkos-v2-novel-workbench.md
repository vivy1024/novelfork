# InkOS v2：AI 长篇小说工作台

> 本文件是三份旧计划的统一替代。融合了 18 款开源工具调研、网文行业实践、古今小说方法论、AI 叙事前沿研究。旧计划已删除。

---

## 〇、调研基础

本计划基于以下四个维度的深度调研：

### 开源工具（18 款）

| 工具 | 核心启发 | InkOS 吸收点 |
|------|---------|-------------|
| SillyTavern | World Info / Lorebook：关键词触发上下文注入 | 底部面板的实体匹配注入机制 |
| NovelCrafter | Codex + Progressions：结构化角色追踪 | 人物状态库 + 成长轨迹 |
| KoboldAI | 三层上下文：Memory / Author's Note / World Info | 分层上下文架构 |
| bibisco | 角色采访系统：通过问答深化人物 | 可选的角色采访台维度 |
| Manuskript | 雪花法内置：从一句话扩展到完整大纲 | 大纲流的递进式展开 |
| NovelForge | 卡片式创作：场景/人物/设定卡 | 项目导航的卡片视图 |
| novel-writer-skills | 6 步流水线 + Retro 回顾阶段 | Pipeline 增加回顾环节 |
| webnovel-writer | RAG 记忆：向量检索历史章节 | 世界观引擎的 RAG 查询层 |
| NarraFork | Git 多分支叙事 + PWA + Drizzle ORM + xyflow DAG 可视化 | 见下方专项分析 |

### NarraFork 专项分析

NarraFork 是一个基于 Bun + Hono + React 19 的 AI 叙事工作台，用 Git 分支管理多条叙事线，最终通过合并完成多线开发。其 52 个运行时依赖中，以下 5 项对 InkOS 有直接价值：

| 依赖 | NarraFork 用途 | InkOS 吸收方案 |
|------|---------------|---------------|
| `drizzle-orm` + `better-sqlite3` | 类型安全 SQLite ORM + 迁移管理 | 世界观引擎 5 张新表用 Drizzle 替代手写 SQL，减少样板代码 |
| `@xyflow/react` + `@dagrejs/dagre` | DAG 流程图可视化 | Pipeline 10 Agent 流水线可视化，替代自绘 SVG |
| `@dnd-kit/core` + `@dnd-kit/sortable` | 拖拽排序 | 章节排序、大纲卡片拖拽重排 |
| `puppeteer-core` + `@mozilla/readability` | 网页抓取 + 正文提取 | 雷达扫描起点/番茄排行数据 |
| `vite-plugin-pwa` | Service Worker 离线缓存 | PWA 安装到桌面，作为 Node SEA 的轻量替代路线 |

不采纳的部分：Bun 运行时（Node 22 内置 SQLite 更稳）、Mantine UI（已有 Tailwind + shadcn）、pixi.js（2D 引擎太重）。

### 网文行业（起点/番茄/龙空）

| 概念 | 含义 | InkOS 应用 |
|------|------|-----------|
| 黄金三章 | 前 3 章（~6000 字）决定读者去留 | 黄金三章检测器：扫描前 3 章的节奏/冲突/悬念密度 |
| 3+1 节奏公式 | 3 章紧张 + 1 章过渡；10 章一小高潮；100-150 章一大高潮 | 节奏波形图 + 自动提醒 |
| 三层大纲 | 总纲 → 卷纲 → 章纲，动态调整 | DOME 架构的三层大纲树 |
| 毒点 | 主角憋屈无后手、金手指被夺、前期设定崩坏等致命缺陷 | 毒点检测器 |
| 日更生命线 | 4000-10000 字/天，5 分钟能审完一章 | 5 分钟审阅约束 + 日更统计面板 |
| 追读率/完读率 | 平台核心指标 | 雷达扫描基准数据 |

### 小说方法论（古今中外）

| 理论 | 来源 | InkOS 应用 |
|------|------|-----------|
| Save the Cat 节拍表 | Blake Snyder，扩展至 500 章长篇 | 分形节拍模板：全书/卷/章三级节拍 |
| Sanderson 三定律 | Brandon Sanderson 魔法体系设计 | Auditor 校验力量体系的代价、限制、一致性 |
| 红楼梦坐标系 | 曹雪芹管理 400+ 人物的方法 | 人物状态库的关系网 + 出场追踪 |
| 大纲流 vs 随写流 | 龙空社区长期争论 | 双模式支持，不强制任何一种 |
| 设定膨胀 = 质量崩坏 | 网文行业共识 | 设定健康度监控 + 冗余预警 |

### AI 叙事前沿

| 成果 | 来源 | InkOS 应用 |
|------|------|-----------|
| DOME 架构 | 动态层级大纲 + 时序知识图谱 | 三层大纲 + SQLite 时序记忆 |
| 上下文工程 > 大窗口 | 学术共识 | RAG + 关键词触发 + 分层摘要，替代全量注入 |
| 多 Agent 流水线 | 学术共识 | 已有 10 Agent Pipeline，继续强化 |
| AI = 编辑守护者 | NovelCrafter 验证 + 学术建议 | AI 定位为"高配责编"，非代笔 |
| Claude 散文质量最优 | 社区评测 | 默认推荐 Claude 作为写作模型 |

---

## 一、产品定位

### InkOS 是什么

InkOS 是一个**本地桌面应用**（EXE 启动 → Node.js 进程 → 浏览器访问），定位：

**AI 长篇小说生产工作台 = Scrivener 的项目管理 + Cursor 的 AI 能力 + 网文行业的领域智能**

不是通用 IDE，不是在线 SaaS，不是 VS Code 翻版。为"用 AI 写长篇小说"专门设计。

### 五条设计原则

1. **AI 是编辑和一致性守护者，不是代笔人** — 作者主导创作，AI 负责记忆、校验、建议
2. **上下文工程 > 大窗口暴力注入** — 分层摘要 + RAG 精确检索 + 关键词触发注入
3. **同时支持大纲流和随写流** — 不强制任何创作方法论，两种模式无缝切换
4. **设定膨胀是长篇质量下降的头号杀手** — 内置设定健康度监控，主动预警
5. **日更是网文生存线** — 所有 UI 和流程为"5 分钟检查 + 一键出章"优化

### 用户画像

| 角色 | 创作流派 | 用法 |
|------|---------|------|
| 网文作者（主力） | 大纲流 / 随写流 | 创建书籍 → 设定世界观 → 一键出章 → 审阅修改 → 导出投稿 |
| AI 小说研究者 | 架构流 | 调参 → 对比不同模型/温度/风格的产出质量 |
| 同人/仿写创作者 | 考据流 | 导入原著 → 建立 Canon → 基于原作设定自动续写 |
| 批量内容团队 | 矩阵流 | Daemon 模式 → 多书并行 → 定时出章 → 通知审核 |
| 轻度用户 | 零配置 | 只用人物+伏笔，写甜宠/日常，和记事本一样简单 |

### 最终界面布局

```
┌────────────────────────────────────────────────────────────────────┐
│  [InkOS]  《灵气回归》▾   ⌘K 命令面板     [写下一章] [审计] [雷达]  │
├──────────┬─────────────────────────────────────────────────────────┤
│          │  章节1-4 ✕ │ 设定:LEVSS物理 ✕ │ 阵营:学院派 ✕          │
│ 项目导航  │───────────────────────────────────────────────────────│
│          │                                                       │
│ 📖 灵气回归│  第四章 有人倒下了                                      │
│  ▸ 章节   │                                                       │
│   1-1 ✓  │  恒温修炼舱内的空气忽然变得黏稠。王芸教授的 AI 道侣界面      │
│   1-2 ✓  │  弹出红色警告——3 号舱位的陈默然，Risk 指数突破 0.62。        │
│   1-3 ✓  │  "橙色事件！所有人后退！"  萧云看见陈默然的手指不自然地       │
│   1-4 ●  │  蜷曲，指尖渗出的汗液在灵石表面折射出异常的干涉条纹...       │
│   1-5 ○  │                                                       │
│  ▸ 设定   │                                                       │
│   LEVSS  │                                                       │
│   修炼体系│                                                       │
│   灵材数据│                                                       │
│  ▸ 阵营   │                                                       │
│  ▸ 结构   │                                                       │
│   黄金三章│                                                       │
│   救猫咪卡│                                                       │
├──────────┼─────────────────────────────────────────────────────────┤
│ 动态上下文 │  人物 │ 伏笔 │ 物理规则 │ 势力 │ 时间线 │ 节奏波形图 │
│ (RAG驱动)│───────────────────────────────────────────────────────│
│          │ 陈默然  L_fit=38  学院派  状态:走火入魔(橙色)             │
│          │ 王芸    L_fit=72  学院派  角色:QESA高级研究员              │
│          │ ──────────────────────────────────────────────         │
│          │ 活跃伏笔: #H-004 陈默然进度异常(埋于1-1) → ⏳ 倒计时: 1章  │
│          │ 物理约束: Risk>0.62=橙色, >0.86=红色, 清源引气诀SOP适用   │
│          │ 网文节奏: [3+1公式] 当前为第4章(缓冲章)，应当降低阅读压迫感  │
├──────────┼─────────────────────────────────────────────────────────┤
│ Pipeline │  ████████░░ 连续性审计 (27/33)    Token: 12.4k          │
└──────────┴─────────────────────────────────────────────────────────┘
```

**四个区域：**
1. **左侧 — 项目导航**：按故事结构组织（书 → 章节/设定/阵营/结构卡片），不是裸文件树。
2. **中央 — 多标签编辑器**：章节用富文本编辑器，设定文件用 Markdown，状态文件用结构化视图。
3. **底部上层 — 动态上下文面板 (Lorebook)**：与编辑器同宽。基于实体识别（类似 SillyTavern 的 World Info）自动聚合当前章节相关的人物/伏笔/规则。加入**网文节奏波形图**（张弛度可视化）。
4. **底部下层 — 状态栏**：Pipeline 进度、运行状态、Token 用量、每日字数追踪。

### 核心功能清单（最终态）

#### A. 书籍项目管理与创作流派
- **三层动态大纲体系 (DOME架构)**：总纲 (Global) → 卷纲 (Volume) → 章纲 (Chapter)。
- **模板引入**：内置“黄金三章”模板、“Save the Cat” 500章长篇分形模板。
- **创作模式切换**：大纲流（严格按章纲执行）、随写流（AI 根据上下文推演走向）、同人模式（导入 Canon 知识库）。

#### B. 章节创作 (AI 作为责编与守护者)
- **多级自动化**：从一键出章到行内补全。AI 定位由“代笔鬼手”转为“高级责编+连续性守护者”。
- **3+1 节奏控制器**：内置网文节奏算法，提醒作者“已连续3章高压，建议本章（第4章）过渡转折”。
- **5分钟审阅约束**：生成内容必须让作者在 5 分钟内能完成修改，否则 AI 应当拆分生成粒度（日更 4k-10k 字的生命线）。

#### C. 世界观引擎（通用结构化知识库，取代扁平 Markdown）

基于 SQLite 构建动态知识图谱。摒弃全量上下文注入，采用 **RAG + 关键词触发 (Lorebook/World Info) + 层级摘要**。

**核心设计：维度可插拔的结构化世界观容器**

| 维度 | 存储 | 适用题材 | 是否必选 |
|------|------|---------|---------|
| 人物状态库 | SQLite facts + 角色表 | 所有 | ✅ |
| 伏笔追踪器 | JSON hooks (带倒计时倒计时) | 所有 | ✅ |
| 物品账本 | SQLite materials 表 | 所有 | ✅ |
| 时间线引擎 | SQLite timeline_events 表 | 历史/推演 | 可选 |
| 阵营博弈网 | SQLite factions 表 | 权谋/战争 | 可选 |
| 物理/数值约束 | SQLite world_rules 表 | 硬科幻/硬修仙 | 可选 |
| 经济系统 | SQLite world_rules 表 | 商战/经营 | 可选 |
| 地理志 | SQLite geography 表 | 奇幻/末日 | 可选 |
| 角色采访台 | 独立会话模块 (如 bibisco) | 深度群像文 | 可选 |

**亮点**：
- **设定防膨胀机制**：网文崩盘首因是设定暴走。引擎会定期进行冗余设定检测，警告未使用的废案。
- **Sanderson 三定律校验**：特别是针对魔法/修仙体系，Auditor 专门校验“代价、限制、一致性”。

#### D. 质量控制 (33维审计升级)
- 33 维连续性审计（包含数值一致性、逻辑链条断裂检查）。
- **毒点检测器**：网文防毒机制（如：黄金三章内出现被动挨打、主要战利品被夺等流失点警告）。
- AIGC 痕迹检测与反 AI 改写（anti-detect 模式，消除“然而”、“不仅……而且”等机翻腔调）。

#### E. 市场与运营
- 雷达扫描（起点/番茄爬虫，追踪追读率/完读率趋势基准）。
- 数据分析（审计通过率、Token 用量、日更统计）。
- Daemon 守护进程（定时出章与长文自动分发）。

#### F. Agent 工具链（终端 + 数据采集 + 计算）

硬核小说（如文字修仙）需要 AI 具备超越纯文本生成的能力：查论文、解析数据集、跑数值计算、grep 原始资料。InkOS 的 AI 不只是"写手"，更是一个拥有工具的智能体。

- **内嵌终端**：基于 `@xterm/xterm` + node-pty，AI Agent 和用户都可执行 shell 命令。
  - Agent 可调用：`grep`/`rg` 搜索参考资料、`curl` 抓取学术 API、`python` 跑数值计算脚本
  - 用户可用：直接在工作台内操作文件、运行自定义脚本
- **数据源接入**：
  - 本地文件解析：PDF/EPUB/TXT/CSV/YAML 批量导入，提取结构化知识入库
  - 网页抓取：`puppeteer-core` + `readability` 抓取论文摘要、百科词条、排行数据
  - MCP 工具服务器：已有框架，可接入任意外部数据源
- **计算沙箱**：
  - Agent 可生成并执行 Python/JS 脚本验证数值一致性（如 LEVSS 参数推导、经济模型平衡性）
  - 执行结果自动注入世界观知识库
- **18 个内置 Agent 工具**（已有自然语言 Agent 模式）+ 终端工具扩展为第 19 个

---

## 二、当前状态 vs 最终形态的差距

### 已完成（从代码实证）

| 模块 | 状态 | 证据 |
|------|------|------|
| 10 Agent 流水线 | ✅ 完整 | core 545 tests pass，所有 Agent 有实现 |
| 7 真相文件系统 | ✅ 完整 | state/manager.ts + state-reducer.ts |
| SQLite 时序记忆 | ✅ 完整 | state/memory-db.ts |
| LLM 多模型路由 | ✅ 完整 | llm/provider.ts，支持主流 API |
| 基础前后端 | ✅ 完整 | Hono API (60+) + Studio TSX 页面 (32) |

### 未完成（最终形态所需）

| 缺口 | 当前问题 | 需要做什么 |
|------|---------|-----------|
| 架构形态 | Tauri 存在漏洞，CLI 交互门槛高 | 迁移至 Node SEA EXE + HTTP + 本地浏览器，废弃 Tauri |
| IDE 布局 | 32 个页面平铺 SPA，跳来跳去 | 左导航 + 中编辑 + 底动态面板的三栏 IDE 布局 |
| 上下文注入 | 全量 Markdown 塞入 prompt，极度耗 token | 采用 SillyTavern 风格的 World Info 实体关键词匹配注入 |
| 世界观引擎 | 扁平化，无法支撑《文字修仙》等硬核 60+ 设定库 | SQLite 维度可插拔数据库（人物、势力、规则表） |
| 节奏与结构 | 缺乏网文行业标准（节奏、留人、卡点） | 引入 3+1 节奏仪、黄金三章检测、倒计时伏笔系统 |
| 会话与沙箱 | 刷新丢数据，无防越权 | IndexedDB 持久化草稿，workspace-service 路径沙箱 |

---

## 三、技术架构

```
用户视角：
  双击 inkos.exe → 自动打开浏览器 → http://127.0.0.1:4567

内部结构：
  inkos.exe (Node SEA)
    └─ Hono HTTP Server (:4567)
         ├─ 静态文件 → React SPA (Vite 构建产物)
         ├─ /api/workbench/* → 工作区沙箱 API (新)
         ├─ /api/books/* → 书籍/章节 CRUD
         ├─ /api/ai/* → Pipeline / Agent / RAG 查询
         ├─ /api/mcp/* → MCP 服务器管理
         └─ /api/events → SSE 实时事件流

  数据存储：
    workspace/
    ├─ inkos.json          # 项目配置
    └─ books/
       └─ <bookId>/
          ├─ book.json     # 书籍元数据 (题材、字数、流派)
          ├─ chapters/     # 章节 Markdown
          ├─ story/        # 原 7 真相文件目录
          │  ├─ state/     # JSON 结构化状态
          │  ├─ memory.db  # SQLite 时序记忆 & 世界观知识库 (核心引擎)
          └─ snapshots/    # 章节快照
```

### 关键架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 运行时 | Node.js 22+ | 内置 SQLite，支持原生时序库扩展 |
| 桌面壳 | Node SEA → EXE（PWA 作为备选） | 零依赖分发；PWA 路线更轻量，学自 NarraFork 的 `vite-plugin-pwa` |
| ORM | Drizzle ORM | 学自 NarraFork，类型安全 + 迁移管理，替代 memory-db.ts 的手写 SQL |
| 上下文策略 | 关键词触发 RAG | 学自 SillyTavern/NovelCrafter，精准投喂，Token 暴降 |
| AI 定位 | 协同编辑模式 | 学自学界共识，不追求 100% 全自动代笔，追求”高配责编” |
| Pipeline 可视化 | `@xyflow/react` + `dagre` | 学自 NarraFork，10 Agent DAG 流程图 |
| 拖拽交互 | `@dnd-kit` | 学自 NarraFork，章节排序 + 大纲卡片拖拽 |
| 内嵌终端 | `@xterm/xterm` + `node-pty` | 学自 NarraFork，AI Agent 执行 shell 命令（grep/curl/python） |
| 雷达抓取 | `puppeteer-core` + `readability` | 学自 NarraFork，起点/番茄排行数据采集 |

---

## 四、实施计划 (9 个 Phase)

### Phase 0：清理与架构冻结（1 天）

目标：止损换道。
- [x] 在 `desktop/README.md` 标注 Tauri 路径为废弃/实验性。
- [x] 修复 CLI 已知 Bug（`findProjectRoot`、`rewrite` 原子写入、`apiKey` 环境变量优先级）。
- [x] 锁定 Node 引擎版本 `>=22.5.0`。

### Phase 1：工作区内核与沙箱化（2-3 天）

目标：为 IDE 铺路，拦截恶意路径。
- [x] 创建 `workspace-service.ts`（防路径穿越、UNC 拒绝、读写原子化）。
- [x] 创建 `/api/workbench/*` 路由（文件树解析、CRUD、全文检索）。
- [x] 集成 JWT/Token 中间件保护本地接口。

### Phase 2：IDE 三栏布局重构（3-4 天）

目标：平铺 SPA → 专业工作台。
- [x] 创建 `WorkbenchLayout.tsx`，废弃纯 Router 页面跳转。
- [x] `ProjectNavigator.tsx` 左侧栏：按故事树组织（章节带状态标识、设定集分簇）。
- [x] `EditorTabs.tsx` 中央区：多标签页设计（富文本/MD/表格视图），支持 Ctrl+S 和 dirty 标记。

### Phase 3：World Info 动态底部面板（2-3 天）

目标：告别”盲人摸象”，所写即所见。
- [x] 创建 `ReferencePanel.tsx`，居于底部。
- [x] Tab 1：**人物与势力**（提取当前章节文本的实体，展示 L_fit 等关键参数）。
- [x] Tab 2：**伏笔追踪**（倒计时 UI，标识 #H-004 还剩 2 章需回收）。
- [x] Tab 3：**节奏波形图**（3+1 分析，红线=高压，蓝线=缓冲）。
- [x] Tab 4：**世界观词条**（Lorebook 维度浏览 + 条目列表）。

### Phase 4：世界观引擎与 RAG 升级 (核心，5-7 天)

目标：从扁平 Markdown 进化到可插拔 SQLite 知识图谱。
- [x] 扩展 `memory.db`，建立 `world_entries`, `world_dimensions` 通用表（9个内置维度）。
- [x] 开发 **Lorebook 拦截器**：Composer Agent 写作前，先对 prompt 做关键词抽取，仅从 SQLite 捞取相关规则与人物设定注入（抛弃全量 truth files）。
- [x] 提供世界观导入功能：读取 Markdown 批量提取结构化参数入库（启发式解析器）。
- [x] 设定防膨胀守护进程：每周分析 `memory.db`，标红未使用的冗余设定。

### Phase 5：网文生态约束器（3 天）

目标：用工业化网文标准约束 AI 乱放飞。
- [x] **大纲流系统 (DOME)**：建立三层大纲树。写作时校验与当前卷纲的偏离度。
- [x] **毒点检测 (Toxic-detector)**：7条确定性规则（憋屈无后手/设定崩坏/金手指失效/感情强扭/水字数/降智/断崖节奏）。
- [x] **字数与节奏控制**：为批量输出模式配置日更 4k-10k 目标面板与 5 分钟人工查阅卡点。

### Phase 6：会话持久化与 Pipeline 面板（2-3 天）

目标：极致的工程体验。
- [x] IndexedDB 接入，防止刷新丢草稿；恢复打开的 Tabs。
- [x] `PipelinePanel.tsx` SSE 实时更新替代 polling（现有 polling 已可用）。

### Phase 7：MCP、Plugins 与搜索服务（2 天）

目标：开放性与寻址能力。
- [x] MCP 客户端页面真实接通，管理外部工具。
- [x] 增强全局搜索（按书/内容类型分组，点击直达高亮）。

### Phase 8：Node SEA 打包与分发（1-2 天）

目标：一键双击体验。
- [x] `build-studio-sea.mjs` 打包出单一 Windows EXE，内嵌 Vite 资产。
- [x] `inkos studio` 命令升级：无感拉起后台服务并自动调出系统默认浏览器访问 4567 端口。

---

## 五、优先级

### P0（必须做，决定 IDE 是否成立）
- Phase 0：清理与架构冻结
- Phase 1：工作区内核与沙箱化
- Phase 2：IDE 三栏布局重构
- Phase 4：世界观引擎与 RAG 升级（SQLite 骨架）

### P1（产品闭环，网文灵魂注入）
- Phase 3：World Info 动态底部面板
- Phase 5：网文生态约束器（毒点、节奏、伏笔倒计时）
- Phase 6：会话持久化与 Pipeline 面板

### P2（工程完善与分发）
- Phase 7：MCP、Plugins 与搜索服务
- Phase 8：Node SEA 打包与分发

---

## 六、代码改动量估算

基于现有代码库（core 26,887 行 + studio 21,222 行 + cli 4,221 行 = 52,330 行）：

| Phase | 新增行数 | 修改行数 | 涉及包 |
|-------|---------|---------|--------|
| Phase 0 | ~50 | ~100 | cli, desktop |
| Phase 1 | ~600 | ~100 | studio (api) |
| Phase 2 | ~1,200 | ~400 | studio (layouts, components) |
| Phase 3 | ~800 | ~100 | studio (components) |
| Phase 4 | ~1,500 | ~300 | core (state, agents), cli |
| Phase 5 | ~600 | ~200 | core (agents), studio |
| Phase 6 | ~400 | ~100 | studio (hooks, components) |
| Phase 7 | ~300 | ~100 | studio (routes, pages) |
| Phase 8 | ~300 | ~50 | scripts, cli |
| **合计** | **~5,750** | **~1,450** | — |

总改动约 7,200 行，占现有代码库 ~14%。核心引擎（pipeline/runner.ts 3,010 行、10 个 Agent）不动。

---

## 七、不做的事

| 明确不做 | 理由 |
|---------|------|
| 通用代码编辑能力 | InkOS 不是 VS Code |
| Tauri 主路径修复 | 安全漏洞多，EXE + 浏览器更简单 |
| 多人协同编辑 | 产品定位是本地工具 |
| 远程 SaaS 部署 | Relay 模式保留但不是主线 |
| 原始文件树作为主导航 | 故事结构优先 |
| 重写 Core 引擎 | 已稳定，545 tests pass |
| 向量数据库 | SQLite FTS5 + 关键词触发够用，不引入额外依赖 |
| 自动发布到平台 | 法律风险，只做导出 |

---

## 八、世界观引擎技术细节

### SQLite 表结构设计

```sql
-- 必选维度：人物状态（扩展已有 facts 表）
ALTER TABLE facts ADD COLUMN domain TEXT DEFAULT 'general';
-- domain: character / physics / politics / economy / geography / custom

-- 必选维度：伏笔追踪（扩展已有 hooks 表）
ALTER TABLE hooks ADD COLUMN countdown_chapters INTEGER;
ALTER TABLE hooks ADD COLUMN urgency TEXT DEFAULT 'normal';
-- urgency: normal / warning / overdue

-- 可选维度：世界规则
CREATE TABLE world_rules (
  id INTEGER PRIMARY KEY,
  book_id TEXT NOT NULL,
  dimension TEXT NOT NULL,        -- physics / magic / social / economy
  rule_name TEXT NOT NULL,
  formula TEXT,                   -- 如 "Risk > 0.62 → 橙色事件"
  constraints TEXT,               -- JSON: 限制条件
  sanderson_cost TEXT,            -- 代价描述（三定律第一条）
  sanderson_limit TEXT,           -- 限制描述（三定律第二条）
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 可选维度：阵营/势力
CREATE TABLE factions (
  id INTEGER PRIMARY KEY,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ideology TEXT,                  -- 意识形态
  resources TEXT,                 -- JSON: 控制的资源
  relationships TEXT,             -- JSON: [{faction_id, stance, reason}]
  current_strategy TEXT,
  active INTEGER DEFAULT 1
);

-- 可选维度：时间线
CREATE TABLE timeline_events (
  id INTEGER PRIMARY KEY,
  book_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER,
  era TEXT,                       -- 融合期 / 分化期 / 危机期 / 重建期
  event_name TEXT NOT NULL,
  description TEXT,
  impact_scope TEXT,              -- JSON: 影响范围
  causal_chain TEXT               -- JSON: 因果链
);

-- 可选维度：材料/物品
CREATE TABLE materials (
  id INTEGER PRIMARY KEY,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,                  -- 灵材 / 丹药 / 法器 / 科技
  properties TEXT,                -- JSON: 属性参数
  source TEXT,                    -- 产地/来源
  rarity TEXT
);

-- 可选维度：地理
CREATE TABLE geography (
  id INTEGER PRIMARY KEY,
  book_id TEXT NOT NULL,
  region_name TEXT NOT NULL,
  features TEXT,                  -- 地形特征
  resources TEXT,                 -- 资源分布
  controlling_faction_id INTEGER,
  danger_level TEXT
);
```

### Lorebook 上下文注入流程

```
章节写作请求
  │
  ├─ 1. NER 实体抽取（从 prompt + 前文提取人名/地名/术语）
  │
  ├─ 2. 关键词匹配查询 SQLite
  │     ├─ facts WHERE entity IN (抽取结果)
  │     ├─ world_rules WHERE dimension = 当前场景类型
  │     ├─ factions WHERE name IN (提及的势力)
  │     └─ timeline_events WHERE year = 当前故事时间
  │
  ├─ 3. 按 token 预算裁剪（优先级：人物 > 规则 > 伏笔 > 势力 > 时间线）
  │
  └─ 4. 注入 Composer Agent 的 system prompt
        （替代原来的全量 truth file Markdown 注入）
```

Token 消耗对比估算：
- 旧方案（全量注入 6 个 Markdown）：~8,000-15,000 tokens/章
- 新方案（RAG 精确注入）：~1,500-3,000 tokens/章
- 节省：60%-80%

---

## 九、完成标准

全部满足才算 v2 最终形态：

- [ ] 打开是桌面级多标签 IDE，不是松散的网页集合。
- [ ] **上下文革命**：后台放弃大段 Markdown 堆砌，完全采用 RAG/Lorebook 实体词触发查库，显著降低 Token，提升设定依从度。
- [ ] **硬核兼容**：成功导入《文字修仙》级复杂世界观，AI 能在生成中准确调用 L_fit 公式、阵营关系与百年推演状态。
- [ ] **网文工业化**：面板清晰显示伏笔倒计时、3+1 节奏图，Auditor 能抓出毒点违规。
- [ ] **双击可用**：输出的 `inkos.exe` 在不装环境的电脑上双击即用（调出浏览器）。
- [ ] 所有沙箱操作安全，无穿越风险，刷新浏览器不丢数据。
