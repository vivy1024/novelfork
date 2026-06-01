# Requirements: 约束驱动写作系统 v2

## Introduction

基于 Harness Engineering 和 CAAF 约束工程方法论，将 NovelFork 写作系统从"prompt 驱动希望模型做对"升级为"架构约束保证不可能做错"。核心改动：工具精简、管线从 5 步降到 3 步、经纬 Canon/Dynamic/Reference 三层分离、Scene Spec 作为硬约束、token 预算前置。

## Goals

1. 工具从 33 个精简到核心 10 个。
2. 管线从 5 次 LLM 调用降到 3 次。
3. 经纬分 Canon/Dynamic/Reference 三层，Canon 不可变。
4. Scene Spec 成为写章节的硬前置条件。
5. Token 预算从参数变为硬约束，超限直接拒绝。
6. 审计内嵌管线，不过不出。

## Non-Goals

1. 不改通用工具（Read/Write/Edit/Bash/Glob/Grep 等）。
2. 不改前端 UI 组件（本阶段只改后端管线和工具层）。
3. 不做向量检索或 GraphRAG。

## Hard Constraints

| ID | 约束 | 违反后果 |
|----|------|---------|
| H1 | 单次 prompt ≤ 模型窗口 × 80% | 拒绝构造，触发 compact |
| H2 | Canon 条目不可被新内容推翻 | 审计阻断，标记 canon violation |
| H3 | AI 生成只进候选区 | write 权限硬拦截 |
| H4 | 没有 Scene Spec 不能调 Writer | pipeline 入口拒绝 |
| H5 | 写章节前必须 PGI + 用户确认 | pipeline 入口拒绝 |
| H6 | 经纬写入只走工具 | permission deny |
| H7 | 角色不能知道视角外信息 | 审计标记 POV violation |

## Requirements

### R1. 工具精简

核心写作工具 10 个：
- `cockpit.snapshot`（合并原 3 个）
- `jingwei.read`（合并 brief/category/search）
- `jingwei.write`（rename upsert_entry）
- `pgi.ask`（合并 generate/record/format）
- `scene.spec`（新：生成结构化写作蓝图）
- `pipeline.write`（精简后的写章节）
- `chapter.read`
- `chapter.audit`（含角色一致性）
- `rewrite.segment`
- `hooks.manage`

### R2. 管线精简为 3 步

1. SceneSpec（合并 Planner+Composer）→ 结构化蓝图
2. Writer → 正文生成
3. AuditRevise（合并 Auditor+Reviser）→ 审计+修订

### R3. 经纬三层分离

- Canon：premise/world-rules/book-rules/timeline-facts，不可变
- Dynamic：character-state/active-hooks/active-conflicts/chapter-summaries，每章更新
- Reference：detailed profiles/locations/factions/power-system，按需查阅

### R4. Scene Spec 硬约束

格式：
```yaml
chapter: N
title: string
wordTarget: number
scenes:
  - characters: string[]
    location: string
    conflict: string
    mood: string
    outcome: string
    hooks_used: string[]
    hooks_planted: string[]
constraints: string[]
```

### R5. Token 预算硬约束

- System+Tools: ≤ 8K
- Context: ≤ 8K
- 工具结果: ≤ 2K/条
- History: 动态分配剩余
- 超 80% 触发 compact
- 超 95% emergency truncate

### R6. 审计内嵌门禁

- Hard violation → 阻断，返回规则 ID + 位置
- Soft violation → 自动修订一次
- 修订后仍违反 → 标记但不阻断，交用户决定
