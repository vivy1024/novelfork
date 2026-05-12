# 小说功能插件化 + 通用工具补全 — 需求文档

## 背景

NovelFork 要同时服务小说创作和其他领域（如玉珍健身）。当前小说功能硬编码在框架中，需要拆成可插拔插件。同时通用工具有若干假实现需要修正。

---

## 目标

1. **小说功能可插拔**：小说工具/路由/前端/Agent 预设通过插件系统注册，不在框架中硬编码
2. **通用框架干净**：无小说依赖的 Agent 工作台，任何领域都能用
3. **通用工具真实可用**：修复 Agent 子代理、EndPipeline、ExitPlanMode 等假实现
4. **补充高价值小说工具**：chapter.audit、rewrite.segment、outline.suggest_next、character.check_consistency、hooks.manage

---

## 第一部分：通用工具修正

### 问题清单

| 工具 | 问题 | 修正方案 |
|------|------|---------|
| Agent | tools=[], maxSteps=1, 无递归工具调用 | 传入完整工具集 + executeTool 回调 + maxSteps=6 |
| EndPipeline | rule 过滤语法未实现，只是拼接 | 实现 grep/head/tail/sort/uniq/cut 解析器 |
| ExitPlanMode | 先退出 plan mode 再等批准（时序 bug） | 改为批准后才切换 sessionMode |
| AskUserQuestion | confirmation 是 approve/reject，用户答案内容回传不完整 | 确认 confirmSessionToolDecision 能传回结构化答案 |
| Goals | 不注入 system prompt | Agent 系统提示中注入当前活跃目标 |
| Terminal | 非 PTY，不支持交互式 | 检测 Bun 环境用 Bun.spawn pty，否则降级 |
| Recall | 无 read_tool_call action | 实现按 toolCallId 精确回溯 |

---

## 第二部分：插件化架构

### 设计原则

1. **已有 plugin 基础设施**：`packages/core/src/plugins/` 有 `NovelForkPlugin` 基类 + `PluginManager` + `PluginManifest`
2. **插件注册工具**：通过 `PluginTool[]` 声明工具定义 + handler
3. **插件注册路由**：通过 `PluginRoute[]` 声明 HTTP 路由
4. **插件注册 Agent 预设**：通过 `PluginAgentPreset[]` 声明角色工具集
5. **按 projectType 过滤**：session 创建时指定 projectType，工具列表按 type 过滤

### 插件接口扩展

```typescript
interface NovelForkPluginManifest {
  id: string;
  name: string;
  version: string;
  projectType: string; // "novel" | "health" | "general"
  
  // 工具注册
  tools: PluginToolDefinition[];
  
  // Agent 角色预设
  agentPresets: PluginAgentPreset[];
  
  // HTTP 路由
  routes: PluginRouteFactory[];
  
  // 前端页面（路由注入）
  pages: PluginPageDefinition[];
  
  // 系统提示扩展
  systemPromptExtensions: PluginPromptExtension[];
}
```

### 切割边界

**从框架中移出到小说插件的内容：**

| 层 | 移出内容 |
|----|---------|
| 工具注册 | 19 个小说工具（cockpit.*/questionnaire.*/pgi.*/guided.*/candidate.*/narrative.*/chapter.*/jingwei.*/health.*） |
| Agent 预设 | writer/hooks/chapter-hooks/auditor/outline 角色 |
| 后端服务 | cockpit-service、candidate-*-service、narrative-line-service、questionnaire-tool-service、pgi-tool-service、guided-generation-tool-service、story-file-service、novel-init-handler、rhythm-analyzer、golden-chapters-analyzer、writing-mode-tool |
| 路由 | bible/jingwei/lorebook/chapter-candidates/compliance/filter/golden-chapters/narrative-line/onboarding/pipeline/presets/rhythm/runs/writing-modes/writing-tools/workbench |
| 前端 | writing-workbench/ 目录（35 个文件）+ writing-action-adapter/client |
| Core | agents/(34个)、bible/、jingwei/、compliance/、filter/、hooks/、pipeline/、presets/、models/、state/ |

**保留在框架中的：**

