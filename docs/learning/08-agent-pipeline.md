---
title: Agent 写作管线
summary: PipelineRunner 核心引擎、Agent 角色、工具链、多 Agent 编排、确认门与安全
tags: [Agent, Pipeline, 管线, 编排, 工具链]
routes:
  - /workbench/:bookId/conversation/:sessionId
  - /workbench/:bookId/workflow
---

# Agent 写作管线

> Agent 写作管线是 NovelFork 的核心引擎——多个专业 Agent 协作完成从规划到成稿的全流程。

---

## 核心概念

NovelFork 的 AI 写作不是单次 API 调用，而是一条多 Agent 协作的管线（Pipeline）：

```
用户请求 → PipelineRunner 调度 → 多 Agent 协作 → 候选稿输出
```

每个 Agent 有明确的职责，通过工具调用和消息传递协作。

---

## PipelineRunner

PipelineRunner 是管线的核心调度器，负责：

### 配置

```typescript
interface PipelineConfig {
  client: LLMClient;           // LLM 客户端
  model: string;               // 默认模型
  projectRoot: string;         // 项目根目录
  defaultLLMConfig?: LLMConfig; // LLM 配置
  notifyChannels?: NotifyChannel[]; // 通知渠道
  radarSources?: RadarSource[];     // 雷达源
  externalContext?: string;         // 外部上下文
  modelOverrides?: Record<string, string | AgentLLMOverride>; // Agent 模型覆盖
}
```

### 职责

1. **调度 Agent**：按流程顺序调用各 Agent
2. **管理状态**：通过 StateManager 维护写作状态
3. **组装上下文**：为每个 Agent 准备所需的上下文
4. **错误恢复**：Agent 失败时的重试和降级策略
5. **事件发射**：通过 pipelineEvents 发射进度事件

---

## Agent 角色

### Writer Agent

| 属性 | 值 |
|------|-----|
| 职责 | 生成章节正文 |
| 输入 | 章节意图 + 上下文包 + 规则栈 |
| 输出 | 章节正文 + 元数据 |

核心写作 Agent，负责实际的文字生成。接收 Planner 的计划和 Composer 的上下文，输出完整章节。

### Planner Agent

| 属性 | 值 |
|------|-----|
| 职责 | 生成章节计划（chapter intent） |
| 输入 | 作品状态 + 用户指导 |
| 输出 | 章节目标、必须保留项、冲突说明 |

在写作前规划本章的方向，确保与全书大纲一致。

### Auditor Agent（ContinuityAuditor）

| 属性 | 值 |
|------|-----|
| 职责 | 连续性审校 |
| 输入 | 新章节 + 历史章节 + 设定 |
| 输出 | 审校报告（问题列表 + 严重度） |

检查新生成的章节是否与已有内容矛盾。

### Architect Agent

| 属性 | 值 |
|------|-----|
| 职责 | 全书架构规划 |
| 输入 | 作品设定 + 当前进度 |
| 输出 | 架构建议 + 节奏规划 |

负责宏观层面的结构规划。

### Explorer Agent（RadarAgent）

| 属性 | 值 |
|------|-----|
| 职责 | 探索和发现 |
| 输入 | 当前状态 + 雷达源 |
| 输出 | 发现报告 + 建议 |

扫描外部信息源，提供创作灵感和参考。

### 其他 Agent

| Agent | 职责 |
|-------|------|
| ComposerAgent | 组装上下文包（context/rule-stack/trace） |
| LengthNormalizerAgent | 字数规范化 |
| ChapterAnalyzerAgent | 章节分析 |
| ReviserAgent | 修订（支持多种修订模式） |
| StateValidatorAgent | 状态验证 |
| FoundationReviewerAgent | 基础审查 |

---

## 工具链

Agent 通过工具调用执行具体操作：

### 核心工具

| 工具 | 说明 |
|------|------|
| write_draft | 写下一章草稿 |
| plan_chapter | 生成章节意图 |
| compose_chapter | 生成上下文/规则栈/trace |
| audit_chapter | 审校章节 |
| revise_chapter | 修订章节 |

