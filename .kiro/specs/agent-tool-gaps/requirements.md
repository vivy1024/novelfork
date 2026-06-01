# Agent 工具缺口补全 — Requirements

**版本**: v1.0.0
**创建日期**: 2026-05-31
**状态**: active

---

## 问题陈述

NovelFork 有两套写作执行体系：
- **Agent 工具层**（session-tool-executor.ts）：用户对话的主路径，10 个核心工具
- **PipelineRunner**（runner.ts）：HTTP API 的后端，从 InkOS 继承的 3187 行编排器

两套体系功能不对齐。Pipeline 有的能力（修订、整书导入、文风提取），Agent 工具层没有。用户在对话中让 Agent 做这些事时，Agent 无法完成。

本 spec 不重写 Pipeline（违反铁律 3），而是把缺失的能力补为 Agent 工具，直接调用底层 Agent 类。

---

## 目标

1. Agent 在对话中能完成：修订章节、整书导入、文风提取、改写写回
2. 不新增 PipelineRunner 依赖——新工具直接调用底层 Agent 类（WriterAgent、ReviserAgent 等）
3. 每个工具独立可验证，不依赖其他工具的完成

---

## 非目标

1. 不删除 PipelineRunner（HTTP API 仍依赖它，违反铁律 3）
2. 不重写 HTTP API 路由（保持前端兼容）
3. 不做 CLI 适配（CLI 是技术债，不投入维护）
4. 不做前端 UI（工具通过对话调用）

## Pipeline 处置策略

**现状**：PipelineRunner（3187 行）是 InkOS 遗产，HTTP API 的 7 个前端调用 endpoint 依赖它。

**策略**：
- 新工具**不经过 PipelineRunner**，直接调用底层 Agent 类（WriterAgent、ReviserAgent 等）
- HTTP API 保持不变（前端兼容）
- 长期：当所有前端按钮迁移为"通过 Agent 对话触发"后，HTTP API 和 PipelineRunner 自然退役
- CLI 包（packages/cli）标记为 deprecated，不再维护

**底层 Agent 类（可直接使用）**：
- WriterAgent — 生成章节正文
- ReviserAgent — 修订章节（5 种模式）
- ContinuityAuditor — 37 维度审计
- ArchitectAgent — 生成基础设定
- ChapterAnalyzerAgent — 章节分析（导入时用）
- StyleAnalyzer — 文风统计分析
- PlannerAgent — 规划章节意图
- ComposerAgent — 组装上下文包

---

## 需求

### R1: pipeline.revise — 修订章节

**用户场景**：用户说"帮我修一下第 5 章，去掉 AI 味"

**输入**：
```
{
  bookId: string (required)
  chapterNumber: number (optional, 默认最新章)
  mode: "polish" | "rewrite" | "rework" | "spot-fix" | "anti-detect" (默认 "polish")
}
```

**实现**：
- 读取章节内容（chapter.read 逻辑）
- 实例化 ReviserAgent + ContinuityAuditor
- 调用 ReviserAgent.revise()
- 将修订结果写回章节文件
- 返回修订摘要（修了什么、字数变化、审计结果）

**验证**：Agent 调用后，章节文件内容已更新，审计通过。

### R2: pipeline.import_chapters — 整书导入

**用户场景**：用户上传了一个 txt 文件，说"帮我导入这本书"

**输入**：
```
{
  bookId: string (required)
  filePath: string (required) — 服务器上的文件路径
  splitPattern: string (optional) — 章节分割正则
}
```

**实现**：
- 读取文件内容
- 用 splitChapters() 分章
- 调用 ArchitectAgent.generateFoundationFromImport() 生成基础设定
- 调用 tryGenerateStyleGuide() 提取文风
- 逐章调用 ChapterAnalyzerAgent 分析并写入经纬
- 保存章节文件

**注意**：大文件（>500 章）需要分批处理，支持 resumeFrom 断点续传。

**验证**：导入后，chapters/ 目录有章节文件，经纬数据库有条目，style_guide.md 已生成。

### R3: style.import — 文风导入

**用户场景**：用户说"我想模仿耳根的文风，这是参考文本"

**输入**：
```
{
  bookId: string (required)
  referenceText: string (required, 至少 2000 字)
  sourceName: string (optional) — 参考来源名称
}
```

**实现**：
- 调用 StyleAnalyzer 提取统计特征（句长分布、用词偏好、节奏模式）
- 调用 LLM 生成定性文风描述
- 写入 story/style_profile.json + story/style_guide.md
- 返回文风摘要

**验证**：调用后 style_guide.md 存在且内容合理。

### R4: style.get_profile — 获取文风特征

**用户场景**：Agent 写作时需要知道当前书籍的文风基线

**输入**：
```
{
  bookId: string (required)
}
```

**实现**：
- 读取 story/style_profile.json
- 读取 story/style_guide.md
- 返回结构化的文风特征

**验证**：返回非空的文风数据。

### R5: rewrite.apply — 改写结果写回

**用户场景**：Agent 调用 rewrite.segment 后，用户确认要采纳改写结果

**输入**：
```
{
  bookId: string (required)
  chapterNumber: number (required)
  lineRange: { start: number, end: number } (required)
  newText: string (required) — 替换内容
  mode: "replace" | "insert_after" (默认 "replace")
}
```

**实现**：
- 读取章节文件
- 按行分割
- replace 模式：替换 start~end 行为 newText
- insert_after 模式：在 end 行后插入 newText
- 写回章节文件
- 返回成功摘要

**验证**：调用后章节文件内容已更新。

---

## 实施顺序

1. R5 rewrite.apply（最简单，纯文件操作）
2. R4 style.get_profile（纯读取）
3. R3 style.import（调用 StyleAnalyzer + LLM）
4. R1 pipeline.revise（调用 ReviserAgent）
5. R2 pipeline.import_chapters（最复杂，多步骤）

---

## 完成标准

每个工具：
1. tool-schemas.ts 中有 schema 定义
2. session-tool-executor.ts 中有 handler 实现
3. 在实际对话中让 Agent 调用一次，验证功能正常

---

## 完成状态

✅ 全部 5 个需求已实现（2026-05-31）
✅ PipelineRunner 已删除，Agent 工具层为唯一执行层
✅ Book lock 已加入 pipeline.generate_chapter
