<p align="center">
  <img src="assets/logo.svg" width="120" height="120" alt="InkOS Logo">
  <img src="assets/inkos-text.svg" width="240" height="65" alt="InkOS">
</p>

<h1 align="center">自动化小说写作 CLI Agent</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@actalk/inkos"><img src="https://img.shields.io/npm/v/@actalk/inkos.svg?color=cb3837&logo=npm" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript"></a>
</p>

<p align="center">
  中文 | <a href="README.en.md">English</a>
</p>

---

Agent 写小说。写、审、改，全程接管。

## v0.4 更新

续写 + 番外写作 + 文风仿写 + 多 Provider 路由 + 写后验证器 + 审计闭环加固。

### 续写已有作品

把已有的小说（单文件或章节目录）导入 InkOS，系统自动拆章、逆向工程生成全套真相文件（世界状态、伏笔、角色矩阵等），之后直接 `write next` 续写。

```bash
inkos import chapters 我的小说 --from 已有章节/        # 从目录导入
inkos import chapters 我的小说 --from 全书.txt          # 从单文件导入（自动按"第X章"拆分）
inkos import chapters 我的小说 --from 全书.txt --split "Chapter\\s+\\d+"  # 自定义分章正则
inkos write next 我的小说                               # 无缝续写
```

单文件模式自动按 `第X章` 分章，也支持 `--split <regex>` 自定义。导入中断可用 `--resume-from <n>` 断点续导。

### 番外写作（Spinoff）

基于已有书创建前传、后传、外传或 if 线。番外和正传共享世界观和角色，但有独立剧情线。

```bash
inkos import canon 烈焰前传 --from 吞天魔帝   # 导入正传正典到番外
inkos write next 烈焰前传                     # 写手自动读取正典约束
```

导入后生成 `story/parent_canon.md`，包含正传的世界规则、角色快照（含信息边界）、关键事件时间线、伏笔状态。写手在动笔前参照正典，审计员自动激活 4 个番外专属维度：

| 维度 | 审查内容 |
|------|----------|
| 正传事件冲突 | 番外事件是否与正典约束表矛盾 |
| 未来信息泄露 | 角色是否引用了分歧点之后才揭示的信息 |
| 世界规则跨书一致性 | 番外是否违反正传世界规则（力量体系、地理、阵营） |
| 番外伏笔隔离 | 番外是否越权回收正传伏笔 |

检测到 `parent_canon.md` 自动激活，无需额外配置。

### 文风仿写

喂入真人小说片段，系统提取统计指纹 + 生成风格指南，后续每章自动注入写手 prompt。

```bash
inkos style analyze 参考小说.txt                     # 分析：句长、TTR、修辞特征
inkos style import 参考小说.txt 吞天魔帝 --name 某作者  # 导入文风到书
```

产出两个文件：
- `style_profile.json` — 统计指纹（句长分布、段落长度、词汇多样性、修辞密度）
- `style_guide.md` — LLM 生成的定性风格指南（节奏、语气、用词偏好、禁忌）

写手每章读取风格指南，审计员在文风维度对照检查。

### 写后验证器

11 条确定性规则，零 LLM 成本，每章写完立刻触发：

| 规则 | 说明 |
|------|------|
| 禁止句式 | 「不是……而是……」 |
| 禁止破折号 | 「——」 |
| 转折词密度 | 仿佛/忽然/竟然等，每 3000 字 ≤ 1 次 |
| 高疲劳词 | 题材疲劳词单章每词 ≤ 1 次 |
| 元叙事 | 编剧旁白式表述 |
| 报告术语 | 分析框架术语不入正文 |
| 作者说教 | 显然/不言而喻等 |
| 集体反应 | 「全场震惊」类套话 |
| 连续了字 | ≥ 6 句连续含「了」 |
| 段落过长 | ≥ 2 个段落超 300 字 |
| 本书禁忌 | book_rules.md 中的禁令 |

验证器发现 error 级违规时，自动触发 `spot-fix` 模式定点修复，不等 LLM 审计。

