# 小说功能插件化 + 通用工具补全 + InkOS 清理 — 需求文档

## 背景

NovelFork 要同时服务小说创作和其他领域（如玉珍健身）。当前小说功能硬编码在框架中，需要拆成可插拔插件。同时通用工具有若干假实现需要修正，InkOS 上游残留命名需要清理。

---

## 目标

1. **通用工具真实可用**：修复 Agent 子代理、EndPipeline、ExitPlanMode 等假实现
2. **插件接口定义**：扩展已有 plugin 基础设施，支持工具/路由/预设/页面注册
3. **小说功能渐进迁移**：先建插件壳，逐步迁移（每次 2-3 个文件，不一次断 50 个 import）
4. **补充高价值小说工具**：chapter.audit、rewrite.segment、outline.suggest_next、character.check_consistency、hooks.manage
5. **InkOS 残留清理**：truth→jingwei 统一、旧路由 deprecated、client_id 修正

---

## 第一部分：通用工具修正

| 工具 | 问题 | 修正方案 |
|------|------|---------|
| Agent | tools=[], maxSteps=1, 无递归工具调用 | 传入通用工具集 + executeTool 回调 + maxSteps=6 |
| EndPipeline | rule 过滤语法未实现，只是拼接 | 实现 grep/head/tail/sort/uniq/cut 解析器 |
| ExitPlanMode | 先退出 plan mode 再等批准（时序 bug） | 改为批准后才切换 sessionMode |
| AskUserQuestion | 用户答案内容回传不完整 | 确认 confirmSessionToolDecision 传回结构化答案 |
| Goals | 不注入 system prompt | Agent 系统提示中注入当前活跃目标 |
| Terminal | 非 PTY，不支持交互式 | 检测 Bun 环境用 Bun.spawn pty，否则降级 |
| Recall | 无 read_tool_call action | 实现按 toolCallId 精确回溯 |

---

## 第二部分：插件化架构

### 设计原则

1. **已有 plugin 基础设施**：`packages/core/src/plugins/` 有 `NovelForkPlugin` 基类 + `PluginManager` + `PluginManifest`
2. **渐进式迁移**：先建插件壳 + 注册入口，handler 代码暂不移动文件位置
3. **按 projectType 过滤**：session 创建时指定 projectType，工具列表按 type 过滤
4. **插件加载失败不影响框架**：通用工具始终可用

### 插件接口

```typescript
interface PluginManifest {
  id: string;
  name: string;
  version: string;
  projectType: string; // "novel" | "health" | "general"
  tools: PluginToolDefinition[];
  agentPresets: PluginAgentPreset[];
  routes: PluginRouteFactory[];
  pages: PluginPageDefinition[];
  systemPromptExtensions: PluginPromptExtension[];
}
```

### 迁移策略（渐进式，非一次性大迁移）

```
Step 1: 创建 packages/novel-plugin/ 包 + manifest 骨架
Step 2: session-tool-registry 加 scope 字段，getEnabledSessionTools 加 projectType 过滤
Step 3: 小说工具定义从 SESSION_TOOL_DEFINITIONS 移到 novel-plugin manifest（handler 不动）
Step 4: 小说路由加中间件（检查 book 存在性，无 book 的项目自然不可达）
Step 5: Agent 预设从 AGENT_TOOL_PRESETS 移到 novel-plugin manifest
Step 6: 逐步迁移 handler 代码到 novel-plugin/（从最独立的开始：rhythm-analyzer → golden-chapters → questionnaire → ...）
Step 7: 前端 writing-workbench 改为插件页面注入（最后做，耦合最深）
```

每个 Step 独立可验证，回归范围小。

---

## 第三部分：InkOS 残留清理

### P0 — 功能性问题

| 位置 | 问题 | 修正 |
|------|------|------|
| `api/routes/auth.ts:141` | `client_id: "inkos"` | 改为 `"novelfork"`（需同步 Sub2API） |

### P1 — 概念统一（truth → jingwei）

| 位置 | 问题 | 修正 |
|------|------|------|
| `core/registry/builtin-tools.ts` | 工具名 `read_truth_files` / `write_truth_file` | 改为 `read_jingwei_files` / `write_jingwei_file` |
| `api/lib/story-file-service.ts` | `TRUTH_FILES` 常量 | 改为 `JINGWEI_FILES` |
| `shared/agent-native-workspace.ts` | `WorkspaceArtifactKind` 含 `"truth-file"` | 合并到 `"jingwei"` |
| `shared/contracts.ts` | deprecated 别名 `TruthFileSummary` 等 | 删除 |
| API 路由 | `/api/books/:id/truth/` | 标记 deprecated，新代码用 `/story-files/` |

