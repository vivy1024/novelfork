# Implementation Plan

## Overview

本计划实现 `writing-panel-triage` spec 的裁决产物：建立 archive 15 个孤儿面板的去向清单、入口约束和后续 spec 边界。该 spec 不实现 UI 迁移、不删除组件、不恢复雷达、不整合作品诊断、不改章节编辑器，也不改工具定义或 Agent prompt。

## Tasks

- [ ] 1. 建立面板裁决清单源文件
  - 新增一个轻量清单文件，用于记录 `archive/cockpit-panel-layout` 中面板的裁决结果；建议位置：`packages/novel-plugin/src/pages/writing-workbench/panel-triage.ts` 或同等 shared metadata 文件。
  - 每项包含：id、displayName、decision、reason、targetOwner、allowedGlobalEntry。
  - 只记录元数据，不接 UI。
  - 覆盖：R1、R7、设计“面板裁决总表”。

- [ ] 2. 写入“不需要独立入口”裁决
  - 在清单中标记以下能力不得作为 IDE 左侧全局入口：`StatCard`、`DailyProgressCard`、`BookHealthSummary`、`ChapterHealthCard`、`AiTasteReport`、`BeatProgressBar`、`PresetSuggestionCard`、`ConversationResourcePanel`、`InlineWritePanel`、`VariantsPanel`。
  - 对 `InlineWritePanel`、`VariantsPanel` 明确 reason：核心能力保留，但只能作为章节/候选稿上下文工具。
  - 覆盖：R2、R5。

- [ ] 3. 写入 Narrative Memory 相关 defer 裁决
  - 在清单中标记：`CharacterArcsPanel`、`ForeshadowingBoard`、`JingweiGraphWorkspace` 关系图/时间线/矛盾地图、`CoreShiftPanel`、`RuntimeStatePanel` 属于 Narrative Memory / 动态状态方向，实际迁移由 `lore-memory-boundary` 或后续任务处理。
  - 明确这些能力不得被诊断、市场、章节工具 spec 接管。
  - 覆盖：R3、设计“与 Narrative Memory 的边界”。

- [ ] 4. 写入诊断类 defer / merged 裁决
  - 在清单中标记：`QualityPanel`、`BookHealthSummary`、`StyleDriftPanel`、`CompliancePanel`、`AlertPanel`、全书 `AiTasteReport`、`ChapterHealthCard` 摘要属于作品诊断方向。
  - 明确这些能力不属于 Narrative Memory，后续应由作品诊断 spec 处理。
  - 覆盖：R4。

- [ ] 5. 写入章节上下文工具裁决
  - 在清单中标记：`SceneSpecPanel`、`InlineWritePanel`、`VariantsPanel`、`ChapterHealthCard`、单章 `AiTasteReport` 只能在当前章节上下文中使用。
  - 若后续命令面板引用这些能力，必须要求当前章节上下文。
  - 覆盖：R5。

- [ ] 6. 写入方法、预设、市场类 defer 裁决
  - 在清单中标记：`PresetsPanel`、`PresetSuggestionCard`、`TemplateMarketPanel`、市场雷达/扫榜属于后续方法与市场方向。
  - 明确这些能力不属于 Narrative Memory。
  - 覆盖：R6。

- [ ] 7. 增加防漂移测试：左侧全局入口不得接入被禁止面板
  - 针对 IDE ActivityBar / Sidebar view / command registry 或 panel registry 增加测试。
  - 断言 `InlineWritePanel`、`VariantsPanel`、`DailyProgressCard`、`BookHealthSummary`、`PresetSuggestionCard`、`ConversationResourcePanel` 不作为左侧全局入口出现。
  - 若当前没有统一 registry，则测试清单 metadata 的 `allowedGlobalEntry === false`，并在后续 UI registry 引用此清单。
  - 覆盖：R2、R7。

- [ ] 8. 增加防漂移测试：Narrative Memory 禁止混入非记忆能力
  - 测试 Narrative Memory 允许项只包含记忆总览、召回 diagnostics、Pending Events、关系图、时间线、角色弧线、伏笔网络、矛盾地图、事件链等记忆能力。
  - 断言质量诊断、AI 味、文风漂移、平台合规、市场雷达、扫榜、预设市场、选段写作、多版本、章节蓝图、章节健康不属于 Narrative Memory 入口清单。
  - 覆盖：R1、R3、R4、R6。

- [ ] 9. 增加防漂移测试：章节上下文工具不作为全局入口
  - 测试 `SceneSpecPanel`、`InlineWritePanel`、`VariantsPanel`、`ChapterHealthCard`、单章 `AiTasteReport` 的 decision 为 `contextual-only`。
  - 若已有命令注册，断言命令 metadata 包含 requiresCurrentChapter 或同等标记。
  - 覆盖：R5。

- [ ] 10. 更新 archive 面板引用说明
  - 在 `.kiro/specs/README.md` 或适合的开发文档中补充：后续引用 archive `cockpit-panel-layout` 的 15 面板时，必须先看 `writing-panel-triage` 的裁决表。
  - 不修改 archive 原文，避免篡改历史记录。
  - 覆盖：R7。

- [ ] 11. 运行最小验证
  - 运行与新增清单/测试相关的测试。
  - 运行 `bun run typecheck` 或受影响 package typecheck。
  - 本 spec 无 UI 实现要求，因此不要求 Browser 截图；若改动触及可见入口，则必须补 Browser 截图。
  - 覆盖：Success Criteria。

- [ ] 12. 记录后续 spec 拆分建议
  - 在任务完成说明或 Engram 中记录后续四条独立线：`lore-memory-boundary`、作品诊断、章节编辑器上下文工具、方法/预设/市场。
  - 明确本 spec 只完成裁决和防漂移，不代表这些后续功能已实现。
  - 覆盖：设计“后续 spec 拆分建议”。