### 审计-修订闭环加固

实测发现 `rewrite` 模式引入 6 倍 AI 标记词，现在：

- 自动修订模式从 `rewrite` 改为 `spot-fix`（只改问题句，不碰其余正文）
- 修订后对比 AI 标记数，如果修订反而增多 AI 痕迹，丢弃修订保留原文
- 再审温度锁 0（消除审计随机性，同一章不再出现 0-6 个 critical 的波动）
- `polish` 模式加固边界（禁止增删段落、改人名、加新情节）

### 多 Provider 路由

不同 agent 可以走不同 API 提供商——不只是换模型名，是完全不同的 API 地址和 Key。例如写手用便宜模型高速出稿，审计员用强模型精审：

```bash
inkos config set-model writer gpt-4o-mini                                    # 简单模型覆盖
inkos config set-model auditor gemini-2.5-flash \
  --base-url https://generativelanguage.googleapis.com/v1beta/openai \
  --provider openai \
  --api-key-env GEMINI_API_KEY                                                # 走 Gemini API
inkos config set-model reviser claude-sonnet-4-20250514 \
  --base-url https://api.anthropic.com \
  --provider anthropic \
  --api-key-env ANTHROPIC_API_KEY                                             # 走 Anthropic API
inkos config show-models                                                      # 查看路由全景
```

每个 agent 独立配置 `--base-url`、`--provider`、`--api-key-env`、`--no-stream`。未覆盖的 agent 使用项目默认模型。

### 数据分析

```bash
inkos analytics 吞天魔帝          # 审计通过率、高频问题类别、问题最多的章节
inkos analytics 吞天魔帝 --json   # 结构化输出
```

### 其他 v0.4 变更

- 审计维度从 26 扩展到 33（+4 番外维度 + dim 27 敏感词 + dim 32 读者期待管理 + dim 33 大纲偏离检测）
- 审计员联网搜索：年代考据题材可联网核实真实事件/人物/地理（原生搜索能力）
- 调度器重写：AI 节奏（默认 15 分钟一轮）、并行书处理、立即重试、每日上限
- 修订者新增 `spot-fix` 模式（定点修复）
- `book_rules.md` 的 `additionalAuditDimensions` 支持中文名称匹配
- 全部 5 个题材激活 dim 24-26（支线停滞/弧线平坦/节奏单调）
- `inkos export` 支持 `--format md`、`--output <path>`、`--approved-only`
- 写后验证器「连续了字」阈值从 4 句上调至 6 句（减少中文叙事误报）
- 安全加固：`init`/`book create`/`import chapters` 防覆盖检查、`config set` 类型推断 + key 校验、`update` 防降级、`doctor` 项目外可测 API、状态显示一致性、`genre show` 拒绝无效 ID

---

## v0.3 更新

创作规则三层分离 + 跨章记忆 + AIGC 检测 + Webhook。

### 跨章记忆与写作质量

Writer 每章自动生成摘要、更新支线/情感/角色矩阵，全部追加到真相文件。后续章节加载全量上下文，长线伏笔不再丢失。

| 真相文件 | 用途 |
|----------|------|
| `chapter_summaries.md` | 各章摘要：出场人物、关键事件、状态变化、伏笔动态 |
| `subplot_board.md` | 支线进度板：A/B/C 线状态追踪 |
| `emotional_arcs.md` | 情感弧线：按角色追踪情绪、触发事件、弧线方向 |
| `character_matrix.md` | 角色交互矩阵：相遇记录、信息边界 |

### AIGC 检测

| 功能 | 说明 |
|------|------|
| AI 痕迹审计 | 纯规则检测（不走 LLM）：段落等长、套话密度、公式化转折、列表式结构，自动合并到审计结果 |
| AIGC 检测 API | 外部 API 集成（GPTZero / Originality / 自定义端点），`inkos detect` 命令 |
| 文风指纹学习 | 从参考文本提取 StyleProfile（句长、TTR、修辞特征），注入 Writer prompt |
| 反检测改写 | ReviserAgent `anti-detect` 模式，检测→改写→重检测循环 |
| 检测反馈闭环 | `detection_history.json` 记录每次检测/改写结果，`inkos detect --stats` 查看统计 |

