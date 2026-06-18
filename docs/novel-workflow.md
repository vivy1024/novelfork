# 小说写作流程

NovelFork v1.11.2 的小说写作功能全部封装在 `packages/novel-plugin/` 中。本文描述写作主链路、工具清单和质量机制。

## 写作主链路

```
cockpit.snapshot → jingwei.read(scope=brief) → pgi.ask → AskUserQuestion
  → scene.spec → jingwei.read(scope=category) → pipeline.write → 候选稿
```

编排入口：`novel-plugin/src/handlers/pipeline-write-service.ts`（executePipelineWrite）。

## 核心工具清单

### cockpit.snapshot

驾驶舱全景快照——一次性读取书籍完整状态。

- 返回：progress、hooks、candidates、health、recentChapters
- 使用时机：写作会话开始时、用户问进度时、准备写下一章时
- 不要用：刚调用过且结果还在上下文中

### jingwei.read

经纬（设定数据库）读取，三种模式：

- `scope=brief`：核心设定包 + 目录索引（2000-5000 tokens，优先使用）
- `scope=category`：按分类分页读取详细条目（characters/world-model/conflicts 等）
- `scope=search`：关键词搜索

使用时机：准备写作前加载上下文、用户说"看设定"时。
不要用：刚读过且上下文中还能看到结果时。
category 枚举：premise/world-model/characters/relationships/factions/locations/props/outline/conflicts/foreshadowing/timeline/chapter-summaries/power-system/rules/reference。

### jingwei.write

经纬写入工具。

- action：create / update / delete
- layer 三层：canon（不可变真相）、dynamic（随剧情变化）、reference（低优先级参考）
- category 必须使用统一枚举值（同 jingwei.read）
- **v1.11.2 新增**：canon 条目可以修改 category（分类重组时只改 category 不需要传 contentMd）
- 不要用：用户只是在讨论设定但没有确认要入库时
- 常见错误：不要用 Bash SQL 绕道——jingwei.write 支持所有设定修改

### pgi.ask

PGI 追问工具（三合一）：生成追问问题 + 返回 AskUserQuestion 格式 + 格式化用户回答。

- 使用时机：需要向用户确认写作方向/选择时、用户指令模糊需要追问时
- **不要用**：用户已经给了明确完整的指令（直接执行，不要多此一问）；用户说"继续"/"接着写"（方向已确定，直接进 scene.spec）

### scene.spec

生成结构化写作蓝图——pipeline.write 的硬前置条件。

- 蓝图包含：涉及角色、地点、核心冲突、情绪弧线、章节目标、目标字数、伏笔节点
- 使用流程：cockpit.snapshot → jingwei.read(brief) → 可选 pgi.ask → scene.spec
- 不要用：用户没有要求写章节时、用户在做非写作操作时

### pipeline.write

写作管线核心：接受 scene.spec 蓝图 → Writer → ContinuityAudit → Revise → 候选稿。

- **使用时机**：用户明确要求"写下一章"/"生成章节"时
- **不要用**：用户只是在问问题、查看设定、讨论方向——不要把所有交互都往写作流程引导
- 长度由蓝图中的 targetWordCount 控制（默认 3000-5000 字）
- S1 级问题自动修订，S3-S4 仅警告

### resource.manage

写作资源生命周期管理：list/accept/reject/archive/restore/delete/create_draft。
pipeline.write 产出候选稿后，用 accept 接受为正式章节。

### 其他工具

| 工具 | 用途 |
|------|------|
| chapter.read | 读取指定章节正文、元数据和状态 |
| chapter.list | 列出书籍所有章节 |
| chapter.audit | 单章质量审计（节奏/AI味/伏笔/连续性） |
| pipeline.revise | 修订已有章节（polish/rewrite/rework/spot-fix/anti-detect） |
| pipeline.import_chapters | 整书导入（.txt/.md → 按章节标题分割） |
| rewrite.segment | 对选定段落执行改写 |
| rewrite.apply | 将改写结果写回章节文件 |
| style.import | 从参考文本提取文风档案 |
| outline.suggest_next | 基于大纲推荐下一章方向 |
| character.check_consistency | 角色一致性检查 |
| hooks.manage | 伏笔管理（埋设/兑现/检查到期/列出） |
| presets.read/write | 预设规则读写 |
| beat.read/write | 节拍模板管理 |
| presets.check_compliance | 规则合规检查 |
| candidate.create_chapter | 仅保存已有正文为候选稿（不生成/不审计） |
| narrative.read_line | 读取叙事线快照 |
| narrative.propose_change | 生成叙事线变更草案 |

## 质量机制

### 对抗式审查（Adversarial Audit）

3 个独立视角并行执行（`engine/agents/adversarial-audit.ts`）：
- A 视角：连续性审查
- B 视角：叙事质量审查
- C 视角：文本检测（AI味/重复/节奏）

独立跑 + 纯函数合成，避免确认偏误。

### 严重度门禁（Severity Gate）

S1-S4 分级（`engine/agents/severity-gate.ts`）：
- S1：阻断——必须修复才能输出
- S2：修订——自动调用 ReviserAgent 定点修复
- S3-S4：警告——记录但不阻断

### 长度治理

- LengthNormalizerAgent 归一化
- Warning 不阻断，仅提示
- 目标字数由 scene.spec 蓝图控制

### 动态词频 / AI 痕迹检测

- WriterAgent 内置 dim20-23 维度词频提示
- `ai-tells.ts` 规则版 AI 痕迹检测（12+ 模式）

## Prompt 效率规则

- 工具描述中已包含"使用时机"和"不要用的时候"指引
- pipeline.write 描述明确要求用户显式请求写作才调用
- pgi.ask 描述明确要求指令明确时不要多此一问
- jingwei.write 描述明确支持 canon category 修改
