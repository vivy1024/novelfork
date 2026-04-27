# Implementation Plan

## Overview

本任务文件从已批准的 `writing-modes-v1` spec 生成。目标是实现六种精细化 AI 写作模式（选段续写/场景扩写/对话生成/多版本对比/段落补写/大纲分支）和作品导入增强（文件拖放/多作品文风合并/文风漂移检测）。

关键执行原则：

- 所有写作模式共享已有的上下文注入管线（`prepareWriteInput` / `buildBibleContext` / `composeBibleContext`），不重复造轮子。
- 所有模式的结果是"建议"，作者可接受/编辑/丢弃，不自动修改正文。
- 选段操作不触发真相文件更新（只有整章完成才更新真相）。
- 大纲分支保存为独立文件，不覆盖当前大纲。

执行边界更新（2026-04-27）：

- Tasks 1-11 可继续作为核心能力与 API 底座推进。
- Tasks 12-16 不再接入旧 `BookDetail` / `ChapterReader` / 旧 `App.tsx` 页面，只作为新创作工作台的可复用组件或交互能力输入。
- 选段续写、扩写、补写、多版本、对话生成、大纲分支、作品导入的最终挂载位置是 `studio-frontend-rewrite` 的创作工作台：编辑器浮动工具栏、右侧 AI 面板、候选稿对照区和资源管理器导入入口。
- 若实现 UI 组件，应保持无旧路由依赖、无旧页面布局假设，等待新前端统一挂载。

## Tasks

- [ ] 1. 定义写作模式类型系统
  - 新增 `packages/core/src/agents/inline-writer.ts` 类型定义。
  - 定义 `InlineWriteMode`、`InlineWriteInput`、`InlineWriteResult`、`ContinuationInput`、`ExpansionInput`、`ExpansionResult`、`BridgeInput`。
  - 定义 `InlineWriteContext` 和 `buildInlineWriteContext()` 函数，复用已有管线。
  - 覆盖 Requirement 8。

- [ ] 2. 实现选段续写
  - 在 `packages/core/src/agents/inline-writer.ts` 中实现 `InlineWriterAgent`。
  - 实现 `continueFromSelection(input, context)` 方法。
  - 注入 beforeText（最后 3000 字）+ selectedText + direction + style_guide + book_rules + 预设。
  - 输出 500-1500 字续写内容。
  - 添加单测（mock LLM）：输出字数在范围内、context 包含必要字段。
  - 覆盖 Requirements 1、8。

- [ ] 3. 实现场景扩写
  - 在 `InlineWriterAgent` 中实现 `expandScene(input, context)` 方法。
  - 支持 5 种扩写方向：sensory/action/psychology/environment/dialogue。
  - 保持原段核心事件不变，只增加细节。
  - 输出包含 originalWordCount、expandedWordCount、expansionRatio。
  - 添加单测：原文事件保留、字数达标、扩写方向注入 prompt。
  - 覆盖 Requirements 2、8。

- [ ] 4. 实现段落补写
  - 在 `InlineWriterAgent` 中实现 `bridgeParagraphs(input, context)` 方法。
  - 读取前后段落作为上下文。
  - 支持 4 种补写目的：scene-transition/time-skip/emotional-transition/suspense-setup。
  - 输出 100-500 字过渡段落。
  - 添加单测：读取前后段、输出作为桥梁段、不重复前后内容。
  - 覆盖 Requirements 5、8。

- [ ] 5. 实现对话生成
  - 新增 `packages/core/src/agents/dialogue-generator.ts`。
  - 实现 `DialogueGeneratorAgent.generateDialogue(input, context)` 方法。
  - 从 `character_matrix.md` 和经纬中读取角色性格、说话风格。
  - 复用 `extractDialogueFingerprints` 提取最近章节的对话特征。
  - 遵守 style_guide 的对话风格描述。
  - 输出 `DialogueLine[]` + 格式化文本。
  - 添加单测：角色数量匹配、轮数匹配、格式正确。
  - 覆盖 Requirements 3、8。