```bash
inkos style analyze reference.txt         # 分析参考文本文风
inkos style import reference.txt 吞天魔帝  # 导入文风到书
inkos detect 吞天魔帝 --all               # 全书 AIGC 检测
inkos detect --stats                      # 检测统计
```

### Webhook + 智能调度

管线事件 POST JSON 到配置 URL（HMAC-SHA256 签名），支持事件过滤（`chapter-complete`、`audit-failed`、`pipeline-error` 等）。守护进程增加质量门控：审计失败自动重试（调高 temperature）、连续失败暂停书籍。

### 题材自定义

内置 5 个题材，每个题材带一套完整的创作规则：章节类型、禁忌清单、疲劳词、语言铁律、审计维度。

| 题材 | 自带规则 |
|------|----------|
| 玄幻 | 数值系统、战力体系、同质吞噬衰减公式、打脸/升级/收益兑现节奏 |
| 仙侠 | 修炼/悟道节奏、法宝体系、天道规则 |
| 都市 | 年代考据、商战/社交驱动、法律术语年代匹配、无数值系统 |
| 恐怖 | 氛围递进、恐惧层级、克制叙事、无战力审计 |
| 通用 | 最小化兜底 |

创建书时指定题材，对应规则自动生效：

```bash
inkos book create --title "吞天魔帝" --genre xuanhuan
```

题材规则可以查看、复制到项目中修改、或从零创建：

```bash
inkos genre list                      # 查看所有题材
inkos genre show xuanhuan             # 查看玄幻的完整规则
inkos genre copy xuanhuan             # 复制到项目中，随意改
inkos genre create wuxia --name 武侠   # 从零创建新题材
```

复制到项目后，增删禁忌、调整疲劳词、修改节奏规则、自定义语言铁律——改完下次写章自动生效。

每个题材有专属语言铁律（带 ✗→✓ 示例），写手和审计员同时执行：

- **玄幻**：✗ "火元从12缕增加到24缕" → ✓ "手臂比先前有力了，握拳时指骨发紧"
- **都市**：✗ "迅速分析了当前的债务状况" → ✓ "把那叠皱巴巴的白条翻了三遍"
- **恐怖**：✗ "感到一阵恐惧" → ✓ "后颈的汗毛一根根立起来"

### 单本书规则

每本书有独立的 `book_rules.md`，建筑师 agent 创建书时自动生成，也可以随时手改。写在这里的规则注入每一章的 prompt：

```yaml
protagonist:
  name: 林烬
  personalityLock: ["强势冷静", "能忍能杀", "有脑子不是疯狗"]
  behavioralConstraints: ["不圣母不留手", "对盟友有温度但不煽情"]
numericalSystemOverrides:
  hardCap: 840000000
  resourceTypes: ["微粒", "血脉浓度", "灵石"]
prohibitions:
  - 主角关键时刻心软
  - 无意义后宫暧昧拖剧情
  - 配角戏份喧宾夺主
fatigueWordsOverride: ["瞳孔骤缩", "不可置信"]   # 覆盖题材默认
```

主角人设锁定、数值上限、自定义禁令、疲劳词覆盖——每本书的规则独立调整，不影响题材模板。

### 33 维度审计

审计细化为 33 个维度，按题材自动启用对应的子集：

OOC检查、时间线、设定冲突、战力崩坏、数值检查、伏笔、节奏、文风、信息越界、词汇疲劳、利益链断裂、年代考据、配角降智、配角工具人化、爽点虚化、台词失真、流水账、知识库污染、视角一致性、段落等长、套话密度、公式化转折、列表式结构、支线停滞、弧线平坦、节奏单调、敏感词检查、正传事件冲突、未来信息泄露、世界规则跨书一致性、番外伏笔隔离、读者期待管理、大纲偏离检测

