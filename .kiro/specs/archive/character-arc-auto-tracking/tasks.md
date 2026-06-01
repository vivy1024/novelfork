# Implementation Plan

## Overview

实现角色弧线自动追踪：pipeline post-write hook 触发规则引擎提取 beat，可选 LLM 精细分析增强，结果写入 bible_character_arc 表。

## Tasks

- [x] 1. **规则引擎核心** — 新建 `packages/core/src/tools/arcs/rule-engine.ts`，实现 `extractBeatsFromChapter(content: string, characters: Character[]): ArcBeat[]`。包含情绪/事件关键词库、角色名匹配（支持别名）、direction 极性判定逻辑
- [x] 2. **arc-sync 主函数** — 新建 `packages/core/src/tools/arcs/arc-sync.ts`，实现 `syncCharacterArcs(bookId, chapterNumber, chapterContent, options: { mode: "off"|"rule"|"llm" })`。负责加载已注册角色、调用规则引擎、去重、写入 SQLite
- [x] 3. **LLM refiner** — 新建 `packages/core/src/tools/arcs/llm-refiner.ts`，实现 `refineBeatsWithLlm(content, characters, ruleBeats): ArcBeat[]`。构造 prompt、调用 LLM、解析输出、合并结果
- [x] 4. **ArcBeat 类型扩展** — 修改 `packages/core/src/tools/arcs/arc-types.ts`，在 ArcBeat 接口中添加 `source: "manual" | "auto-rule" | "auto-llm"` 和 `confidence?: number` 字段
- [x] 5. **Pipeline hook 接入** — 修改 `packages/core/src/agents/writer.ts` 的 `saveNewJingweiFiles` 方法末尾（或 pipeline runner 的 post-write 阶段），添加 `await syncCharacterArcs(...)` 调用，用 try-catch 包裹确保不阻塞写作流程
- [x] 6. **设置项添加** — 修改 `packages/studio/src/types/settings.ts`，在 RuntimeControlSettings 中添加 `arcTrackingMode: "off" | "rule" | "llm"`（默认 "rule"）；修改 `user-config-service.ts` 添加默认值和校验
- [x] 7. **设置 UI** — 修改 `packages/studio/src/app-next/settings/SettingsSectionContent.tsx`，在 runtimeControls 区域添加"角色弧线追踪"三选一下拉
- [x] 8. **前端 beat 来源标记** — 修改 `packages/studio/src/app-next/writing-workbench/CharacterArcsPanel.tsx`，在 beat 时间线中显示来源标记（手动/自动规则/自动LLM），不同来源用不同颜色 Badge
- [x] 9. **检测工具集成** — 在 `arc-sync.ts` 的 beat 写入后调用 `detectArcInconsistency` 和 `detectStagnantArc`，将结果作为 warnings 返回
- [x] 10. **typecheck + 测试** — 运行 typecheck 确认无错误；为规则引擎编写单元测试（给定章节文本和角色列表，验证提取的 beat 正确）
