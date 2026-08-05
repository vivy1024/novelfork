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
| `mode` | `always`（始终生效）/ `manual`（项目级启用） |
| `checks` | 声明式合规检查规则（required-terms / forbidden-terms / pattern） |

## 三级来源

| 来源 | 路径 | 优先级 |
|------|------|--------|
| 内置 | 产品 `skills/` 目录（编译时内联） | 最低 |
| 作者级 | `~/.novelfork/skills/<slug>/` | 中（同 slug 覆盖内置） |
| 作品级 | 作品根目录 `.novelfork/skills/<slug>/` | 最高；文件自动发现 |

## 作品级自动发现与文件操作

1. `.novelfork/skills/<slug>/SKILL.md` 是作品级 Writing Skill 的唯一规范路径；Runtime、preflight、工具解析和 UI 都直接扫描该目录。
2. 目录中的每个技能文件都会自动解释并参与当前作品写作，文件是否存在就是生效状态，不需要 `book.json` 字段绑定。
3. 写作配置面板的开关只负责对 catalog Skill 执行文件增删；刷新操作才会用 catalog 原文覆盖已有项目文件。
4. 作品内直接编辑 `SKILL.md` 或附件即可形成该作品的独立规则，作者级覆盖和内置版本不会被反向修改。

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

1. 写作配置 → 技能 → 按题材/风格将 catalog Skill 添加到当前作品
2. 如需自定义：编辑任意内置 Skill → 自动 fork 到 `~/.novelfork/skills/` 作为个人副本
3. 作品级规则：直接在作品 `.novelfork/skills/` 下新增或修改 `SKILL.md`，Runtime 会自动发现，只影响当前作品

## 与旧 Preset/Beat 的关系

| 旧概念 | 新对应 |
|--------|--------|
| Preset | `kind: style` 的 Writing Skill |
| Beat Template | `kind: structure` + `kind: plot` 的 Writing Skill |
| 自定义 Preset | 编辑 Skill → fork 到作者目录 |
| 全局启用 | `mode: always` |
| 作品级生效 | `mode: manual` + `.novelfork/skills/` 中存在对应文件 |

`book.json` 不保存 Writing Skill 的启用列表；旧 `enabledWritingSkillIds`、`enabledPresetIds`、`beatTemplateId` 等字段不参与运行时判定。