dim 20-23（AI 痕迹）+ dim 27（敏感词）由纯规则引擎检测，不消耗 LLM 调用。dim 28-31（番外维度）检测到 `parent_canon.md` 自动激活。dim 32（读者期待管理）、dim 33（大纲偏离检测）始终开启。

### 去 AI 味

5 条通用规则 + 每个题材的专属语言规则，控制 AI 标记词密度和叙述习惯：

- AI 标记词限频：仿佛/忽然/竟然/不禁/宛如/猛地，每 3000 字 ≤ 1 次
- 叙述者不替读者下结论，只写动作
- 禁止分析报告式语言（"核心动机""信息落差"不入正文）
- 同一意象渲染不超过两轮
- 方法论术语不入正文

词汇疲劳审计 + AI 痕迹审计（dim 20-23）双重检测。文风指纹注入进一步降低 AI 文本特征。

### 其他

- 支持 OpenAI + Anthropic 原生 + 所有 OpenAI 兼容接口
- 修订者支持 polish / rewrite / rework / anti-detect / spot-fix 五种模式
- 无数值系统的题材不生成资源账本
- 所有命令支持 `--json` 结构化输出，OpenClaw / 外部 Agent 可直接解析
- book-id 自动检测：项目只有一本书时省略 book-id
- `inkos update` 一键更新、`inkos init` 支持当前目录初始化
- API 错误附带中文诊断提示，`inkos doctor` 含 API 连通性测试

---

## 为什么需要 InkOS？

用 AI 写小说不是简单的"提示词 + 复制粘贴"。长篇小说很快就会崩：角色记忆混乱、物品凭空出现、同样的形容词每段都在重复、伏笔悄无声息地断掉。InkOS 把这些当工程问题来解决。

- **长期记忆** — 追踪世界的真实状态，而非 LLM 的幻觉
- **反信息泄漏** — 确保角色只知道他们亲眼见证过的事
- **资源衰减** — 物资会消耗、物品会损坏，没有无限背包
- **词汇疲劳检测** — 在读者发现之前就捕捉过度使用的词语
- **自动修订** — 在人工审核之前修复数值错误和连续性断裂

## 工作原理

每一章由五个 Agent 接力完成：

<p align="center">
  <img src="assets/screenshot-pipeline.png" width="800" alt="管线流程图">
</p>

| Agent | 职责 |
|-------|------|
| **雷达 Radar** | 扫描平台趋势和读者偏好，指导故事方向（可插拔，可跳过） |
| **建筑师 Architect** | 规划章节结构：大纲、场景节拍、节奏控制 |
| **写手 Writer** | 根据大纲 + 当前世界状态生成正文 |
| **连续性审计员 Auditor** | 对照长期记忆验证草稿 |
| **修订者 Reviser** | 修复审计发现的问题 — 关键问题自动修复，其他标记给人工审核 |

如果审计不通过，管线自动进入"修订 → 再审计"循环，直到所有关键问题清零。

### 长期记忆

每本书维护 7 个真相文件作为唯一事实来源：

| 文件 | 用途 |
|------|------|
| `current_state.md` | 世界状态：角色位置、关系网络、已知信息、情感弧线 |
| `particle_ledger.md` | 资源账本：物品、金钱、物资数量及衰减追踪 |
| `pending_hooks.md` | 未闭合伏笔：铺垫、对读者的承诺、未解决冲突 |
| `chapter_summaries.md` | 各章摘要：出场人物、关键事件、状态变化、伏笔动态 |
| `subplot_board.md` | 支线进度板：A/B/C 线状态、停滞检测 |
| `emotional_arcs.md` | 情感弧线：按角色追踪情绪变化和成长 |
| `character_matrix.md` | 角色交互矩阵：相遇记录、信息边界 |

连续性审计员对照这些文件检查每一章草稿。如果角色"记起"了从未亲眼见过的事，或者拿出了两章前已经丢失的武器，审计员会捕捉到。旧书无新真相文件时自动兼容。

<p align="center">
  <img src="assets/screenshot-state.png" width="800" alt="长期记忆快照">
</p>

### 创作规则体系