- [ ] 6. 实现多版本对比生成
  - 新增 `packages/core/src/agents/variant-generator.ts`。
  - 实现 `VariantGeneratorAgent.generateVariants(input, context)` 方法。
  - 并行调用 LLM N 次（默认 3），每次使用不同的 system prompt 变体。
  - 为每个版本自动生成标签（"更克制"/"更激烈"/"更口语化"等）。
  - 计算与原文的关键差异。
  - 添加单测：版本数量正确、版本间有差异、标签非空。
  - 覆盖 Requirements 4、8。

- [ ] 7. 实现大纲续写与分支
  - 新增 `packages/core/src/agents/outline-brancher.ts`。
  - 实现 `OutlineBrancherAgent.generateBranches(input)` 方法。
  - 读取 volume_outline + pending_hooks + current_state + chapter_summaries。
  - 生成 2-3 条走向建议，每条标注消耗/新增的伏笔。
  - 实现 `expandBranch(branchId)` 将选中走向扩展为完整大纲。
  - 分支大纲保存为 `volume_outline_branch_{id}.md`。
  - 添加单测：走向数量正确、伏笔标注、扩展后格式正确。
  - 覆盖 Requirements 6、8。

- [ ] 8. 实现作品导入文件解析
  - 新增 `packages/core/src/tools/import/file-parser.ts`。
  - 支持 `.txt`（按空行分章）、`.docx`（mammoth 提取文本）、`.epub`（基础 epub 解析）。
  - 统一输出 `{ chapters: Array<{ title, content }> }` 格式。
  - 添加单测：各格式解析正确、空文件安全、大文件截断。
  - 覆盖 Requirements 7、8。

- [ ] 9. 实现多作品文风合并
  - 新增 `packages/core/src/tools/import/multi-work-style.ts`。
  - 实现 `mergeStyleProfiles(profiles)` 合并多个 StyleProfile。
  - 计算交集特征：共同修辞、共同句长范围、共同词汇多样性范围。
  - 生成统一的个人风格 profile（`PersonalStyleProfile`）。
  - 可选调用 LLM 生成合并的 style_guide 文本。
  - 添加单测：合并统计正确、交集特征提取、空输入安全。
  - 覆盖 Requirements 7、8。

- [ ] 10. 实现文风漂移检测
  - 新增 `packages/core/src/tools/import/style-drift-detector.ts`。
  - 实现 `detectStyleDrift(currentProfile, baseProfile)` 计算漂移。
  - 偏差指标：句长偏差%、词汇多样性偏差%、综合偏差。
  - 综合偏差 > 0.3 标记为显著漂移。
  - 添加单测：无漂移→0、大幅漂移→高偏差、阈值判断。
  - 覆盖 Requirements 7、8。

- [ ] 11. 实现写作模式 API 路由
  - 新增 `packages/studio/src/api/routes/writing-modes.ts`：
    - `POST /api/books/:bookId/inline-write`：续写/扩写/补写（body.mode 区分）。
    - `POST /api/books/:bookId/dialogue/generate`：对话生成。
    - `POST /api/books/:bookId/variants/generate`：多版本生成。
    - `POST /api/books/:bookId/outline/branch`：大纲分支。
    - `POST /api/books/:bookId/outline/branch/:branchId/expand`：扩展分支。
    - `POST /api/works/import`：导入作品。
    - `GET /api/style/personal-profile`：获取个人风格 profile。
    - `POST /api/books/:bookId/style/drift-check`：文风漂移检测。
  - 所有 AI 相关路由走 AI gate。
  - 添加 API 测试。
  - 覆盖 Requirements 1-7、8。

