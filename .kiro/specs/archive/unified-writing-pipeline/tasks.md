# 统一写作管线 - 任务清单

**前置依赖**: `context-and-presets-overhaul` P0-P2 完成

---

## Phase 1: pipeline.generate_chapter 工具实现

- [x] 1. 新建 `novel-plugin/src/handlers/pipeline-generate-service.ts`
  - 定义 `PipelineGenerateInput` / `PipelineGenerateOutput` / `JingweiDelta` 类型
  - 实现 `executePipelineGenerate()` 核心函数
  - 内部调用顺序：Composer → Writer(creative) → Writer(settle) → Auditor → Reviser(条件) → StateValidator
  - 从 session provider config 构建 LLM client
  - 流式输出通过 `onStream` 回调传出

- [x] 2. 在 `novel-plugin/src/tool-schemas.ts` 添加 `pipeline.generate_chapter` 的 input schema
  - required: bookId, chapterIntent
  - optional: userDirectives, wordCount, autoRevise

- [x] 3. 在 `novel-plugin/src/handlers/tool-registry.ts` 注册 `pipeline.generate_chapter` sessionTool
  - risk: draft-write
  - renderer: pipeline.chapter-result
  - enabledForModes: WRITE_SESSION_PERMISSION_MODES
  - scope: novel

- [x] 4. 在 `studio/src/api/lib/session-tool-executor.ts` 添加 `pipeline.generate_chapter` case
  - 调用 `executePipelineGenerate()`
  - 传入 `onToolOutputStream` 实现流式输出
  - 返回 artifact（候选稿在画布中打开）

## Phase 2: Writer Agent Prompt 改造

- [x] 5. 修改 `novel-plugin/src/engine/pipeline/agent-prompts.ts` 中 `AGENT_SYSTEM_PROMPTS.writer`
  - 第 5 步从"自己生成正文 + candidate.create_chapter"改为"调用 pipeline.generate_chapter"
  - 明确说明：该工具自动完成上下文组装→生成→审计→修订→经纬同步
  - 保留说明：非整章任务（写一段、改一句）仍可直接输出

- [ ] 6. 验证：writer agent 对话中说"写下一章"→ LLM 调用 pipeline.generate_chapter 而非裸写
  - **需要运行时验证**：启动应用 + 配置 provider + 实际对话测试

## Phase 3: candidate.accept 经纬自动同步

- [x] 7. 修改 `novel-plugin/src/engine/writing-resource/service.ts` 的 `acceptResource` 函数
  - accept 成功后检查 `resource.metadata.jingweiDelta`
  - 如果存在，调用 `applyJingweiDeltaOnAccept()` 批量 upsert 经纬条目

- [x] 8. 实现 `applyJingweiDeltaOnAccept(bookId, delta)` 函数
  - 遍历 delta.created → SQL upsert
  - 遍历 delta.updated → SQL upsert
  - Non-fatal: 失败不阻塞 accept

- [x] 9. `pipeline-generate-service.ts` 中将 `jingweiDelta` 写入候选稿的 metadata
  - 使 accept 时能读取到

## Phase 4: 前端审计报告渲染

- [x] 10. 新增 renderer 组件 `PipelineChapterResultCard`
  - 显示：章节标题 / 字数 / 审计通过状态
  - issues 按 severity 分组展示（critical 红色 / warning 黄色 / info 灰色）
  - 经纬变更摘要（新增 N 条 / 更新 N 条）
  - 操作按钮：在画布中打开

- [x] 11. 在 renderer 注册表中注册 `pipeline.chapter-result` → `PipelineChapterResultCard`

- [x] 12. 审计不通过时的交互：
  - 显示操作提示（修订/忽略并接受/重新生成）
  - 用户通过对话回复触发对应操作

## Phase 5: 验证与集成测试

- [ ] 13. 端到端测试：对话中"写下一章"→ pipeline 工具调用 → 候选稿生成 → 审计报告展示
- [ ] 14. 验证流式输出：生成过程中前端能实时看到文本
- [ ] 15. 验证经纬同步：accept 后经纬条目自动更新
- [ ] 16. 验证 fallback：pipeline 工具失败时（LLM 超时等），返回结构化错误，不崩溃
- [ ] 17. 验证非整章任务不受影响：用户说"帮我写一段打斗"→ LLM 直接输出，不走 pipeline

**状态**: Phase 1-4 代码实现完成，typecheck 通过。Phase 5 需要运行时环境手动验证。