写手 agent 内置 ~25 条通用创作规则（人物塑造、叙事技法、逻辑自洽、语言约束、去 AI 味），适用于所有题材。

在此基础上，每个题材有专属规则（禁忌、语言铁律、节奏、审计维度），每本书有独立的 `book_rules.md`（主角人设、数值上限、自定义禁令）和 `story_bible.md`（世界观设定），由建筑师 agent 创建书籍时自动生成。

详见 [v0.3 更新](#v03-更新-2026-03-13)。

## 三种使用模式

InkOS 提供三种交互方式，底层共享同一组原子操作：

### 1. 完整管线（一键式）

```bash
inkos write next 吞天魔帝          # 写草稿 → 审计 → 自动修订，一步到位
inkos write next 吞天魔帝 --count 5 # 连续写 5 章
```

### 2. 原子命令（可组合，适合外部 Agent 调用）

```bash
inkos draft 吞天魔帝 --context "本章重点写师徒矛盾" --json
inkos audit 吞天魔帝 31 --json
inkos revise 吞天魔帝 31 --json
```

每个命令独立执行单一操作，`--json` 输出结构化数据。可被 OpenClaw 等 AI Agent 通过 `exec` 调用，也可用于脚本编排。

### 3. 自然语言 Agent 模式

```bash
inkos agent "帮我写一本都市修仙，主角是个程序员"
inkos agent "写下一章，重点写师徒矛盾"
inkos agent "先扫描市场趋势，然后根据结果创建一本新书"
```

内置 13 个工具（write_draft、audit_chapter、revise_chapter、scan_market、create_book、get_book_status、read_truth_files、list_books、write_full_pipeline、web_fetch、import_style、import_canon、import_chapters），LLM 通过 tool-use 决定调用顺序。

## 快速开始

### 安装

```bash
npm i -g @actalk/inkos
```

### 配置

**方式一：全局配置（推荐，只需一次）**

```bash
inkos config set-global \
  --provider openai \
  --base-url https://api.openai.com/v1 \
  --api-key sk-xxx \
  --model gpt-4o
```

配置保存在 `~/.inkos/.env`，所有项目共享。之后新建项目不用再配。

**方式二：项目级 `.env`**

```bash
inkos init my-novel     # 初始化项目
# 编辑 my-novel/.env
```

```bash
# 必填
INKOS_LLM_PROVIDER=openai                        # openai / anthropic
INKOS_LLM_BASE_URL=https://api.openai.com/v1     # API 地址（支持中转站）
INKOS_LLM_API_KEY=sk-xxx                          # API Key
INKOS_LLM_MODEL=gpt-4o                            # 模型名

# 可选
# INKOS_LLM_TEMPERATURE=0.7                       # 温度
# INKOS_LLM_MAX_TOKENS=8192                        # 最大输出 token
# INKOS_LLM_THINKING_BUDGET=0                      # Anthropic 扩展思考预算
```

项目 `.env` 会覆盖全局配置。不需要覆盖时可以不写。

### 使用

```bash
inkos book create --title "吞天魔帝" --genre xuanhuan  # 创建新书
inkos write next 吞天魔帝      # 写下一章（完整管线）
inkos status                   # 查看状态
inkos review list 吞天魔帝     # 审阅草稿
inkos export 吞天魔帝          # 导出全书
inkos up                       # 守护进程模式
```

<p align="center">
  <img src="assets/screenshot-terminal.png" width="700" alt="终端截图">
</p>

## 命令参考

| 命令 | 说明 |
|------|------|
| `inkos init [name]` | 初始化项目（省略 name 在当前目录初始化） |
| `inkos book create` | 创建新书（`--genre`、`--platform`、`--chapter-words`、`--target-chapters`、`--context`） |
| `inkos book update [id]` | 修改书设置（`--chapter-words`、`--target-chapters`、`--status`） |
| `inkos book list` | 列出所有书籍 |
| `inkos genre list/show/copy/create` | 查看、复制、创建题材 |
| `inkos write next [id]` | 完整管线写下一章（`--words` 覆盖字数，`--count` 连写） |
| `inkos write rewrite [id] <n>` | 重写第 N 章（恢复状态快照，`--force` 跳过确认，`--words` 覆盖字数） |
| `inkos draft [id]` | 只写草稿（`--words` 覆盖字数） |
| `inkos audit [id] [n]` | 审计指定章节 |
| `inkos revise [id] [n]` | 修订指定章节 |
| `inkos agent <instruction>` | 自然语言 Agent 模式 |
| `inkos review list [id]` | 审阅草稿 |
| `inkos review approve-all [id]` | 批量通过 |
| `inkos status [id]` | 项目状态 |
| `inkos export [id]` | 导出书籍（`--format md`、`--output <path>`、`--approved-only`） |
| `inkos radar scan` | 扫描平台趋势 |
| `inkos config set-global` | 设置全局 LLM 配置（~/.inkos/.env） |
| `inkos config show-global` | 查看全局配置 |
| `inkos config set/show` | 查看/更新项目配置 |
| `inkos config set-model <agent> <model>` | 为指定 agent 设置模型覆盖（`--base-url`、`--provider`、`--api-key-env` 支持多 Provider 路由） |
| `inkos config remove-model <agent>` | 移除 agent 模型覆盖（回退到默认） |
| `inkos config show-models` | 查看当前模型路由 |
| `inkos doctor` | 诊断配置问题（含 API 连通性测试） |
| `inkos detect [id] [n]` | AIGC 检测（`--all` 全部章节，`--stats` 统计） |
| `inkos style analyze <file>` | 分析参考文本提取文风指纹 |
| `inkos style import <file> [id]` | 导入文风指纹到指定书 |
| `inkos import canon [id] --from <parent>` | 导入正传正典到番外书 |
| `inkos import chapters [id] --from <path>` | 导入已有章节续写（`--split`、`--resume-from`） |
| `inkos analytics [id]` | 书籍数据分析（审计通过率、高频问题、章节排名） |
| `inkos update` | 更新到最新版本 |
| `inkos up / down` | 启动/停止守护进程 |

`[id]` 参数在项目只有一本书时可省略，自动检测。所有命令支持 `--json` 输出结构化数据。`draft`/`write next`/`book create` 支持 `--context` 传入创作指导，`--words` 覆盖每章字数（OpenClaw 可逐章动态控制）。

## 实测数据

用 InkOS 全自动跑了一本玄幻题材的《吞天魔帝》：

<p align="center">
  <img src="assets/screenshot-chapters.png" width="800" alt="生产数据">
</p>

| 指标 | 数据 |
|------|------|
| 已完成章节 | 31 章 |
| 总字数 | 452,191 字 |
| 平均章字数 | ~14,500 字 |
| 审计通过率 | 100% |
| 资源追踪项 | 48 个 |
| 活跃伏笔 | 20 条 |
| 已回收伏笔 | 10 条 |

## 核心特性

### 状态快照 + 章节重写

每章自动创建状态快照。使用 `inkos write rewrite <id> <n>` 可以回滚并重新生成任意章节 — 世界状态、资源账本、伏笔钩子全部恢复到该章写入前的状态。

### 写入锁

基于文件的锁机制防止对同一本书的并发写入。

### 写前自检 + 写后结算

写手 agent 在动笔前必须输出自检表（上下文范围、当前资源、待回收伏笔、冲突概述、风险扫描），写完后输出结算表（资源变动、伏笔变动）。审计员对照结算表和正文内容做交叉验证。

### 可插拔雷达

雷达数据源通过 `RadarSource` 接口实现可插拔。内置番茄小说和起点中文网两个数据源，也可以传入自定义数据源或直接跳过雷达。用户自己提供题材时，agent 模式会自动跳过市场扫描。

### 守护进程模式

`inkos up` 启动后台循环，按计划写章。管线对非关键问题全自动运行，当审计员标记无法自动修复的问题时暂停等待人工审核。

### 通知推送

支持 Telegram、飞书、企业微信、Webhook。守护进程模式下，写完一章或审计不通过都会推通知到手机。Webhook 支持 HMAC-SHA256 签名和事件过滤。

### 外部 Agent 集成

原子命令 + `--json` 输出让 InkOS 可以被 OpenClaw 等 AI Agent 调用。OpenClaw 通过 `exec` 工具执行 `inkos draft`/`audit`/`revise`，读取 JSON 结果决定下一步操作。

## 项目结构

```
inkos/
├── packages/
│   ├── core/              # Agent 运行时、管线、状态管理
│   │   ├── agents/        # architect, writer, continuity, reviser, radar, ai-tells, post-write-validator, sensitive-words, detector, style-analyzer
│   │   ├── pipeline/      # runner, agent (tool-use), scheduler, detection-runner
│   │   ├── state/         # 基于文件的状态管理器（7+ 真相文件 + 快照）
│   │   ├── llm/           # OpenAI + Anthropic 双 SDK 接口 (流式)
│   │   ├── notify/        # Telegram, 飞书, 企业微信, Webhook
│   │   └── models/        # Zod schema 校验
│   └── cli/               # Commander.js 命令行 (22 条命令)
│       └── commands/      # init, book, write, draft, audit, revise, agent, review, detect, style...
└── (规划中) studio/        # 网页审阅编辑界面
```

TypeScript 单仓库，pnpm workspaces 管理。

## 路线图

- [x] 完整管线（雷达 → 建筑师 → 写手 → 审计 → 修订）
- [x] 长期记忆 + 连续性审计
- [x] 内置创作规则体系
- [x] CLI 全套命令（20 条）
- [x] 状态快照 + 章节重写
- [x] 守护进程模式
- [x] 通知推送（Telegram / 飞书 / 企微）
- [x] 原子命令 + JSON 输出（draft / audit / revise）
- [x] 自然语言 Agent 模式（tool-use 编排）
- [x] 可插拔雷达（RadarSource 接口）
- [x] 外部 Agent 集成（OpenClaw 等）
- [x] 题材自定义 + 单本书规则（genre CLI + book_rules.md）
- [x] 33 维度连续性审计（含 AI 痕迹检测 + 番外维度 + 大纲偏离检测）
- [x] 去 AI 味铁律 + 文风指纹注入
- [x] 多 LLM provider（OpenAI + Anthropic + 兼容接口）
- [x] AIGC 检测 + 反检测改写管线
- [x] Webhook 通知 + 智能调度（质量门控）
- [x] 跨章节连贯性（章节摘要 + 支线/情感/角色矩阵）
- [x] 番外写作（正典导入 + 4 维度审计 + 信息边界管控）
- [x] 文风仿写（统计指纹 + LLM 风格指南 + 写手注入）
- [x] 写后验证器（11 条硬规则 + 自动 spot-fix）
- [x] 审计-修订闭环加固（AI 标记守卫 + 温度锁）
- [x] 续写已有作品（import chapters + 自动逆向真相文件 + 断点续导）
- [x] 多 Provider 路由（不同 agent 走不同 API 地址和 Key，`inkos config set-model --base-url --provider`）
- [x] 数据分析（`inkos analytics`：审计通过率、高频问题、章节排名）
- [ ] `packages/studio` Web UI 审阅编辑界面（Vite + React + Hono）
- [ ] 成本追踪 + 运行看板（每章 token 消耗、API 花费、审计轮次，`inkos stats`）
- [ ] EPUB 导出（`inkos export --format epub`，手机/Kindle 阅读）
- [ ] 局部干预（重写半章 + 级联更新后续 truth 文件）
- [ ] 空章节/断章修复（本地小模型解析容错 + 超时重连）
- [ ] 自定义 agent 插件系统
- [ ] 平台格式导出（起点、番茄等）

## 参与贡献

欢迎贡献代码。提 issue 或 PR。

```bash
pnpm install
pnpm dev          # 监听模式
pnpm test         # 运行测试
pnpm typecheck    # 类型检查
```

## 许可证

[MIT](LICENSE)
