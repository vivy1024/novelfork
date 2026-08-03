---
title: 写作技能 (Writing Skills)
summary: 取代旧 Preset/Beat 的写作规则系统，支持合规检查、文件树浏览与作品级物化
tags: [写作技能, Skills, 合规, 文风, 规则, SKILL.md]
routes:
  - /next/books/:bookId
  - /next/routines
---

# 写作技能 (Writing Skills)

> Writing Skills 是 NovelFork v3.3 起的正式写作配置入口，取代旧的 Preset 和 Beat Template 流程。

## 核心概念

**Writing Skill** 是一个包含 `SKILL.md`（Frontmatter + Prompt）的独立文件夹。每个 Skill 定义了一组写作规则、合规检查或结构模板，Agent 在写作时会遵守已启用的 Skills。

| 字段 | 说明 |
|------|------|
| `id` | 全局唯一标识 |
| `name` | 显示名称 |
| `kind` | 类型：`style` / `workflow` / `character` / `plot` / `structure` |
| `mode` | `always`（始终生效）/ `manual`（书籍级启用） |
| `checks` | 声明式合规检查规则（required-terms / forbidden-terms / pattern） |

## 三级来源

| 来源 | 路径 | 优先级 |
|------|------|--------|
| 内置 | 产品 `skills/` 目录（编译时内联） | 最低 |
| 作者级 | `~/.novelfork/skills/<slug>/` | 中（同 slug 覆盖内置） |
| 作品级 | 作品根目录 `.novelfork/skills/<slug>/` | 最高 |

## 启用与物化

1. 在**写作配置 → 技能**中开启/关闭某个 Skill（开关只对当前书生效）。
2. 启用时系统自动将 `SKILL.md` 物化复制到作品的 `.novelfork/skills/<slug>/SKILL.md`。
3. 物化后的 Skill 文件随作品迁移，在作品内编辑不影响内置与全局版本。

## 文件树浏览与预览

在"套路 → 全局技能 / 作品技能"页面：
- 每个 Skill 卡片可点击展开文件树，列出内部所有文件。
- 点击文件名可在弹窗中在线预览 Markdown/代码源码。

## 合规检查 (Compliance Checks)

在 `SKILL.md` 的 `checks` 字段声明式定义规则：

```yaml
checks:
  - type: required-terms
    terms: ["伏笔", "节奏"]
    message: 本章缺少关键叙事要素
  - type: forbidden-terms
    terms: ["不禁", "莫名"]
    severity: error
  - type: pattern
    pattern: "(.)\1{4,}"
    message: 连续重复超过 4 次
```

写作结束后系统自动执行合规检查，违规项会在写作视图中提示修正。

## 推荐使用流程

1. 写作配置 → 技能 → 按题材/风格启用适合的 Skills
2. 如需自定义：编辑任意内置 Skill → 自动 fork 到 `~/.novelfork/skills/` 作为个人副本
3. 作品级覆盖：在作品 `.novelfork/skills/` 下手动修改，只影响当前书

## 与旧 Preset/Beat 的关系

| 旧概念 | 新对应 |
|--------|--------|
| Preset | `kind: style` 的 Writing Skill |
| Beat Template | `kind: structure` + `kind: plot` 的 Writing Skill |
| 自定义 Preset | 编辑 Skill → fork 到作者目录 |
| 全局启用 | `mode: always` |
| 书籍级启用 | `mode: manual` + 写作配置开关 |

旧 `enabledPresetIds` / `beatTemplateId` 字段在首次写入 Writing Skills 时自动迁移。