### P2 — 代码清洁

| 位置 | 问题 | 修正 |
|------|------|------|
| `components/Admin/WorktreesTab.test.tsx` | `.inkos-worktrees` 测试路径 | 改为 `.novelfork-worktrees` |
| `core/pipeline/chapter-truth-validation.ts` | 文件名含 truth | 重命名为 `chapter-jingwei-validation.ts` |
| `core/agents/settler-prompts.ts` | prompt 中 "truth files" | 改为 "经纬资料" |

### 不动的

- `agent-native-workspace.ts` 文件名 — 已是核心架构概念
- 磁盘文件名 `story_bible.md` — 改动成本极高（需数据迁移）
- Git upstream remote — 标准 fork 实践
- 历史文档中的 InkOS 引用 — 保留

---

## 第四部分：新增小说工具

### 5 个高价值工具

| 工具 | 用途 | 输入 | 实现方式 |
|------|------|------|---------|
| `chapter.audit` | 单章质量审计 | bookId, chapterNumber, checks[] | 聚合 rhythm/AI味/伏笔/人设检查 |
| `rewrite.segment` | 选段改写 | bookId, chapterNumber, selection, mode | LLM + 经纬上下文 + AI味后处理 |
| `outline.suggest_next` | 推荐下一章方向 | bookId | 大纲+最近章节+伏笔 → LLM 建议 |
| `character.check_consistency` | 人设一致性检查 | bookId, characterName?, chapterRange? | 角色卡 vs 章节描写对比 |
| `hooks.manage` | 伏笔统一管理 | bookId, action, hookId?, description? | 读写 pending_hooks.md |

---

## 第五部分：实施顺序

```
Phase 1 — 通用工具修正（~200 行，1 次会话）
  1.1 修复 Agent 子代理（给工具 + 多步执行 + executeTool 递归）
  1.2 实现 EndPipeline rule 解析器（grep/head/tail/sort/uniq/cut）
  1.3 修复 ExitPlanMode 时序（批准后才切换 sessionMode）
  1.4 Goals 注入 system prompt
  1.5 Recall 加 read_tool_call

Phase 2 — 插件接口 + scope 过滤（~100 行，1 次会话）
  2.1 扩展 PluginManifest 接口
  2.2 session-tool-registry 加 scope 字段
  2.3 getEnabledSessionTools 加 projectType 过滤
  2.4 创建 packages/novel-plugin/ 骨架 + manifest

Phase 3 — 渐进迁移（每步 ~50 行，3-4 次会话）
  3.1 小说工具定义移到 novel-plugin manifest（handler 暂不动）
  3.2 Agent 预设移到 novel-plugin
  3.3 迁移独立 handler（rhythm-analyzer、golden-chapters、questionnaire）
  3.4 迁移耦合 handler（cockpit、candidate、narrative）
  3.5 小说路由加 book 存在性中间件
  3.6 前端 writing-workbench 改为插件页面注入

Phase 4 — 新增小说工具（~500 行，1-2 次会话）
  4.1 chapter.audit
  4.2 rewrite.segment
  4.3 outline.suggest_next
  4.4 character.check_consistency
  4.5 hooks.manage

Phase 5 — InkOS 清理（~100 行，1 次会话）
  5.1 auth.ts client_id 修正
  5.2 truth → jingwei 工具名/常量/类型统一
  5.3 deprecated 路由标记
  5.4 测试路径清理
```

---

## 约束

- 每个 Phase 独立可验证，不依赖后续 Phase
- Phase 3 每个 Step 独立提交，回归范围 ≤ 5 个文件
- 插件加载失败时框架仍可用（通用工具不受影响）
- 小说插件是内置插件（随 exe 分发），不是第三方插件
- 不引入新外部依赖（用已有 plugin 基础设施）
- 磁盘文件名（story_bible.md 等）不改（需数据迁移，成本过高）

---

## 验证标准

- Phase 1：通用工具无假实现，Agent 子代理能递归调用工具，typecheck 通过
- Phase 2：新建无 book 的 session，只看到通用工具，看不到小说工具
- Phase 3：小说功能通过插件加载，"写下一章"全链路端到端跑通
- Phase 4：新工具有单元测试，chapter.audit 能对真实章节返回审计结果
- Phase 5：全仓无 `"inkos"` 字符串（除 git remote 和历史文档）
