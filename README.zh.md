<p align="center">
  <img src="assets/logo.svg" width="120" height="120" alt="InkOS Logo">
  <img src="assets/inkos-text.svg" width="240" height="65" alt="InkOS">
</p>

<h1 align="center">自主小说写作 AI Agent</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@actalk/inkos"><img src="https://img.shields.io/npm/v/@actalk/inkos.svg?color=cb3837&logo=npm" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript"></a>
</p>

<p align="center">
  <a href="README.en.md">English</a> | 中文 | <a href="README.ja.md">日本語</a>
</p>

---

开源 AI Agent 自主写小说——写作、审核、修改全流程自动化，人工审核门控确保你始终掌控全局。支持升级流、LitRPG、异世界、修仙、科幻等多种题材，内置续写、番外、同人、仿写等创作模式。

**NovelFork Studio 正式发布！** — 运行 `inkos studio` 启动本地 Web 工作台。书籍管理、章节审阅编辑、实时写作进度、市场雷达、数据分析、AI 检测、文风分析、题材管理、守护进程控制、真相文件编辑——CLI 能做的，Studio 全部可视化。

**原生英文小说写作已支持！** — 内置 10 个英文题材配置，包含专属节奏规则、疲劳词表、审核维度。设置 `--lang en` 即可开始。