- [ ] 12. 实现选段续写 / 扩写 / 补写可复用 UI（迁入新创作工作台，不接旧前端页面）
  - 新增 `packages/studio/src/components/writing-modes/InlineContinuation.tsx`。
  - 新增 `packages/studio/src/components/writing-modes/SceneExpander.tsx`。
  - 新增 `packages/studio/src/components/writing-modes/ParagraphBridge.tsx`。
  - 选中文本 → 浮动工具栏 → 续写/扩写/多版本。
  - 光标在段落间 → 行间按钮 → 补写。
  - 结果预览：前文灰色 + 生成内容蓝色高亮 + 后文灰色。
  - 操作按钮：接受 / 编辑后接受 / 重新生成 / 丢弃。
  - 使用 shadcn/ui Card + Button + Textarea + Badge。
  - 添加组件测试。
  - 覆盖 Requirements 1、2、5、8。

- [ ] 13. 实现对话生成可复用 UI（迁入新创作工作台，不接旧前端页面）
  - 新增 `packages/studio/src/components/writing-modes/DialogueGenerator.tsx`。
  - 角色选择（从 character_matrix 多选）+ 场景描述 + 对话目的 + 轮数。
  - 结果展示：角色彩色标签 + 台词 + 可逐句编辑。
  - 确认后插入光标位置。
  - 使用 shadcn/ui Card + Select + Badge + Textarea + Button。
  - 添加组件测试。
  - 覆盖 Requirements 3、8。

- [ ] 14. 实现多版本对比可复用 UI（迁入新创作工作台，不接旧前端页面）
  - 新增 `packages/studio/src/components/writing-modes/VariantCompare.tsx`。
  - Tab 切换或并排展示各版本。
  - 高亮与原文的差异。
  - 每个版本标签 + 特点说明。
  - 支持选择整个版本或逐句挑选组合。
  - 使用 shadcn/ui Tabs + Card + Badge + Button + Diff 高亮。
  - 添加组件测试。
  - 覆盖 Requirements 4、8。

- [ ] 15. 实现大纲分支可复用 UI（迁入新创作工作台，不接旧前端页面）
  - 新增 `packages/studio/src/components/writing-modes/OutlineBrancher.tsx`。
  - 展示 2-3 条走向卡片：核心冲突 + 转折点 + 预计章数 + 消耗伏笔。
  - 选择走向 → 扩展为完整大纲 → 保存为分支。
  - 分支管理：查看/切换/删除分支。
  - 使用 shadcn/ui Card + RadioGroup + Badge + Button + Accordion。
  - 添加组件测试。
  - 覆盖 Requirements 6、8。

- [ ] 16. 实现作品导入可复用 UI（迁入新创作工作台，不接旧前端页面）
  - 新增 `packages/studio/src/components/writing-modes/WorkImporter.tsx`。
  - 拖放区域 + 粘贴文本。
  - 导入目的选择：只分析文风 / 续写。
  - 已导入作品列表 + 文风摘要。
  - 生成个人风格 Profile 按钮。
  - 使用 shadcn/ui Card + RadioGroup + Table + Badge + Button + Dialog。
  - 添加组件测试。
  - 覆盖 Requirements 7、8。

- [ ] 17. 执行验证
  - 运行 `pnpm typecheck` 和 `pnpm test`。
  - 真实烟测：选段续写 → 预览 → 接受 → 正文更新。
  - 真实烟测：场景扩写 → 原文保留 → 细节增加。
  - 真实烟测：对话生成 → 角色正确 → 插入正文。
  - 真实烟测：多版本 → 3 个版本 → 选择替换。
  - 真实烟测：导入 txt → 分析文风 → 个人 profile。
  - 真实烟测：大纲分支 → 选择走向 → 扩展为大纲。
  - 覆盖 Requirement 8。

## Done Definition

- 选段续写生成 500-1500 字，保持上下文连贯。
- 场景扩写保持原文事件不变，字数达标。
- 对话生成符合角色性格，轮数正确。
- 多版本生成 2-5 个不同版本，各有标签和差异标注。
- 段落补写衔接前后段，不重复内容。
- 大纲分支生成 2-3 条走向，可扩展为完整大纲。
- 作品导入支持 .txt/.docx/.epub，可合并多作品文风。
- 文风漂移检测偏差计算正确，超阈值有提醒。
- 所有模式共享上下文注入管线，走 AI gate。
- 相关测试、typecheck 通过。
