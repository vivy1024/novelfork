# LegnaCode-CLI 全量学习报告

**分析日期**: 2025-06-13  
**源码位置**: `D:\DESKTOP\novelfork\legnacode-cli\`  
**目的**: 识别可移植到 NovelFork 的技术，按优先级排列

---

## 一、架构总览

LegnaCode 是 Claude Code CLI 的深度 fork，在原版基础上新增了：

| 子系统 | 文件位置 | 核心创新 |
|--------|---------|---------|
| 4 层记忆栈 | `src/memdir/vectorStore/` | L0/L1/L2/L3 分层注入，TF-IDF 向量搜索，Token ROI 反馈 |
| Budget Pressure | `src/services/compact/budgetPressure.ts` | 80%/92% 双阈值软提示 |
| Tool Output Pruner | `src/services/compact/toolOutputPruner.ts` | 8K head+tail 截断 |
| Snip Compact | `src/services/compact/snipCompact.ts` | 消息投影（不删除，只从模型视图移除） |
| Session Memory Compact | `src/services/compact/sessionMemoryCompact.ts` | 用预提取摘要替代 LLM 实时摘要 |
| Hermes Review Agent | `src/services/hermes/` | 后台 agent 从对话中提取可复用模式/纠正/教训 |
| Nudge System | `src/services/hermes/` | 学习状态注入（报告已学到什么） |
| HashlineEdit | `src/tools/hashline/` | 哈希锚点编辑（无需复制原文） |
| Code Graph | `src/services/codeGraph/` | 符号索引 + blast radius 分析 |
| Workflow Engine | `src/services/codeGraph/` | markdown workflow → 可执行步骤 |
| Knowledge Graph | `src/memdir/vectorStore/knowledgeGraph.ts` | 时态三元组存储 |

---

## 二、4 层记忆系统（最有价值）

### 数据模型

```typescript
interface Drawer {
  id: string;              // sha256 前 24 位
  content: string;         // L2: 原始全文
  contentL0?: string;      // ~25 词一句话摘要
  contentL1?: string;      // ~200 词核心信息
  wing: string;            // 顶层分区（项目/全局/团队）
  room: string;            // 主题分类（facts/decisions/events/preferences）
  importance: number;      // 0.0–1.0
  tokenCost?: number;      // 全文 token 估算
  relevanceCount?: number; // 被召回次数（Token ROI）
}
```

### 4 层注入策略

| 层 | 内容 | Token 预算 | 触发 |
|---|------|-----------|------|
| L0 | 身份信息 | ~100 tokens | 始终在 system prompt |
| L1 | 高优先级记忆摘要 | 800 tokens | 会话启动（wakeUp） |
| L2 | 按主题过滤+相关性排序 | 4000 chars | 每次 user turn 前（prefetch） |
| L3 | 全库向量搜索 | 10 条上限 | 显式 recall |

### WakeUp 两遍填充

1. Pass 1：按 importance 排序取前 40 条，贪心填入 L1 摘要（~200字）
2. Pass 2：放不下的降级用 L0（~25字）回填剩余预算

### Recall with Budget 逐条降级

- 搜索结果按相似度排序 → 逐条尝试：
  - 全文放得下 → 用 L2
  - 全文超预算 → 用 L1
  - L1 也超 → 用 L0
  - 连 L0 都放不下 → 跳过

### Content Tiering（纯 heuristic，不调 LLM）

**L0 生成**: 取第一句话，截断至 100 chars  
**L1 生成**: 分句 → 按关键词密度评分 → 贪心选高密度句填满 400 chars

### 相关性搜索

- TF-IDF 向量化 + cosine similarity
- 多因子排序: `cosine × time_decay × roi_boost`
- Time Decay: `max(0.3, 1.0 - age_days/90)`
- Token ROI: 召回次数多且成本低的记忆加权

---

## 三、Budget Pressure（预算压力注入）

在工具返回值末尾追加警告文本：

```
80% 使用率 → "Consider wrapping up your current task"
92% 使用率 → "URGENT: Finish immediately and provide a summary"
```

无损——不修改消息结构，只在 tool_result 字符串后追加。

---

## 四、上下文压缩 6 层递进

```
Budget Pressure → Microcompact → Snip → Session Memory Compact → Auto Compact → Reactive
```

### Snip Compact（投影式）

不删除消息，只从发送给模型的视图中过滤。UI 仍能滚动查看完整历史。

阈值随模型窗口动态调整：
- 200K: ≥20 条触发，保留最近 10
- 500K: ≥25 条触发，保留最近 100
- 1M: ≥50 条触发，保留最近 200

### Session Memory Compact

用后台持续提取的结构化摘要文件替代 LLM 实时摘要。零额外 API 调用。

### Post-compact 恢复

- 最近 5 个文件重新附加（token 预算 50K）
- Plan 文件重新注入
- 活跃 Skill 内容重新注入（每 skill 5K，总 25K）
- 异步 agent 状态恢复
- Session start hooks 重新执行

---

## 五、Hermes 自演化系统

### Review Agent

- 门控：≥5 条用户消息、≥3 次工具调用、距上次 ≥30 分钟
- 从对话中提取：
  1. 可复用模式 → 保存为 skill
  2. 行为纠正 → "不要这样做"规则
  3. 失败教训 → 错误方法 vs 正确方法
- 写入 `.legna/memory/`

### Nudge System

- 追踪：工具调用次数、纠正次数、创建的 skill 数
- 每 ≥10 轮注入一条系统消息报告"本次会话学到了什么"

---

## 六、HashlineEdit（锚点编辑）

- 每行计算 xxHash32 mod 647 → 2 字符锚点
- 模型看到 `42sr|function hello() {`
- 编辑时引用 `≔42sr..45ab` + 新内容
- 自带 3-way merge recovery

---

## 七、Code Graph

- 纯 regex 符号提取（TS/JS/Python/Go/Rust）
- 增量更新（只重新解析 mtime 变化的文件）
- 持久化到 `.legna/.palace/graph.json`
- `blastRadius(file)` — 修改某文件影响哪些下游

---

## 八、对 NovelFork 的移植优先级

### P0 — 直接提升核心体验

| 特性 | 移植方案 | 预期收益 | 工作量 |
|------|---------|---------|--------|
| **Budget Pressure** | 在 tool_result 末尾追加字数/token 提醒 | 模型不会在 context 快满时写长文导致截断 | 2h |
| **4 层记忆 → 经纬分层注入** | 经纬数据按 importance 分 L0/L1/L2 注入 | 减少 60%+ 经纬 token 占用 | 1d |
| **Hermes → 写作风格学习** | 后台 agent 从用户修改中提取风格规则 | "越用越懂你" | 1d |

### P1 — 显著改善

| 特性 | 移植方案 | 预期收益 | 工作量 |
|------|---------|---------|--------|
| **Snip Compact（投影式）** | 旧消息从模型视图移除但 UI 保留 | 长会话不膨胀，历史可回顾 | 4h |
| **Session Memory Compact** | 后台持续提取摘要，compact 时零 API 调用 | 压缩延迟从 10s → 0 | 1d |
| **Novel Graph** | 角色/伏笔/情节依赖图 | 修改设定自动识别受影响章节 | 2d |
| **Parallel Chapter Writing** | 多章节分配独立 sub-agent + skeleton | 批量写作速度 3x | 1d |

### P2 — 锦上添花

| 特性 | 移植方案 | 预期收益 | 工作量 |
|------|---------|---------|--------|
| **HashlineEdit → 段落锚点** | 用段落首句 hash 定位 | 长章节精确修改省 token | 1d |
| **Workflow Engine** | markdown workflow → 写作管线步骤 | 结构化流程可视化 | 4h |
| **Nudge System** | 每 10 轮报告学习状态 | 用户感知 AI 在进步 | 2h |
| **Knowledge Graph** | 时态三元组（角色关系/设定变化） | 追溯设定演变历史 | 2d |
| **Tool Output Pruner** | 大结果 head+tail 截断 | 配合 micro-compact | 1h |

### P3 — 长期储备

| 特性 | 说明 |
|------|------|
| TF-IDF 中文分词 | 需要 jieba 或类似分词器 |
| Cached Microcompact | 需要 Anthropic cache_edits API 支持 |
| Exchange Pair 提取 | 从用户-AI 对话中自动识别决策/偏好 |
| Token ROI 反馈循环 | 记忆被召回越多 → importance 越高 |

---

## 九、NovelFork 特化改造建议

### 记忆系统 Wing/Room 映射

```
Wing = 作品名（如 "这个世界修仙讲科学"）
Room = 经纬 category:
  character  → 角色档案
  world-model → 世界观设定
  premise    → 核心前提/大纲
  arc        → 情节弧
  foreshadowing → 伏笔
  style      → 文风偏好
  feedback   → 用户纠正/修改记录
```

### L0/L1/L2 对应经纬数据

| 层 | 注入内容 | 示例 |
|---|---------|------|
| L0 | 角色一句话定位 | "薛行之：普通工薪族，发现自己有修仙资质" |
| L1 | 角色核心设定摘要 | "28岁，西京市三院确诊灵脉，月薪4500，父亲老薛..." |
| L2 | 角色完整档案 | 全部经纬 contentMd |

### 写作场景的 Budget Pressure

```
80% → "当前上下文已接近容量限制。请在本章写完后告知用户保存进度。"
92% → "紧急：上下文即将溢出。请立即完成当前输出并停止。"
```

---

## 十、实施路线图建议

### Sprint 1（1-2 天）— 立竿见影
1. Budget Pressure 注入
2. Tool Output Pruner（8K head+tail）
3. Snip Compact 基础版

### Sprint 2（2-3 天）— 经纬分层
4. 经纬数据 L0/L1/L2 分层生成
5. WakeUp + Recall with Budget 注入策略
6. Content Tiering heuristic（中文版）

### Sprint 3（2-3 天）— 自演化
7. Hermes Review Agent（写作风格提取）
8. Session Memory Compact
9. Nudge System

### Sprint 4（3-5 天）— 图谱与并行
10. Novel Graph（角色/伏笔/情节依赖）
11. Parallel Chapter Writing
12. Knowledge Graph 时态三元组
