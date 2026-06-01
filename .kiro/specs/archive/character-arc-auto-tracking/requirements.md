# 角色弧线自动追踪

## 概述

写完章节后自动提取角色弧线 beat，更新 SQLite `bible_character_arc` 表。默认使用规则引擎（零 LLM 成本），可选开启 LLM 精细分析增强。

## 用户故事

1. 作为作者，我希望每写完一章后系统自动识别角色状态变化，不需要手动维护角色弧线
2. 作为作者，我希望在 CharacterArcsPanel 中看到自动生成的 beat 时间线
3. 作为作者，我希望可以在设置中选择是否启用 LLM 精细分析（更准确但有成本）
4. 作为作者，我希望自动生成的 beat 标记为"自动"，与手动添加的区分

## 功能需求

### FR-1: Pipeline Post-Write Hook

- 在 `writer.saveNewJingweiFiles()` 之后触发 `syncCharacterArcs(bookId, chapterNumber, chapterContent)`
- 适用于 `writeDraft`、`writeNextChapter`、`reviseDraft` 三个 pipeline 入口
- hook 失败不阻塞写作流程（catch + log warning）

### FR-2: 规则引擎 Beat 提取（默认）

- 扫描章节正文，匹配已注册角色名（从 `bible_character` 表获取）
- 对每个出场角色，检测：
  - 情绪/状态变化关键词（愤怒/悲伤/觉醒/突破/背叛/和解/死亡...）
  - 冲突事件（对抗/争吵/战斗/逃跑/牺牲...）
  - 关系变化（结盟/决裂/从属/救助...）
- 生成 beat：`{ chapterNumber, characterId, direction, summary, source: "auto-rule" }`
- direction 判定：growth / regression / neutral（基于关键词极性）

### FR-3: LLM 精细分析（可选增强）

- 设置项：`runtimeControls.arcTrackingMode: "rule" | "llm" | "off"`
- 当 `arcTrackingMode === "llm"` 时，在规则引擎之后调用 LLM：
  - 输入：章节正文 + 角色已有弧线 + 规则引擎初步结果
  - 输出：校验/修正 beat 的 direction 和 summary，补充规则引擎遗漏的角色
- LLM 生成的 beat 标记为 `source: "auto-llm"`

### FR-4: Beat 写入与去重

- 写入 `bible_character_arc.key_turning_points_json`（追加，不覆盖）
- 去重：同一章节同一角色不重复生成 beat（幂等）
- 如果角色尚无弧线记录，自动创建一条 `arc_type: "unknown"` 的弧线

### FR-5: 检测工具集成

- 在 beat 写入后运行 `detectArcInconsistency` 和 `detectStagnantArc`
- 检测结果写入审计报告（如果有活跃审计）或作为 warning 返回给调用方

### FR-6: 前端展示增强

- CharacterArcsPanel 中 beat 时间线标记来源（手动 / 自动规则 / 自动LLM）
- 自动生成的 beat 可以被用户编辑或删除

### FR-7: 设置 UI

- 在设置页面 runtimeControls 区域添加"角色弧线追踪"选项：
  - 关闭（off）
  - 规则引擎（rule）— 默认
  - LLM 增强（llm）

## 非功能需求

- 规则引擎处理一章 < 100ms
- LLM 分析不阻塞 pipeline（异步或 post-write 阶段）
- beat 数据向后兼容（不破坏已有手动添加的 beat）

## 验收标准

1. 写完一章后 `bible_character_arc` 表自动新增 beat 记录
2. CharacterArcsPanel 展示自动生成的 beat
3. 设置为 "off" 时不触发任何追踪
4. 设置为 "llm" 时调用 LLM 并生成更精确的 beat
5. 重复执行同一章不会产生重复 beat
