# 智能预设系统 — 需求文档

## 背景

NovelFork 有完整的预设系统（6 大类 50+ 预设：文风/时代基底/去AI味/文学技法/逻辑风险/套装），每个预设有 `promptInjection` 字段。但当前存在两个断裂：

1. **Agent 对话模式不注入预设** — `candidate.create_chapter` 走简化路径，不读取 `enabledPresetIds`
2. **用户需要手动选预设** — 预设系统对普通作者太复杂，不知道该选什么

本 spec 用反思模型替代用户做预设决策，实现"AI 自动选预设 → 注入生成 prompt"的闭环。

---

## Phase 1：预设注入修复（P0）

### 1.1 candidate.create_chapter 注入已启用预设

**现状**: `createRuntimeGenerator` 的 system prompt 不包含任何预设 promptInjection
**目标**: 读取书籍的 `enabledPresetIds`，解析对应预设，注入到生成 prompt

**实现方案**:
- `candidate-tool-service.ts` 中 `createRuntimeGenerator` 执行前：
  1. 从 book config 读取 `enabledPresetIds`
  2. 从预设注册表解析每个 ID 的 `promptInjection`
  3. 拼接为 `\n\n写作规则：\n- rule1\n- rule2\n...`
  4. 注入到 system prompt 中

### 1.2 建书时自动启用对应套装

**现状**: 向导完成后不自动启用预设
**目标**: 根据向导选择的题材，自动启用对应套装预设

**实现方案**:
- `guided-setup` 接口中，根据 `answers.genre.value` 映射到套装 ID：
  - 玄幻 → xuanhuan-bloodline
  - 仙侠 → classical-travel-xianxia 或 mortal-sect-xianxia
  - 都市 → system-satire（如果选了讽刺基调）
  - 科幻 → near-future-industrial-scifi
  - 末日 → apocalypse-survival
  - 等等
- 写入 book config 的 `enabledPresetIds`

---

## Phase 2：反思模型自动选预设（P1）

### 2.1 章节预设反思

**现状**: 预设是全书固定的，不能按章节动态调整
**目标**: 每次写下一章前，反思模型分析当前状态，建议本章额外启用的预设

**流程**:
```
用户说"写下一章"
    ↓
cockpit.get_snapshot（当前进度/伏笔/大纲）
    ↓
反思模型（summary model）快速分析：
  输入：当前章节号 + 大纲中本章定位 + 开放伏笔 + 已启用基础预设
  输出：本章建议额外启用的预设 ID 列表 + 理由
    ↓
合并基础预设 + 本章建议预设 → 注入 candidate.create_chapter prompt
```

**实现方案**:
- 在 `candidate.create_chapter` 执行前（或在 guided.exit 批准后）：
  1. 调用 summary model，prompt 包含：
     - 当前章节号和大纲中的定位
     - 所有可用预设列表（ID + 一句话描述）
     - 已启用的基础预设
     - 当前开放伏笔
  2. 要求输出 JSON：`{ "additionalPresets": ["preset-id-1", "preset-id-2"], "reason": "本章是高潮..." }`
  3. 解析结果，合并到 enabledPresetIds
  4. 失败时 fallback：只用基础预设
- 耗时预算：< 3 秒（summary model + 短 prompt）
- 结果可选展示给用户（"本章 AI 建议启用：爽点代价检查、情感具体化"）

### 2.2 驾驶舱"下一章建议"卡片

**现状**: 驾驶舱只显示进度数据，不给写作建议
**目标**: 驾驶舱显示"下一章建议"卡片，包含 AI 分析的本章方向

**内容**:
- 本章在大纲中的定位（铺垫/发展/高潮/过渡）
- 建议的情绪基调
- 应该推进/回收的伏笔
- 建议启用的额外预设
- "开始写作"按钮（带着这些建议进入写作流程）

---

## Phase 3：预设效果验证（P2）

### 3.1 写后预设合规检查

**现状**: 预设只在生成时注入，不验证生成结果是否遵守
**目标**: 章节生成后，自动检查是否违反了已启用预设的规则

**实现方案**:
- 候选稿生成后，对每个已启用预设运行合规检查
- 逻辑风险预设：检查是否出现时代错位/信息传播不合理等
- 去AI味预设：运行 AI 味检测
- 文学技法预设：检查伏笔状态/人物维度等
- 结果作为"候选稿质量报告"展示给用户

---

## 实施顺序

```
Phase 1 — 预设注入修复（P0，让预设真正生效）
  1.1 candidate.create_chapter 注入预设
  1.2 建书时自动启用套装

Phase 2 — 反思模型自动选预设（P1，替代用户决策）
  2.1 章节预设反思
  2.2 驾驶舱"下一章建议"卡片

Phase 3 — 预设效果验证（P2，闭环）
  3.1 写后预设合规检查
```

---

## 验证标准

- Phase 1：选了"仙侠"题材建书后，生成的章节带有古典意境文风
- Phase 2：写第 5 章时，AI 自动建议"本章是第一卷高潮，启用爽点代价检查"
- Phase 3：生成的候选稿如果出现时代错位，质量报告中标红提示
