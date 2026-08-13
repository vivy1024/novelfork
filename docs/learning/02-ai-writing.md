---
title: AI 写作功能
summary: 选段写作、多版本变体、正式章节结果流程、Writing Skills 与节奏预算
tags: [AI写作, 正式章节, 续写, 扩写, 变体, WritingSkills, 节奏预算]
routes:
  - /next/books/:bookId
---

# AI 写作功能

> 选段写作、多版本变体、正式章节结果流程、Writing Skills 与节奏预算。

## 核心概念

**选段写作**：选中文本后执行续写（从光标处继续）、扩写（展开细节）、补写（两段之间插入过渡）。结果进入正式章节结果或预览边界，不静默覆盖正文。

**多版本变体**：同一段落生成 2-4 个不同风格版本，并排对比后选择最满意的。

**正式章节结果**：AI 生成后的稳定正文层。AI 生成 → 正式章节 artifact/画布 → 你审阅和继续编辑。AI 不创建 candidate/draft 主对象。

**写作预设**：已由 Writing Skills 统一取代，不再单独维护预设条目。

**Writing Skills**：不是独立注入概念，就是技能落盘加生效证据。NovelFork 内置 377 个自研技能（nf- 编号，覆盖开篇/节奏/人物/情节/文笔/审校/平台/包装/调研/流程十类），启用后物化到作品目录 `.novelfork/skills/<slug>/SKILL.md`（含 references 附件），Runtime 自动扫描，叙述者按普通 Skill 读取。写章前由同一 Runtime 会话先调用 Skill 工具读取相关技能；写后按技能规则硬校验（`writing-skills.check_compliance`）。带 `checks` 声明的技能（去AI味、元信息扫描、章末钩子等）可被机器逐条校验，其余方法论文本由 Agent 按技能执行。

**节拍模板**：已由 Writing Skills 取代；旧数据可用 `writing-skills.import_legacy` 迁移。

**上下文组装**：系统自动按优先级注入——经纬条目 → 前文摘要 → 驾驶舱快照 → PGI 回答 → Scene Spec 蓝图。Writing Skills 不走这条通道，由叙述者自己读磁盘上的 SKILL.md。

## 写作工具一览

| 工具 | 适用场景 | 说明 |
|------|---------|------|
| `pipeline.write` | 写下一章 | 校验并保存 Runtime Agent 提交的正文：写前门→落盘→章后结算 |
| `chapter.audit` | 定位整章问题 | 纯规则审计，不调模型 |
| `rewrite.apply` | 写回改写结果 | 按行范围替换或插入（改写文本由 Runtime Agent 提交） |
| `writing-skills.check_compliance` | 按启用技能审正文 | 规则校验，硬性违规会阻断保存 |
| `writing-skills.write` | 创建/启用文风技能 | 文风以 Writing Skill 落盘，写前由 Runtime Skill 机制读取 |

去 AI 味不再有独立工具或模式：由 story-deslop Writing Skill 承担。内部调模型的选段改写、文风导入与大纲建议等旧工具已下线，相关结果由同一 Runtime Agent 直接生成后经 `rewrite.apply` / `writing-skills.write` 落盘。

## 推荐使用流程

1. 选择写作动作：续写/扩写/补写，或"生成下一章"走完整管线
2. 回答 PGI 追问：告诉 AI 这段/章想要什么效果、情绪、节奏
3. 审阅章节结果：在画布中查看生成结果，可生成变体对比
4. 采纳或修订：接受满意版本，或拒绝后重新生成

## 最佳实践

- 用"生成下一章"而非"续写片段"，前者走完整 PGI + SceneSpec + pipeline 流程，质量更高
- 不确定方向时先生成变体对比，再决定采纳哪个
- 一部作品尽量固定一套 Writing Skills，避免前后文风不一致
- 让叙述者帮你选技能："帮我选择适合玄幻的写作技能"（`writing-skills.recommend`）

## 常见坑

- **生成内容重复前文** → 上下文中前文摘要太长，手动精简
- **章节结果字数不达标** → 先看 `scene.spec` 的情节点预算是否合规；预算合计低于章目标时 `pipeline.write` 会以 `beat-budget-invalid` 拒绝执行，需回去把密点拆细
- **风格漂移** → Writing Skills 中途切换导致，固定一套技能
- **启用了技能但看起来没生效** → 确认当前会话先用 Skill 工具读取了 `.novelfork/skills/<slug>/SKILL.md`（写前 preflight 会提示相关技能未加载）；违规项会出现在 `publishHint.warnings`
- **提示正文已保存但结算失败** → 返回 `settlementError` 时对该章执行 `memory.settle_range` 补结算

## Agent 查阅提示

- 生成结果通过 `pipeline.write` 进入正式章节结果；禁止创建 candidate/draft 主对象或绕过确认静默覆盖用户正文
- 上下文组装顺序固定：经纬 → 前文摘要 → 驾驶舱快照 → PGI → SceneSpec
- Writing Skills 落盘在作品的 `.novelfork/skills/`，写章前必须先用 Skill 工具读取相关技能；同一会话的 Skill 调用记录是生效证据
- 变体生成时每个变体独立走完整管线，共享上下文但 temperature 不同
- 文风以 Writing Skill 落盘并启用（`writing-skills.write`），写前由 Runtime Skill 机制加载

## 可跳转功能入口

- 写作工作台: 选段写作、章节结果审阅、变体对比的主界面。 (/next/books/:bookId)