### 工具链流程

```
cockpit（驾驶舱）
    ↓ 用户点击"生成下一章"
PGI（生成前追问）
    ↓ 用户回答
guided（引导式计划）
    ↓ 用户批准
candidate（候选稿生成）
    ↓ 写作完成
audit（审校）
    ↓ 通过
settlement（结算入库）
```

---

## 多 Agent 编排

### workflow-executor

多 Agent 编排通过 workflow-executor 实现：

```typescript
// 工作流定义
interface WorkflowRecipe {
  id: string;
  name: string;
  steps: WorkflowStep[];
}

interface WorkflowStep {
  id: string;
  agent: string;      // 执行的 Agent
  label: string;      // 步骤标签
  dependsOn?: string[]; // 依赖的前置步骤
}
```

### 执行模式

- **串行**：步骤按顺序执行
- **并行**：无依赖关系的步骤可并行
- **条件**：根据前置步骤结果决定是否执行

### 状态流转

```
pending → running → success
                  → failed
                  → skipped
                  → approval-pending（等待用户确认）
```

---

## WorkflowProgressCard

WorkflowProgressCard 是工作流执行的可视化组件，出现在叙述者对话中：

### 展示内容

```
┌─────────────────────────────────┐
│ 写作工作流          执行中 · 3/5  │
│ ████████████░░░░░░░░  60%       │
│                                 │
│ ✓ 上下文组装          1.2s      │
│ ✓ 章节规划            3.4s      │
│ ✓ 正文生成            12.8s     │
│ ● 连续性审校          运行中...  │
│ ○ 结算入库            等待中     │
└─────────────────────────────────┘
```

### 步骤状态图标

| 状态 | 图标 | 颜色 |
|------|------|------|
| pending | 时钟 | 灰色 |
| running | 旋转 | 蓝色 |
| success | 勾 | 绿色 |
| failed | 叉 | 红色 |
| skipped | 空心圆 | 灰色 |
| approval-pending | 暂停 | 黄色 |

---

## 确认门与安全原则

### 确认门触发时机

管线中以下操作会触发确认门：

| 操作 | 风险等级 | 说明 |
|------|---------|------|
| 写入正式章节 | write | 候选稿 → 正文 |
| 修改经纬条目 | write | Agent 自动更新设定 |
| 删除资源 | delete | 删除章节/候选稿 |
| 执行修订 | write | 修改已有正文 |

### 安全原则

1. **最小权限**：Agent 默认只有读权限，写入需确认
2. **可回退**：所有写入操作创建检查点，可回退
3. **透明性**：每个工具调用都在对话中可见
4. **用户主权**：用户可随时中断管线执行

### 权限模式对管线的影响

| 模式 | 行为 |
|------|------|
| ask-always | 每个写入步骤都暂停等待确认 |
| auto-approve | 低风险操作自动通过，高风险仍需确认 |

---

## 最佳实践

- **理解管线流程**：知道每个步骤在做什么，才能在确认门做出正确判断
- **关注审校结果**：审校发现的问题要认真对待，不要盲目接受
- **善用模型覆盖**：不同 Agent 可以用不同模型（如 Writer 用强模型，Auditor 用快模型）
- **监控执行时间**：如果某步骤异常慢，可能是上下文过大
- **保持经纬更新**：管线质量高度依赖经纬的完整性

---

## 常见坑

| 问题 | 原因 | 解决 |
|------|------|------|
| 管线中途失败 | API 超时或模型不可用 | 检查供应商状态，重试 |
| 审校误报过多 | 经纬设定不完整 | 补充相关设定 |
| 生成字数不达标 | LengthNormalizer 配置问题 | 检查字数目标设置 |
| 工作流卡在 approval-pending | 确认门等待用户操作 | 在对话中批准或拒绝 |

---

## 可跳转入口

| 功能 | 路径 |
|------|------|
| 叙述者对话（含工作流卡片） | `/workbench/:bookId/conversation/:sessionId` |
| 工作流页面 | `/workbench/:bookId/workflow` |