| 层 | 保留内容 |
|----|---------|
| 工具 | 29 个通用工具（Bash/Read/Write/Edit/Glob/Grep/WebSearch/WebFetch/Browser/Agent/Await/Send/Terminal/ForkNarrator/ShareFile/Recall/Pipeline/Skill/AskUserQuestion/EnterPlanMode/ExitPlanMode/TaskCreate/EnterWorktree/ExitWorktree/LearningGuide/Goals） |
| 后端 | session-*/runtime-*/provider-*/tool-executor/subagent/mcp-client/workspace/terminal/share/search/user-config |
| 路由 | session/ai/providers/settings/admin/auth/exec/git/mcp/monitor/proxy/search/share/storage/terminals/tools/upload/usage/worktree/workspace-management/context/routines/runtime-*/snapshots/agent-config/aggregations/learning |
| 前端 | shell/conversation/settings/sessions/sidebar/search/tool-results/workflow/hooks/lib/components/dashboard/learn/routines/agent-conversation |
| Core | llm/mcp/plugins/registry/storage/runtime/tools/types/utils/relay |

---

## 第三部分：新增小说工具

### 高价值工具（5 个）

#### 1. chapter.audit

**用途**：写完一章后做质量审计
**输入**：`{ bookId, chapterNumber, checks?: ("continuity" | "rhythm" | "ai_taste" | "hooks" | "character")[] }`
**输出**：每项检查的结果（问题列表 + 严重程度 + 建议修改）
**实现**：聚合现有的 rhythm-analyzer、AI味检测、伏笔检查、人设一致性检查

#### 2. rewrite.segment

**用途**：对选中段落做改写（续写/扩写/去AI味/换风格）
**输入**：`{ bookId, chapterNumber, selection: { start, end }, mode: "continue" | "expand" | "reduce_ai" | "restyle", styleHint?: string }`
**输出**：改写后的文本 + 变体列表
**实现**：调用 LLM + 注入经纬上下文 + AI味后处理

#### 3. outline.suggest_next

**用途**：基于大纲和已写章节推荐下一章方向
**输入**：`{ bookId }`
**输出**：2-3 个方向建议（每个含标题/摘要/伏笔推进/预期字数）
**实现**：读取大纲 + 最近章节 + 待兑现伏笔 → LLM 生成建议

#### 4. character.check_consistency

**用途**：检查角色在最近章节中是否和设定一致
**输入**：`{ bookId, characterName?, chapterRange?: { from, to } }`
**输出**：矛盾列表（哪章哪段和设定冲突 + 设定原文引用）
**实现**：读取角色卡 + 扫描章节中该角色的描写 → 规则匹配或 LLM 判断

#### 5. hooks.manage

**用途**：伏笔统一管理（埋设/标记兑现/检查到期/列表）
**输入**：`{ bookId, action: "plant" | "payoff" | "check_due" | "list", hookId?, chapterNumber?, description? }`
**输出**：操作结果 + 当前伏笔状态列表
**实现**：读写 pending_hooks.md + 更新状态

---

## 第四部分：实施顺序

```
Phase 1 — 通用工具修正（不动架构）
  1.1 修复 Agent 子代理（给工具 + 多步执行）
  1.2 实现 EndPipeline rule 解析器
  1.3 修复 ExitPlanMode 时序
  1.4 Goals 注入 system prompt
  1.5 Recall 加 read_tool_call

Phase 2 — 插件接口定义
  2.1 扩展 PluginManifest（tools/routes/agentPresets/pages/promptExtensions）
  2.2 session-tool-registry 改为动态注册（框架工具 + 插件工具合并）
  2.3 路由注册改为插件注入
  2.4 Agent 预设改为插件声明

Phase 3 — 小说功能迁移到插件
  3.1 创建 novel-plugin manifest
  3.2 迁移 19 个小说工具到插件
  3.3 迁移小说路由到插件
  3.4 迁移小说 Agent 预设到插件
  3.5 前端 writing-workbench 改为插件页面

Phase 4 — 新增小说工具
  4.1 chapter.audit
  4.2 rewrite.segment
  4.3 outline.suggest_next
  4.4 character.check_consistency
  4.5 hooks.manage
```

---

## 约束

- Phase 1 不改架构，只修 bug
- Phase 2-3 保持向后兼容（小说功能不中断）
- 插件加载失败时框架仍可用（通用工具不受影响）
- 不引入新的外部依赖（用已有的 plugin 基础设施）
- 小说插件是内置插件（随 exe 分发），不是用户安装的第三方插件

---

## 验证标准

- Phase 1：所有通用工具 handler 无 `not-implemented`、无假实现、typecheck 通过
- Phase 2：新建一个空项目（无小说插件），Agent 能正常使用通用工具
- Phase 3：小说功能通过插件加载后，"写下一章"全链路仍可端到端跑通
- Phase 4：新工具有单元测试 + 浏览器验证