**桌面端 + Web 端 + OAuth2 集成！** — 本 fork 新增：
- **桌面端**：Tauri 编译为 Windows .exe，下载即用
- **Web 端去门控**：直接访问 `inkos.vivy1024.cc`，无需登录即可体验
- **OAuth2 集成**：一键连接 [Sub2API](https://egost1024.top) 获取 API Key，无需手动配置

## 快速开始

### 安装

**方式一：桌面端（推荐）**

下载 Windows 桌面版：
- [Inkos Desktop v0.1.0](https://github.com/vivy1024/inkos/releases) - 下载 `.exe` 或 `.msi` 安装包
- 双击运行，内置 OAuth2 一键连接 Sub2API

**方式二：CLI 全局安装**

```bash
npm i -g @actalk/inkos
```

**方式三：Web 端体验**

访问 [inkos.vivy1024.cc](https://inkos.vivy1024.cc) 在线使用（无需安装）

### 通过 OpenClaw 使用 🦞

InkOS 已发布为 [OpenClaw](https://clawhub.ai/narcooo/inkos) Skill，可被任何兼容 Agent（Claude Code、OpenClaw 等）直接调用：

```bash
clawhub install inkos          # 从 ClawHub 安装
```

通过 npm 安装或克隆本项目时，`skills/SKILL.md` 已包含在内，🦞 可直接读取——无需额外从 ClawHub 安装。

安装后，Claw 可通过 `exec` 调用 InkOS 的原子命令和控制面操作（`plan chapter`/`compose chapter`/`draft`/`audit`/`revise`/`write next`），`--json` 输出结构化数据供决策。推荐流程：先更新 `author_intent.md` 或 `current_focus.md`，再 `plan` / `compose`，最后决定是否 `draft` 或完整 `write next`。也可以在 [ClawHub](https://clawhub.ai) 搜索 `inkos` 在线查看。

### 配置

**方式一：OAuth2 一键连接（推荐）**

桌面端和 Web 端支持 OAuth2 授权流程，一键从 [Sub2API](https://egost1024.top) 获取 API Key：

1. 点击"连接 Sub2API"按钮
2. 跳转到 Sub2API 授权页面（需要先注册账号）
3. 授权后自动返回，API Key 已配置完成

**方式二：全局配置（CLI 用户）**

```bash
inkos config set-global \
  --lang zh \
  --provider <openai|anthropic|custom> \
  --base-url <API 地址> \
  --api-key <你的 API Key> \
  --model <模型名>

# provider: openai / anthropic / custom（兼容 OpenAI 格式的中转站选 custom）
# base-url: 你的 API 提供商地址
# api-key: 你的 API Key
# model: 你的模型名称
```

`--lang zh` 设置中文为默认写作语言。配置保存在 `~/.inkos/.env`，所有项目共享。

**方式三：项目级 `.env`**

```bash
inkos init my-novel     # 初始化项目
# 编辑 my-novel/.env
```

```bash
# 必填
INKOS_LLM_PROVIDER=                               # openai / anthropic / custom（兼容 OpenAI 接口的都选 custom）
INKOS_LLM_BASE_URL=                               # API 地址
INKOS_LLM_API_KEY=                                 # API Key
INKOS_LLM_MODEL=                                   # 模型名

# 语言（默认使用全局设置或题材默认值）
# INKOS_DEFAULT_LANGUAGE=zh                        # en 或 zh

# 可选
# INKOS_LLM_TEMPERATURE=0.7                       # 温度
# INKOS_LLM_MAX_TOKENS=8192                        # 最大输出 token
# INKOS_LLM_THINKING_BUDGET=0                      # Anthropic 扩展思考预算
```

项目 `.env` 会覆盖全局配置。不需要覆盖时可以不写。

**方式四：多模型路由（可选）**

给不同 Agent 分配不同模型，按需平衡质量与成本：

```bash
# 给不同 Agent 分配不同模型/提供商
inkos config set-model writer <model> --provider <provider> --base-url <url> --api-key-env <ENV_VAR>
inkos config set-model auditor <model> --provider <provider>
inkos config show-models        # 查看当前路由配置
```

未显式配置的 Agent 会回退到全局模型。

未显式配置的 Agent 会回退到全局模型。

### v1 更新

**NovelFork Studio + 写作流程重构**

- **NovelFork Studio** (v1.0)：`inkos studio` 启动本地 Web 工作台（Vite + React + Hono）。书籍管理、章节审阅编辑、实时写作进度、市场雷达、数据分析、AI 检测、文风分析、题材管理、守护进程控制、真相文件编辑——CLI 能做的，Studio 全部可视化
- **地基审查员** (v1.1)：书籍创建时独立审查 Agent，5 维度评分（正典 DNA、新叙事空间、核心冲突、开篇节奏、节奏可行性），低于 80 分自动拒绝
- **钩子种子摘录** (v1.1)：解决钩子时，Composer 提取原始种子场景摘录注入 Writer 上下文，确保回收场景基于具体叙事
- **审阅拒绝回滚** (v1.1)：`inkos review reject` 回滚状态到章节前快照，丢弃下游章节和记忆索引
- **状态验证恢复** (v1.1)：settler 状态验证失败时自动重试，仍失败则优雅降级，`inkos write repair-state` 手动恢复
- **双语导入** (v1.1.1)：`import chapters` 和 `fanfic init` 支持双语提示，自动检测续写 vs 系列模式
- **章节编号锚定** (v1.1)：章节进度锚定到连续持久文件——叙事编号不再污染进度
- 审核漂移隔离、标题折叠修复、钩子预算提示、章节结尾轨迹、情绪/节奏单调检测
- 双语 AI 痕迹词表和敏感词表、自定义 HTTP 头（`INKOS_LLM_HEADERS`）

### 写第一本书

中文是中文题材的默认语言。选择题材即可开始：

```bash
inkos book create --title "最后的探索者" --genre 玄幻     # 玄幻小说（默认中文）
inkos write next my-book          # 写下一章（完整流程：草稿 → 审核 → 修改）
inkos status                      # 查看状态
inkos review list my-book         # 审阅草稿
inkos review approve-all my-book  # 批量通过
inkos export my-book --format epub  # 导出 EPUB（手机/Kindle 阅读）
```

语言按题材默认设置。显式覆盖用 `--lang en` 或 `--lang zh`。使用 `inkos genre list` 查看所有可用题材及其默认语言。

<p align="center">
  <img src="assets/screenshot-terminal.png" width="700" alt="终端截图">
</p>

---

## 题材配置

InkOS 内置 10 个英文原生题材配置和 5 个中文网文题材。每个题材包含专属规则、节奏、疲劳词检测、审核维度：

| 题材 | 核心机制 |
|------|---------|
| **LitRPG** | 数值系统、力量升级、属性进阶 |
| **升级流** | 力量升级、无需数值系统 |
| **异世界** | 时代考据、世界对比、文化冲突 |
| **修仙** | 力量升级、境界进阶 |
| **末日系统** | 数值系统、生存机制 |
| **地下城核心** | 数值系统、力量升级、领地管理 |
| **浪漫奇幻** | 情感弧线、双视角节奏 |
| **科幻** | 时代考据、技术一致性 |
| **爬塔** | 数值系统、楼层进阶 |
| **治愈奇幻** | 低风险节奏、舒适优先基调 |

| **治愈奇幻** | 低风险节奏、舒适优先基调 |

中文网文题材（玄幻、仙侠、都市、恐怖、其他）同样支持，适合双语创作者。

每个题材包含**疲劳词表**（如 LitRPG 的 "delve"、"tapestry"、"testament"、"intricate"、"pivotal"）——审核员自动标记，避免你的文本读起来像其他 AI 生成小说。

---

## 核心特性

### 33 维度审核 + 去 AI 化

连续性审核员 Agent 对每个草稿进行 33 维度检查：角色记忆、资源连续性、钩子回收、大纲遵循、叙事节奏、情感弧线等。内置 AI 痕迹检测自动捕获"LLM 腔"——过度使用词、单调句式、过度总结。审核失败触发自动修改循环。

去 AI 化规则内置于 Writer Agent 提示词：疲劳词表、禁用模式、风格指纹注入——从源头减少 AI 痕迹。`revise --mode anti-detect` 对现有章节运行专门的反检测重写。

### 风格克隆

`inkos style analyze` 分析参考文本并提取统计指纹（句长分布、词频模式、节奏轮廓）+ LLM 可读风格指南。`inkos style import` 将此指纹注入书籍——所有未来章节采用该风格，Reviser 根据它审核。

### 创意简报

`inkos book create --brief my-ideas.md` — 传入你的头脑风暴笔记、世界观文档或角色表。Architect Agent 从你的简报构建（生成 `story_bible.md` 和 `book_rules.md`）而非凭空创造，并将简报持久化到 `story/author_intent.md`，确保书籍的长期意图不会在初始化后消失。

### 输入治理控制面

每本书现在有两个长期 Markdown 控制文档：

- `story/author_intent.md`：这本书在长期视野下应该成为什么
- `story/current_focus.md`：接下来 1-3 章应该将注意力拉回什么

写作前，你可以运行：

```bash
inkos plan chapter my-book --context "先把注意力拉回导师冲突"
inkos compose chapter my-book
```

这会生成 `story/runtime/chapter-XXXX.intent.md`、`context.json`、`rule-stack.yaml` 和 `trace.json`。`intent.md` 是人类可读合约；其他是执行/调试产物。`plan` / `compose` 只编译本地文档和状态，因此可以在完成 API key 设置前运行。

### 长度治理

`draft`、`write next` 和 `revise` 现在共享相同的保守长度治理器：

- `--words` 设置目标区间，不是精确硬承诺
- 中文章节默认 `zh_chars`；英文章节默认 `en_words`
- 如果章节偏离软区间，InkOS 可能运行一次校正归一化（压缩或扩展）而非硬切文本
- 如果章节在那一次后仍未命中硬范围，InkOS 仍会保存，但在结果和章节索引中显示可见长度警告和遥测

- 如果章节在那一次后仍未命中硬范围，InkOS 仍会保存，但在结果和章节索引中显示可见长度警告和遥测

### 续写

`inkos import chapters` 导入现有小说文本，自动逆向工程所有 7 个真相文件（世界状态、角色矩阵、资源账本、情节钩子等），支持 `Chapter N` 和自定义分割模式，可恢复导入。导入后，`inkos write next` 无缝续写故事。

### 同人创作

`inkos fanfic init --from source.txt --mode canon` 从源材料创建同人书籍。四种模式：canon（忠实续写）、au（平行宇宙）、ooc（角色崩坏）、cp（配对向）。包含正典导入器、同人专属审核维度、信息边界控制以保持设定一致。

### 多模型路由

不同 Agent 可以使用不同模型和提供商。Writer 用 Claude（更强创意），Auditor 用 GPT-4o（更便宜快速），Radar 用本地模型（零成本）。`inkos config set-model` 配置每个 Agent；未配置的 Agent 回退到全局模型。

### 守护进程模式 + 通知

`inkos up` 启动自主后台循环，按计划写章节。流程对非关键问题完全无人值守运行，需要人工审阅时暂停。通过 Telegram 和 Webhook 通知（HMAC-SHA256 签名 + 事件过滤）。日志到 `inkos.log`（JSON Lines），`-q` 静默模式。

### 本地模型兼容

支持任何 OpenAI 兼容端点（`--provider custom`）。流自动回退——当不支持 SSE 时，InkOS 自动重试同步模式。回退解析器处理小模型的非标准输出，流中断时部分内容恢复启动。

### 可靠性

每章创建自动状态快照——`inkos write rewrite` 将任何章节回滚到写前状态。Writer 输出写前检查清单（上下文范围、资源、待处理钩子、风险）和写后结算表；Auditor 交叉验证两者。文件锁防止并发写入。写后验证器包含跨章节重复检测和 11 条硬规则自动现场修复。

钩子系统使用 Zod schema 验证——`lastAdvancedChapter` 必须是整数，`status` 只能是 open/progressing/deferred/resolved。LLM 的 JSON 增量通过 `applyRuntimeStateDelta`（不可变更新）和 `validateRuntimeState`（结构检查）处理后再持久化。损坏数据被拒绝，不传播。

用户配置的 `INKOS_LLM_MAX_TOKENS` 现在作为所有 API 调用的全局上限。`llm.extra` 中的保留键（max_tokens、temperature 等）自动剥离以防止意外覆盖。

---

## 工作原理

每章由多个 Agent 依次生成，零人工干预：

<p align="center">
  <img src="assets/screenshot-pipeline.png" width="800" alt="流程图">
</p>

| Agent | 职责 |
|-------|------|
| **Radar** | 扫描平台趋势和读者偏好以指导故事方向（可插拔、可跳过）|
| **Planner** | 读取作者意图 + 当前焦点 + 记忆检索结果，生成章节意图（必须保留 / 必须避免）|
| **Composer** | 按相关性从所有真相文件选择相关上下文，编译规则栈和运行时产物 |
| **Architect** | 规划章节结构：大纲、场景节拍、节奏目标 |
| **Writer** | 从编译上下文生成文本（长度治理、对话驱动）|
| **Observer** | 从章节文本过度提取 9 类事实（角色、地点、资源、关系、情感、信息、钩子、时间、物理状态）|
| **Reflector** | 输出 JSON 增量（非完整 markdown）；代码层应用 Zod schema 验证后不可变写入 |
| **Normalizer** | 单次压缩/扩展将章节长度带入目标区间 |
| **Continuity Auditor** | 根据 7 个规范真相文件验证草稿，33 维度检查 |
| **Reviser** | 修复审核员发现的问题——自动修复关键问题，标记其他问题供人工审阅 |

如果审核失败，流程自动进入修改 → 重新审核循环，直到所有关键问题解决。

如果审核失败，流程自动进入修改 → 重新审核循环，直到所有关键问题解决。

### 规范真相文件

每本书维护 7 个真相文件作为唯一真相来源：

| 文件 | 用途 |
|------|------|
| `current_state.md` | 世界状态：角色位置、关系、知识、情感弧线 |
| `particle_ledger.md` | 资源记账：物品、金钱、补给及数量和衰减跟踪 |
| `pending_hooks.md` | 开放情节线：已埋伏笔、对读者的承诺、未解决冲突 |
| `chapter_summaries.md` | 每章摘要：角色、关键事件、状态变化、钩子动态 |
| `subplot_board.md` | 副线进度板：A/B/C 线状态跟踪 |
| `emotional_arcs.md` | 情感弧线：每角色情感跟踪和成长 |
| `character_matrix.md` | 角色互动矩阵：相遇记录、信息边界 |

连续性审核员根据这些文件检查每个草稿。如果角色"记得"他们从未目睹的事情，或拿出两章前丢失的武器，审核员会捕获它。

自 0.6.0 起，真相文件的权威来源已从 markdown 移至 `story/state/*.json`（Zod schema 验证）。Settler 不再输出完整 markdown 文件——它生成 JSON 增量，不可变应用并结构验证后再持久化。Markdown 文件保留为人类可读投影。现有书籍首次运行时自动迁移。

在 Node 22+ 上，SQLite 时序记忆数据库（`story/memory.db`）自动启用，支持基于相关性的历史事实、钩子和章节摘要检索——防止完整文件注入导致的上下文膨胀。

<p align="center">
  <img src="assets/screenshot-state.png" width="800" alt="真相文件快照">
</p>

### 控制面和运行时产物

除了 7 个真相文件，InkOS 将护栏与定制分离为可审阅的控制文档：

- `story/author_intent.md`：长期作者意图
- `story/current_focus.md`：近期引导
- `story/runtime/chapter-XXXX.intent.md`：章节目标、保留/避免列表、冲突解决
- `story/runtime/chapter-XXXX.context.json`：为此章节选择的实际上下文
- `story/runtime/chapter-XXXX.rule-stack.yaml`：优先级层和覆盖关系
- `story/runtime/chapter-XXXX.trace.json`：此章节的编译跟踪

这意味着简报、大纲节点、书籍规则和当前请求不再混入一个提示词块；InkOS 先编译它们，然后写作。

### 写作规则系统

Writer Agent 有约 25 条通用写作规则（角色塑造、叙事技巧、逻辑一致性、语言约束、去 AI 化），适用于所有题材。

在此之上，每个题材有专属规则（禁止项、语言约束、节奏、审核维度），每本书有自己的 `book_rules.md`（主角性格、数值上限、自定义禁止项）、`story_bible.md`（世界观）、`author_intent.md`（长期方向）和 `current_focus.md`（近期引导）。`volume_outline.md` 仍作为默认计划，但在 v2 输入治理中不再自动覆盖当前章节意图。

在此之上，每个题材有专属规则（禁止项、语言约束、节奏、审核维度），每本书有自己的 `book_rules.md`（主角性格、数值上限、自定义禁止项）、`story_bible.md`（世界观）、`author_intent.md`（长期方向）和 `current_focus.md`（近期引导）。`volume_outline.md` 仍作为默认计划，但在 v2 输入治理中不再自动覆盖当前章节意图。

## 使用模式

InkOS 提供三种交互模式，全部共享相同的原子操作：

### 1. 完整流程（一条命令）

```bash
inkos write next my-book              # 草稿 → 审核 → 自动修改，一气呵成
inkos write next my-book --count 5    # 连续写 5 章
```

`write next` 现在默认使用 `plan -> compose -> write` 治理链。如果需要旧的提示词组装路径，在 `inkos.json` 中显式设置：

```json
{
  "inputGovernanceMode": "legacy"
}
```

默认现在是 `v2`。`legacy` 作为显式回退保留。

### 2. 原子命令（可组合、外部 Agent 友好）

```bash
inkos plan chapter my-book --context "先聚焦导师冲突" --json
inkos compose chapter my-book --json
inkos draft my-book --context "聚焦地下城 boss 遭遇和队伍动态" --json
inkos audit my-book 31 --json
inkos revise my-book 31 --json
```

每条命令独立执行单个操作。`--json` 输出结构化数据。`plan` / `compose` 治理输入；`draft` / `audit` / `revise` 处理文本和质量检查。可被外部 AI Agent 通过 `exec` 调用，或用于脚本。

### 3. 自然语言 Agent 模式

```bash
inkos agent "写一本 LitRPG 小说，主角是地下城世界的治疗职业"
inkos agent "写下一章，聚焦 boss 战和战利品分配"
inkos agent "创建一本升级流小说，法师只能用一个法术"
```

18 个内置工具（write_draft、plan_chapter、compose_chapter、audit_chapter、revise_chapter、scan_market、create_book、update_author_intent、update_current_focus、get_book_status、read_truth_files、list_books、write_full_pipeline、web_fetch、import_style、import_canon、import_chapters、write_truth_file），LLM 通过 tool-use 决定调用顺序。推荐 Agent 流程：先调整控制面，然后 `plan` / `compose`，最后选择仅草稿或完整流程写作。

## CLI 参考

| 命令 | 说明 |
|------|------|
| `inkos init [name]` | 初始化项目（省略 name 则初始化当前目录）|
| `inkos book create` | 创建新书（`--genre`、`--chapter-words`、`--target-chapters`、`--brief <file>`、`--lang en/zh`）|
| `inkos book update [id]` | 更新书籍设置（`--chapter-words`、`--target-chapters`、`--status`、`--lang`）|
| `inkos book list` | 列出所有书籍 |
| `inkos book delete <id>` | 删除书籍及其所有数据（`--force` 跳过确认）|
| `inkos genre list/show/copy/create` | 查看、复制或创建题材 |
| `inkos plan chapter [id]` | 生成下一章的 `intent.md`（`--context` / `--context-file` 用于当前引导）|
| `inkos compose chapter [id]` | 生成下一章的 `context.json`、`rule-stack.yaml` 和 `trace.json` |
| `inkos write next [id]` | 完整流程：写下一章（`--words` 覆盖、`--count` 批量、`-q` 静默模式）|
| `inkos write rewrite [id] <n>` | 重写第 N 章（恢复状态快照，`--force` 跳过确认）|
| `inkos draft [id]` | 仅写草稿（`--words` 覆盖字数、`-q` 静默模式）|
| `inkos audit [id] [n]` | 审核特定章节 |
| `inkos revise [id] [n]` | 修改特定章节 |
| `inkos agent <instruction>` | 自然语言 Agent 模式 |
| `inkos review list [id]` | 审阅草稿 |
| `inkos review approve-all [id]` | 批量通过 |
| `inkos status [id]` | 项目状态 |
| `inkos export [id]` | 导出书籍（`--format txt/md/epub`、`--output <path>`、`--approved-only`）|
| `inkos fanfic init` | 从源材料创建同人书籍（`--from`、`--mode canon/au/ooc/cp`）|
| `inkos config set-global` | 设置全局 LLM 配置（~/.inkos/.env）|
| `inkos config set-model <agent> <model>` | 每 Agent 模型覆盖（`--base-url`、`--provider`、`--api-key-env`）|
| `inkos config show-models` | 显示当前模型路由 |
| `inkos doctor` | 诊断设置问题（API 连接测试 + 提供商兼容性提示）|
| `inkos detect [id] [n]` | AIGC 检测（`--all` 所有章节、`--stats` 统计）|
| `inkos style analyze <file>` | 分析参考文本提取风格指纹 |
| `inkos style import <file> [id]` | 将风格指纹导入书籍 |
| `inkos import chapters [id] --from <path>` | 导入现有章节续写（`--split`、`--resume-from`）|
| `inkos analytics [id]` / `inkos stats [id]` | 书籍分析（审核通过率、主要问题、章节排名、token 使用）|
| `inkos studio` | 启动 Web 工作台（`-p` 端口，默认 4567）|
| `inkos up / down` | 启动/停止守护进程（`-q` 静默模式，自动写入 `inkos.log`）|

`[id]` 在项目只有一本书时自动检测。所有命令支持 `--json` 结构化输出。`draft` / `write next` / `plan chapter` / `compose chapter` 接受 `--context` 引导，`--words` 覆盖目标章节大小。`book create` 支持 `--brief <file>` 传入创意简报——Architect 从你的想法构建而非凭空生成。`plan chapter` / `compose chapter` 不需要活跃 LLM，因此可以在完成 API 设置前检查治理输入。

## 路线图

- [x] ~~`packages/studio` Web UI 工作台（Vite + React + Hono）~~ — 已发布，运行 `inkos studio`
- [x] ~~桌面端（Tauri）~~ — 已发布，下载 `.exe` 或 `.msi` 安装包
- [x] ~~OAuth2 集成 Sub2API~~ — 已发布，桌面端和 Web 端支持一键授权
- [x] ~~Web 端去门控~~ — 已发布，直接访问 `inkos.vivy1024.cc` 无需登录
- [ ] 交互式小说（分支叙事 + 读者选择）
- [ ] 部分章节干预（重写半章 + 级联真相文件更新）
- [ ] 自定义 Agent 插件系统

## 本 Fork 特性

本仓库是 [Narcooo/inkos](https://github.com/Narcooo/inkos) 的 fork，新增以下特性：

1. **Tauri 桌面端**：编译为 Windows .exe，支持本地文件系统存储
2. **OAuth2 授权流程**：与 [Sub2API](https://egost1024.top) 集成，一键获取 API Key
3. **Web 端去门控**：移除登录限制，直接访问即可使用
4. **双端数据存储**：Web 端用服务端 SQLite，桌面端用本地文件系统

上游更新会定期同步。

## 贡献

欢迎贡献。提交 issue 或 PR。

开发进展迅速。更多功能和写作质量改进将持续推出。欢迎反馈、功能请求和项目跟进。目标是构建最强的 AI 小说写作 Agent。

```bash
pnpm install
pnpm dev          # 所有包的监视模式
pnpm test         # 运行测试
pnpm typecheck    # 类型检查不输出
```

## Star History

<a href="https://www.star-history.com/#Narcooo/inkos&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Narcooo/inkos&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Narcooo/inkos&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Narcooo/inkos&type=date&legend=top-left" />
 </picture>
</a>

## Repobeats

![Alt](https://repobeats.axiom.co/api/embed/024114415c1505a8c27fb121e3b392524e48f583.svg "Repobeats analytics image")

## 贡献者

<a href="https://github.com/Narcooo/inkos/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Narcooo/inkos" />
</a>

## 许可证

[MIT](LICENSE)

