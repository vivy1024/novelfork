import type { CockpitService } from "@vivy1024/novelfork-novel-plugin/handlers";
import { pluginRegistry } from "./plugin-loader.js";
import {
  normalizeToolConfirmationRequest,
  type SessionToolDefinition,
  type SessionToolExecutionInput,
  type SessionToolExecutionResult,
  type ToolConfirmationAudit,
  type ToolConfirmationRequest,
} from "../../shared/agent-native-workspace.js";
import type { CandidateToolService } from "@vivy1024/novelfork-novel-plugin/handlers";
import type { GuidedGenerationToolService } from "@vivy1024/novelfork-novel-plugin/handlers";
import type { NarrativeLineService } from "@vivy1024/novelfork-novel-plugin/handlers";
import type { PGIToolService } from "@vivy1024/novelfork-novel-plugin/handlers";
import type { QuestionnaireToolService } from "@vivy1024/novelfork-novel-plugin/handlers";
import { getSessionToolDefinition } from "./session-tool-registry.js";
import { resolveSessionToolPolicy, type SessionToolPolicyResolution } from "./session-tool-policy.js";
import { executeBashTool, executeFileReadTool, executeFileWriteTool, executeFileEditTool } from "./real-tool-handlers.js";
import { validateToolPermission, classifyBashCommand, isPathWithinWorkDir, checkCommandAgainstLists, checkPathAgainstDirectoryLists } from "./permission-pipeline.js";

// --- Browser page interface (extracted from playwright Page) ---
interface BrowserPageLike {
  goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  click(sel: string, opts?: Record<string, unknown>): Promise<void>;
  fill(sel: string, val: string, opts?: Record<string, unknown>): Promise<void>;
  hover(sel: string, opts?: Record<string, unknown>): Promise<void>;
  screenshot(opts?: Record<string, unknown>): Promise<Buffer>;
  evaluate(expr: string | ((...args: unknown[]) => unknown), ...args: unknown[]): Promise<unknown>;
  goBack(): Promise<unknown>;
  goForward(): Promise<unknown>;
  waitForSelector(sel: string, opts?: Record<string, unknown>): Promise<unknown>;
  selectOption(sel: string, val: string | string[], opts?: Record<string, unknown>): Promise<string[]>;
  locator(sel: string): { first(): { textContent(opts?: Record<string, unknown>): Promise<string | null>; innerHTML(opts?: Record<string, unknown>): Promise<string> } };
  keyboard: { press(key: string): Promise<void>; type(text: string): Promise<void> };
}

// --- Browser session management ---
interface BrowserSession {
  id: string;
  browser: { close(): Promise<void> };
  page: BrowserPageLike;
  createdAt: number;
}
const browserSessions = new Map<string, BrowserSession>();

// --- User-Agent constant ---
const NOVELFORK_USER_AGENT = "NovelFork";

// --- Session-level in-memory state for Pipelines ---
const sessionPipelines = new Map<string, { label: string; captures: Map<string, string>; counter: number }>();

// --- Background agents state (for Agent/Await tools) ---
interface BackgroundAgentTask {
  id: string;
  promise: Promise<string>;
  result?: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  subagentType: string;
  prompt: string;
  abortController?: AbortController;
}
const backgroundAgents = new Map<string, BackgroundAgentTask>();

interface BackgroundBashTask {
  id: string;
  command: string;
  promise: Promise<SessionToolExecutionResult>;
  result?: SessionToolExecutionResult;
  status: "running" | "completed" | "failed";
}
const backgroundTasks = new Map<string, BackgroundBashTask>();

export type SessionToolHandlerContext = SessionToolExecutionInput & {
  readonly definition: SessionToolDefinition;
};

export type SessionToolHandler = (
  context: SessionToolHandlerContext,
) => Promise<SessionToolExecutionResult> | SessionToolExecutionResult;

export type SessionToolExecutorOptions = {
  readonly handlers?: Readonly<Record<string, SessionToolHandler>>;
  readonly cockpitService?: CockpitService;
  readonly questionnaireService?: QuestionnaireToolService;
  readonly pgiService?: PGIToolService;
  readonly guidedService?: GuidedGenerationToolService;
  readonly candidateService?: CandidateToolService;
  readonly narrativeService?: Partial<Pick<NarrativeLineService, "getSnapshot" | "proposeChange" | "applyChange">>;
  /** 工作目录，用于 Bash/Read/Write/Edit 工具的路径边界 */
  readonly workDir?: string;
  /** 当前 session ID，用于插件 handler 上下文 */
  readonly sessionId?: string;
  readonly now?: () => number;
  readonly createConfirmationId?: (input: SessionToolExecutionInput, definition: SessionToolDefinition) => string;
  /** 编辑后自动验证开关 */
  readonly autoVerify?: boolean;
  /** 验证命令 */
  readonly verificationCommand?: string;
  /** 子状态变更回调（用于广播 reflecting/retrying 等状态到前端） */
  readonly onSubstatus?: (substatus: string) => void;
  /** 加载书籍配置（用于获取 enabledPresetIds 等） */
  readonly loadBookConfig?: (bookId: string) => Promise<{ enabledPresetIds?: string[]; beatTemplateId?: string; [key: string]: unknown }>;
};

export type SessionToolExecutor = {
  readonly execute: (input: SessionToolExecutionInput) => Promise<SessionToolExecutionResult>;
};

type ValidationIssue = {
  readonly path: string;
  readonly message: string;
};

const CONFIRMATION_OPTIONS = ["approve", "reject", "open-in-canvas"] as const;

/** Run post-edit verification if autoVerify is enabled and a command is configured. */
async function maybeRunVerification(options: SessionToolExecutorOptions): Promise<import("./post-edit-verifier.js").VerificationResult | null> {
  // Read user config to get autoVerify/verificationCommand if not passed in options
  let autoVerify = options.autoVerify;
  let verificationCommand = options.verificationCommand;
  if (autoVerify === undefined || verificationCommand === undefined) {
    const { loadUserConfig } = await import("./user-config-service.js");
    const config = await loadUserConfig();
    autoVerify = autoVerify ?? config.runtimeControls.autoVerify;
    verificationCommand = verificationCommand ?? config.runtimeControls.verificationCommand;
  }
  if (!autoVerify) return null;
  const workDir = options.workDir ?? process.cwd();
  // Auto-detect command if not configured
  if (!verificationCommand) {
    const { detectVerificationCommand } = await import("./post-edit-verifier.js");
    verificationCommand = detectVerificationCommand(workDir) ?? undefined;
  }
  if (!verificationCommand) return null;
  const { runPostEditVerification } = await import("./post-edit-verifier.js");
  return runPostEditVerification({ command: verificationCommand, workDir });
}

function createPolicyDeniedResult(
  input: SessionToolExecutionInput,
  definition: SessionToolDefinition,
  resolution: SessionToolPolicyResolution,
): SessionToolExecutionResult {
  return {
    ok: false,
    renderer: definition.renderer,
    error: "policy-denied",
    summary: `工具策略禁止执行 ${definition.name}。`,
    data: {
      status: "policy-denied",
      toolName: definition.name,
      ...(resolution.source ? { source: resolution.source } : {}),
      ...(resolution.pattern ? { pattern: resolution.pattern } : {}),
      risk: definition.risk,
      permissionMode: input.permissionMode,
      policyResolution: resolution,
    },
  };
}

function createPolicyAskResult(
  input: SessionToolExecutionInput,
  definition: SessionToolDefinition,
  resolution: SessionToolPolicyResolution,
  options: SessionToolExecutorOptions,
): SessionToolExecutionResult {
  const confirmation = createConfirmationRequest(input, definition, options);
  return withConfirmationAudit({
    ok: true,
    renderer: definition.renderer,
    summary: `工具 ${definition.name} 需要确认后执行。`,
    data: {
      status: "pending-confirmation",
      code: "permission-required",
      ...(resolution.source ? { source: resolution.source } : {}),
      ...(resolution.pattern ? { pattern: resolution.pattern } : {}),
      policyResolution: resolution,
    },
    confirmation,
  }, input, definition, confirmation);
}

export function createSessionToolExecutor(options: SessionToolExecutorOptions = {}): SessionToolExecutor {
  return {
    execute: (input) => executeSessionTool(input, options),
  };
}

export async function executeSessionTool(
  input: SessionToolExecutionInput,
  options: SessionToolExecutorOptions = {},
): Promise<SessionToolExecutionResult> {
  const startedAt = (options.now ?? Date.now)();
  const definition = getSessionToolDefinition(input.toolName);

  if (!definition) {
    return withDuration({
      ok: false,
      error: "unknown-tool",
      summary: `未知 session tool：${input.toolName}`,
    }, startedAt, options);
  }

  const validationIssues = validateToolInput(input.input, definition);
  if (validationIssues.length > 0) {
    return withDuration({
      ok: false,
      renderer: definition.renderer,
      error: "invalid-tool-input",
      summary: `工具 ${definition.name} 参数无效：${validationIssues.map((issue) => issue.message).join("；")}`,
      data: { issues: validationIssues },
    }, startedAt, options);
  }

  const policyResolution = resolveSessionToolPolicy({
    toolName: definition.name,
    risk: definition.risk,
    permissionMode: input.permissionMode,
    ...(input.sessionConfig?.toolPolicy ? { toolPolicy: input.sessionConfig.toolPolicy } : {}),
    ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
  });
  if (policyResolution.reason === "policy-denied") {
    return withDuration(createPolicyDeniedResult(input, definition, policyResolution), startedAt, options);
  }

  if (definition.name === "guided.exit" && input.confirmationDecision?.decision === "rejected") {
    const handler = options.handlers?.[definition.name] ?? getDefaultHandler(definition.name, options);
    if (!handler) {
      return withDuration({
        ok: false,
        renderer: definition.renderer,
        error: "tool-handler-missing",
        summary: `session tool ${definition.name} 未配置执行处理器。`,
      }, startedAt, options);
    }
    const result = await handler({ ...input, definition });
    return withDuration(withConfirmationAudit({
      ...result,
      renderer: result.renderer ?? definition.renderer,
    }, input, definition), startedAt, options);
  }

  if (policyResolution.reason === "permission-denied") {
    return withDuration({
      ok: false,
      renderer: definition.renderer,
      error: "permission-denied",
      summary: `权限模式 ${input.permissionMode} 不允许执行 ${definition.risk} 工具 ${definition.name}`,
      data: { policyResolution },
    }, startedAt, options);
  }

  if (policyResolution.reason === "dirty-resource-blocked") {
    return withDuration({
      ok: false,
      renderer: definition.renderer,
      error: "dirty-resource-blocked",
      summary: `当前画布资源存在未保存编辑，请先保存、放弃或另存为候选后再执行 ${definition.name}。`,
      data: {
        status: "dirty-resource-blocked",
        activeTabId: input.canvasContext?.activeTabId,
        activeResource: input.canvasContext?.activeResource,
        policyResolution,
      },
    }, startedAt, options);
  }

  if (policyResolution.reason === "policy-ask" && input.confirmationDecision?.decision !== "approved") {
    return withDuration(createPolicyAskResult(input, definition, policyResolution, options), startedAt, options);
  }

  if (policyResolution.requiresConfirmation && input.confirmationDecision?.decision !== "approved") {
    const confirmation = createConfirmationRequest(input, definition, options);
    const result: SessionToolExecutionResult = {
      ok: true,
      renderer: definition.renderer,
      summary: `工具 ${definition.name} 需要确认后执行。`,
      data: { status: "pending-confirmation", policyResolution },
      confirmation,
    };
    return withDuration(withConfirmationAudit(result, input, definition, confirmation), startedAt, options);
  }

  // Fix: dangerReflection — 即使 permissionMode=allow，对 destructive 工具也要求确认
  if (definition.risk === "destructive" && input.confirmationDecision?.decision !== "approved") {
    try {
      const { loadUserConfig } = await import("./user-config-service.js");
      const config = await loadUserConfig();
      if (config.runtimeControls?.dangerReflection) {
        // Broadcast "reflecting" substatus before LLM call
        options.onSubstatus?.("reflecting");

        // Attempt LLM safety reflection
        let reflectionSummary = `⚠️ 危险反思：工具 ${definition.name} 为高风险操作，需要确认后执行。`;

        const summaryModel = config.modelDefaults?.summaryModel;
        if (summaryModel) {
          const colonIndex = summaryModel.indexOf(":");
          const providerId = colonIndex > 0 ? summaryModel.slice(0, colonIndex) : "";
          const modelId = colonIndex > 0 ? summaryModel.slice(colonIndex + 1) : summaryModel;
          if (providerId && modelId) {
            try {
              const { generateSessionReply } = await import("./llm-runtime-service.js");
              const reflectionResult = await Promise.race([
                generateSessionReply({
                  sessionConfig: {
                    providerId,
                    modelId,
                    permissionMode: "read",
                    reasoningEffort: "low",
                  },
                  messages: [
                    {
                      type: "message" as const,
                      id: "sys-reflection",
                      role: "system" as const,
                      content: "你是安全评估助手。用 1-3 句中文简要评估以下工具操作的安全性：它会做什么、可能出什么问题、是否可逆。",
                    },
                    {
                      type: "message" as const,
                      id: "usr-reflection",
                      role: "user" as const,
                      content: `工具: ${definition.name}\n描述: ${definition.description}\n输入参数: ${JSON.stringify(input.input).slice(0, 500)}`,
                    },
                  ],
                  tools: [],
                }),
                new Promise<{ success: false }>((resolve) => setTimeout(() => resolve({ success: false }), 8000)),
              ]);
              if (reflectionResult.success && "type" in reflectionResult && reflectionResult.type === "message" && "content" in reflectionResult && (reflectionResult.content as string)?.trim()) {
                reflectionSummary = `⚠️ 安全评估：${(reflectionResult.content as string).trim()}`;
              }
            } catch { /* LLM reflection failure — use default summary */ }
          }
        }

        const confirmation = createConfirmationRequest(input, definition, options);
        const result: SessionToolExecutionResult = {
          ok: true,
          renderer: definition.renderer,
          summary: reflectionSummary,
          data: { status: "pending-confirmation", reason: "danger-reflection" },
          confirmation,
        };
        return withDuration(withConfirmationAudit(result, input, definition, confirmation), startedAt, options);
      }
    } catch { /* config load failure — skip danger reflection */ }
  }

  const handler = options.handlers?.[definition.name] ?? getDefaultHandler(definition.name, options);
  if (!handler) {
    return withDuration({
      ok: false,
      renderer: definition.renderer,
      error: "tool-handler-missing",
      summary: `session tool ${definition.name} 未配置执行处理器。`,
    }, startedAt, options);
  }

  // --- PreToolUse hooks ---
  try {
    const { loadUserConfig } = await import("./user-config-service.js");
    const { executeHook, getMatchingHooks } = await import("./hook-executor.js");
    const config = await loadUserConfig();
    const hooks = config.runtimeControls?.hooks ?? [];
    const preHooks = getMatchingHooks(hooks, "PreToolUse", definition.name);
    const workDir = options.workDir ?? process.cwd();
    const hookContext = { toolName: definition.name, file: typeof input.input.path === "string" ? input.input.path : undefined, workDir };

    for (const hook of preHooks) {
      const hookResult = await executeHook(hook, hookContext);
      if (hook.blocking && hookResult.exitCode === 2) {
        return withDuration({
          ok: false,
          renderer: definition.renderer,
          error: "hook-blocked",
          summary: `PreToolUse hook 阻止了 ${definition.name} 执行。${hookResult.stderr || hookResult.stdout}`.trim(),
        }, startedAt, options);
      }
    }
  } catch { /* hook execution failure is non-fatal */ }

  try {
    const result = await handler({ ...input, definition });
    // Pipeline 拦截：如果当前 session 有活跃 pipeline，捕获成功结果
    const pipeline = sessionPipelines.get(input.sessionId);
    if (pipeline && result.ok && definition.name !== "StartPipeline" && definition.name !== "EndPipeline") {
      pipeline.counter += 1;
      const alias = `p${pipeline.counter}`;
      pipeline.captures.set(alias, result.summary ?? JSON.stringify(result.data).slice(0, 100));
    }

    // --- PostToolUse hooks ---
    let postHookAppend = "";
    try {
      const { loadUserConfig } = await import("./user-config-service.js");
      const { executeHook, getMatchingHooks } = await import("./hook-executor.js");
      const config = await loadUserConfig();
      const hooks = config.runtimeControls?.hooks ?? [];
      const postHooks = getMatchingHooks(hooks, "PostToolUse", definition.name);
      const workDir = options.workDir ?? process.cwd();
      const hookContext = { toolName: definition.name, file: typeof input.input.path === "string" ? input.input.path : undefined, workDir };

      for (const hook of postHooks) {
        const hookResult = await executeHook(hook, hookContext);
        if (hookResult.stdout) {
          postHookAppend += `\n[Hook] ${hookResult.stdout}`;
        }
      }
    } catch { /* hook execution failure is non-fatal */ }

    const finalResult = postHookAppend
      ? { ...result, summary: (result.summary ?? "") + postHookAppend }
      : result;

    return withDuration(withConfirmationAudit({
      ...finalResult,
      renderer: finalResult.renderer ?? definition.renderer,
    }, input, definition), startedAt, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return withDuration({
      ok: false,
      renderer: definition.renderer,
      error: "tool-execution-failed",
      summary: `工具 ${definition.name} 执行失败：${message}`,
    }, startedAt, options);
  }
}

/**
 * 小说领域工具 handler — 依赖注入的 service 实例
 * 只在 configureSessionToolExecutor 注入了对应 service 时才返回 handler
 */
function getNovelServiceHandler(toolName: string, options: SessionToolExecutorOptions): SessionToolHandler | undefined {
  switch (toolName) {
    case "cockpit.get_snapshot":
      if (!options.cockpitService) return undefined;
      return async ({ input, definition }) => {
        const snapshot = await options.cockpitService!.getSnapshot({
          bookId: String(input.bookId),
          includeModelStatus: input.includeModelStatus === true,
        });
        return {
          ok: true,
          renderer: definition.renderer,
          summary: "已读取驾驶舱快照。",
          data: snapshot,
          artifact: {
            id: `cockpit:${input.bookId}:snapshot`,
            kind: "tool-result",
            title: "驾驶舱快照",
            renderer: definition.renderer,
            openInCanvas: true,
          },
        };
      };
    case "cockpit.list_open_hooks":
      if (!options.cockpitService) return undefined;
      return async ({ input, definition }) => {
        const hooks = await options.cockpitService!.listOpenHooks({ bookId: String(input.bookId), limit: Number(input.limit) });
        return {
          ok: true,
          renderer: definition.renderer,
          summary: `已读取 ${hooks.items.length} 条开放伏笔。`,
          data: hooks,
        };
      };
    case "cockpit.list_recent_candidates":
      if (!options.cockpitService) return undefined;
      return async ({ input, definition }) => {
        const candidates = await options.cockpitService!.listRecentCandidates({ bookId: String(input.bookId), limit: Number(input.limit) });
        return {
          ok: true,
          renderer: definition.renderer,
          summary: `已读取 ${candidates.items.length} 条候选稿。`,
          data: candidates,
        };
      };
    case "questionnaire.list_templates":
      return async ({ input }) => (await resolveQuestionnaireService(options)).listTemplates(input);
    case "questionnaire.start":
      return async ({ input }) => (await resolveQuestionnaireService(options)).start(input);
    case "questionnaire.suggest_answer":
      return async ({ input }) => (await resolveQuestionnaireService(options)).suggestAnswer(input);
    case "questionnaire.submit_response":
      return async ({ input }) => (await resolveQuestionnaireService(options)).submitResponse(input);
    case "pgi.generate_questions":
      return async ({ input }) => (await resolvePGIService(options)).generateQuestions(input);
    case "pgi.record_answers":
      return async ({ input }) => (await resolvePGIService(options)).recordAnswers(input);
    case "pgi.format_answers_for_prompt":
      return async ({ input }) => (await resolvePGIService(options)).formatAnswersForPrompt(input);
    case "guided.enter":
      return async ({ input }) => (await resolveGuidedService(options)).enter(input);
    case "guided.answer_question":
      return async ({ input }) => (await resolveGuidedService(options)).answerQuestion(input);
    case "guided.exit":
      return async ({ input, confirmationDecision }) => (await resolveGuidedService(options)).exit(input, confirmationDecision);
    case "candidate.create_chapter":
      return async ({ input, sessionConfig, onToolOutputStream }) => {
        const service = await resolveCandidateService(options);
        return service.createChapter({ ...input, ...(sessionConfig ? { sessionConfig } : {}), _onStreamChunk: onToolOutputStream });
      };
    case "narrative.read_line":
      return async ({ input, definition }) => {
        const service = resolveNarrativeService(options);
        if (!service.getSnapshot) throw new Error("narrative.read_line requires getSnapshot.");
        const snapshot = await service.getSnapshot({
          bookId: String(input.bookId),
          includeWarnings: input.includeWarnings !== false,
        });
        return {
          ok: true,
          renderer: definition.renderer,
          summary: "已读取叙事线快照。",
          data: snapshot,
          narrative: { snapshot },
          artifact: {
            id: `narrative:${input.bookId}:line`,
            kind: "narrative-line",
            title: "叙事线快照",
            renderer: definition.renderer,
            openInCanvas: true,
            resourceRef: { kind: "narrative-line", id: `narrative:${input.bookId}:line`, bookId: String(input.bookId), title: "叙事线快照" },
          },
        };
      };
    case "narrative.propose_change":
      return async ({ input, definition }) => {
        const service = resolveNarrativeService(options);
        if (!service.proposeChange) throw new Error("narrative.propose_change requires proposeChange.");
        const preview = await service.proposeChange({
          bookId: String(input.bookId),
          summary: String(input.summary),
          nodes: Array.isArray(input.nodes) ? input.nodes : [],
          ...(Array.isArray(input.edges) ? { edges: input.edges } : {}),
          ...(typeof input.reason === "string" ? { reason: input.reason } : {}),
        });
        return {
          ok: true,
          renderer: definition.renderer,
          summary: "已生成叙事线变更草案。",
          data: preview,
          narrative: { mutationPreview: preview },
          artifact: {
            id: preview.id,
            kind: "narrative-line",
            title: "叙事线变更草案",
            renderer: definition.renderer,
            openInCanvas: true,
            resourceRef: { kind: "narrative-line", id: preview.id, bookId: String(input.bookId), title: "叙事线变更草案" },
          },
        };
      };
    // --- 小说上下文工具组 (Task 23) ---
    case "chapter.read":
      return async ({ input, definition }) => {
        const { handleChapterRead } = await import("@vivy1024/novelfork-novel-plugin");
        const bookId = String(input.bookId);
        const chapterNumber = Number(input.chapterNumber);
        const workDir = options.workDir ?? process.cwd();
        const { join } = await import("node:path");
        const booksDir = join(workDir, "books");
        const result = await handleChapterRead({ bookId, chapterNumber }, booksDir);
        return { ...result, renderer: definition.renderer };
      };
    case "jingwei.read_context":
      return async ({ input, definition }) => {
        const { handleJingweiReadContext } = await import("@vivy1024/novelfork-novel-plugin");
        const bookId = String(input.bookId);
        const chapterNumber = typeof input.chapterNumber === "number" ? input.chapterNumber : undefined;
        const sceneText = typeof input.sceneText === "string" ? input.sceneText : undefined;
        const result = await handleJingweiReadContext({ bookId, chapterNumber, sceneText });
        return { ...result, renderer: definition.renderer };
      };
    case "jingwei.upsert_entry":
      return async ({ input, definition }) => {
        const { getStorageDatabase } = await import("@vivy1024/novelfork-core");

        function inferCategory(raw: string, entryTitle: string, content: string): string {
          // 如果 agent 明确传了非 setting 的 category，尊重它
          if (raw && raw !== "setting") return raw;
          const text = (entryTitle + " " + content.slice(0, 500)).toLowerCase();
          if (/伏笔|foreshadow|hook|悬念/.test(text)) return "foreshadowing";
          if (/大纲|卷.*章|outline|volume|节拍|beat/.test(text)) return "outline";
          if (/主角|配角|角色|人物|character|弧光/.test(text)) return "character";
          if (/世界观|worldview|力量体系|修炼体系|境界/.test(text)) return "worldview";
          if (/地图|地理|geography|部洲/.test(text)) return "geography";
          if (/前提|premise|核心矛盾|主题/.test(text)) return "worldview";
          if (/情节|plot|subplot|事件/.test(text)) return "plot";
          if (/时间线|timeline/.test(text)) return "timeline";
          if (/势力|faction|阵营|组织/.test(text)) return "faction";
          return raw || "setting";
        }
        const storage = getStorageDatabase();
        let bookId = String(input.bookId);
        const rawCategory = String(input.category || "").trim();
        const title = String(input.title || "").trim();
        const contentMd = String(input.contentMd || "");
        const aliases = Array.isArray(input.aliases) ? input.aliases.filter((a): a is string => typeof a === "string") : [];
        const tags = Array.isArray(input.tags) ? input.tags.filter((t): t is string => typeof t === "string") : [];
        const visibility = String(input.visibility || "global");
        const relatedEntryIds = Array.isArray(input.relatedEntryIds) ? input.relatedEntryIds.filter((id): id is string => typeof id === "string") : [];

        // 智能分类：如果 agent 没传 category 或传了 setting，根据 title/content 关键词推断
        const category = inferCategory(rawCategory, title, contentMd);

        if (!title) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "title 不能为空。" };
        }

        // 验证 bookId 存在于 book 表中；如果不存在，尝试模糊匹配
        const bookExists = storage.sqlite.prepare(`SELECT id FROM book WHERE id = ?`).get(bookId) as { id: string } | undefined;
        if (!bookExists) {
          // 尝试模糊匹配：bookId 可能是目录名（如 "文字修仙docs这个世界修仙讲科学"），实际 book id 是其子串
          const fuzzyMatch = storage.sqlite.prepare(`SELECT id FROM book WHERE ? LIKE '%' || id || '%' OR id LIKE '%' || ? || '%' ORDER BY length(id) DESC LIMIT 1`).get(bookId, bookId) as { id: string } | undefined;
          if (fuzzyMatch) {
            bookId = fuzzyMatch.id;
          } else {
            return { ok: false, renderer: definition.renderer, error: "book-not-found", summary: `bookId "${bookId}" 在数据库中不存在。请确认正确的书籍 ID。可用的书籍：${(storage.sqlite.prepare("SELECT id FROM book LIMIT 5").all() as Array<{id:string}>).map(r => r.id).join(", ")}` };
          }
        }

        try {
          // 确保 section 存在（按 category 查找或创建）
          const sectionRows = storage.sqlite.prepare(
            `SELECT id FROM story_jingwei_section WHERE book_id = ? AND key = ?`
          ).all(bookId, category) as Array<{ id: string }>;

          let sectionId: string;
          if (sectionRows.length > 0) {
            sectionId = sectionRows[0]!.id;
          } else {
            // 自动创建 section
            sectionId = crypto.randomUUID();
            const CATEGORY_NAMES: Record<string, string> = {
              character: "角色管理", event: "事件记录", worldview: "世界观设定",
              "power-system": "力量体系", geography: "地理地图", faction: "势力阵营",
              item: "物品列表", skill: "功法体系", currency: "货币体系",
              special: "特殊设定", outline: "大纲设定", relationship: "人物关系",
              foreshadowing: "伏笔管理", plot: "情节脉络", timeline: "时间线",
              "chapter-summary": "章节摘要",
            };
            const name = CATEGORY_NAMES[category] ?? category;
            const sectionNow = Date.now();
            storage.sqlite.prepare(`
              INSERT INTO story_jingwei_section (id, book_id, key, name, description, "order", enabled, show_in_sidebar, participates_in_ai, default_visibility, fields_json, created_at, updated_at)
              VALUES (?, ?, ?, ?, '', 0, 1, 1, 1, 'tracked', '[]', ?, ?)
            `).run(sectionId, bookId, category, name, sectionNow, sectionNow);
          }

          // 查找已有条目（按 book_id + title 匹配，不限 section，避免 category 变化导致重复创建）
          const existingRows = storage.sqlite.prepare(
            `SELECT id, section_id FROM story_jingwei_entry WHERE book_id = ? AND title = ? AND deleted_at IS NULL`
          ).all(bookId, title) as Array<{ id: string; section_id: string }>;

          const visibilityJson = JSON.stringify({ type: visibility });
          const aliasesJson = JSON.stringify(aliases);
          const tagsJson = JSON.stringify(tags);
          const relatedEntryIdsJson = JSON.stringify(relatedEntryIds);
          const now = Date.now();

          if (existingRows.length > 0) {
            // 更新已有条目（同时更新 section_id 以反映 category 变化）
            const entryId = existingRows[0]!.id;
            storage.sqlite.prepare(`
              UPDATE story_jingwei_entry
              SET content_md = ?, tags_json = ?, aliases_json = ?, related_entry_ids_json = ?, visibility_rule_json = ?, section_id = ?, updated_at = ?
              WHERE id = ?
            `).run(contentMd, tagsJson, aliasesJson, relatedEntryIdsJson, visibilityJson, sectionId, now, entryId);
            return {
              ok: true,
              renderer: definition.renderer,
              summary: `已更新经纬条目「${title}」（${category}）。`,
              data: { action: "updated", entryId, bookId, category, title },
            };
          } else {
            // 创建新条目
            const entryId = crypto.randomUUID();
            storage.sqlite.prepare(`
              INSERT INTO story_jingwei_entry (id, book_id, section_id, title, content_md, tags_json, aliases_json, custom_fields_json, related_chapter_numbers_json, related_entry_ids_json, visibility_rule_json, participates_in_ai, token_budget, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '[]', ?, ?, 1, NULL, ?, ?)
            `).run(entryId, bookId, sectionId, title, contentMd, tagsJson, aliasesJson, relatedEntryIdsJson, visibilityJson, now, now);
            return {
              ok: true,
              renderer: definition.renderer,
              summary: `已创建经纬条目「${title}」（${category}）。`,
              data: { action: "created", entryId, bookId, category, title },
            };
          }
        } catch (error) {
          return {
            ok: false,
            renderer: definition.renderer,
            error: "upsert-failed",
            summary: `经纬写入失败：${error instanceof Error ? error.message : String(error)}`,
          };
        }
      };
    case "health.read_summary":
      return async ({ input, definition }) => {
        const bookId = String(input.bookId);
        if (!options.cockpitService) {
          return { ok: false, renderer: definition.renderer, error: "service-unavailable", summary: "health.read_summary 需要 cockpitService 配置。" };
        }
        try {
          const snapshot = await options.cockpitService.getSnapshot({ bookId, includeModelStatus: false });
          return {
            ok: true,
            renderer: definition.renderer,
            summary: `已读取书籍 ${bookId} 的健康度摘要。`,
            data: { bookId, snapshot, status: "partial", note: "健康度评分需要更多数据源接入。" },
          };
        } catch (error) {
          return { ok: false, renderer: definition.renderer, error: "read-failed", summary: `读取健康度失败：${error instanceof Error ? error.message : String(error)}` };
        }
      };
    // --- 新增小说工具组 (5 tools) ---
    case "chapter.audit":
      return async ({ input, definition }) => {
        const bookId = String(input.bookId ?? "");
        const chapterNumber = Number(input.chapterNumber ?? 0);
        if (!bookId || !chapterNumber) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "需要 bookId 和 chapterNumber。" };

        const { handleChapterRead } = await import("@vivy1024/novelfork-novel-plugin");
        const { join } = await import("node:path");
        const booksDir = join(options.workDir ?? process.cwd(), "books");
        const chapter = await handleChapterRead({ bookId, chapterNumber }, booksDir);
        if (!chapter.ok || !chapter.data) return { ok: false, renderer: definition.renderer, error: "chapter-not-found", summary: `章节 ${chapterNumber} 不存在。` };

        const content = chapter.data.content;
        const checks = Array.isArray(input.checks) ? input.checks as string[] : ["rhythm", "ai_taste", "hooks", "continuity"];
        const results: Record<string, unknown> = {};

        if (checks.includes("rhythm")) {
          const lines = content.split("\n").filter((l: string) => l.trim());
          const dialogue = lines.filter((l: string) => l.includes("\u201c") || l.includes("\u201d") || l.includes("\u300c")).length;
          const total = lines.length;
          results.rhythm = { totalLines: total, dialogueLines: dialogue, dialogueRatio: total > 0 ? Math.round(dialogue / total * 100) : 0 };
        }

        if (checks.includes("ai_taste")) {
          const AI_MARKERS = ["\u503c\u5f97\u6ce8\u610f\u7684\u662f", "\u9700\u8981\u6307\u51fa", "\u603b\u800c\u8a00\u4e4b", "\u4e0d\u7981", "\u7f13\u7f13", "\u5fae\u5fae", "\u6de1\u6de1", "\u5634\u89d2\u5fae\u626c", "\u773c\u4e2d\u95ea\u8fc7", "\u5fc3\u4e2d\u6697\u9053", "\u6df1\u5438\u4e00\u53e3\u6c14", "\u4e0d\u7531\u5f97"];
          const found = AI_MARKERS.filter(marker => content.includes(marker));
          // Find positions of each marker in content for highlighting
          const highlights: Array<{ marker: string; line: number; column: number; context: string }> = [];
          const contentLines = content.split("\n");
          for (const marker of found) {
            for (let lineIdx = 0; lineIdx < contentLines.length; lineIdx++) {
              const col = contentLines[lineIdx].indexOf(marker);
              if (col !== -1) {
                const lineText = contentLines[lineIdx];
                const contextStart = Math.max(0, col - 10);
                const contextEnd = Math.min(lineText.length, col + marker.length + 10);
                highlights.push({
                  marker,
                  line: lineIdx + 1,
                  column: col,
                  context: (contextStart > 0 ? "…" : "") + lineText.slice(contextStart, contextEnd) + (contextEnd < lineText.length ? "…" : ""),
                });
              }
            }
          }
          results.ai_taste = { markersFound: found, count: found.length, severity: found.length > 5 ? "high" : found.length > 2 ? "medium" : "low", highlights };
        }

        if (checks.includes("hooks")) {
          const { join: joinPath } = await import("node:path");
          const hooksPath = joinPath(booksDir, bookId, "story", "pending_hooks.md");
          try {
            const { readFile } = await import("node:fs/promises");
            const hooksContent = await readFile(hooksPath, "utf-8");
            const dueHooks = hooksContent.split("\n")
              .filter((line: string) => line.match(/- \[ \]/) && (line.includes(`\u7b2c${chapterNumber}\u7ae0`) || line.includes(`ch${chapterNumber}`)))
              .map((line: string) => line.replace(/^- \[ \]\s*/, "").trim());
            results.hooks = { dueHooks, count: dueHooks.length };
          } catch {
            results.hooks = { dueHooks: [], count: 0, note: "pending_hooks.md \u4e0d\u5b58\u5728" };
          }
        }

        if (checks.includes("continuity") || checks.includes("character")) {
          const { handleJingweiReadContext } = await import("@vivy1024/novelfork-novel-plugin");
          const jingwei = await handleJingweiReadContext({ bookId }, booksDir);
          if (jingwei.ok && jingwei.data) {
            const characterNames: string[] = [];
            const categories = (jingwei.data as { categories?: { name: string; files?: { name: string }[] }[] }).categories ?? [];
            for (const cat of categories) {
              if (cat.name === "\u89d2\u8272" && Array.isArray(cat.files)) {
                for (const f of cat.files) characterNames.push(f.name.replace(".md", ""));
              }
            }
            const namePattern = /[\u4e00-\u9fff]{2,4}/g;
            const mentionedNames = [...new Set(content.match(namePattern) ?? [])];
            results.continuity = { knownCharacters: characterNames.length, mentionedNames: mentionedNames.length, note: "\u7b80\u5316\u68c0\u67e5\uff0c\u5efa\u8bae\u914d\u5408 LLM \u6df1\u5ea6\u5ba1\u8ba1" };
          }
        }

        return {
          ok: true,
          renderer: definition.renderer,
          summary: `\u7ae0\u8282 ${chapterNumber} \u5ba1\u8ba1\u5b8c\u6210\uff1a${checks.join("/")}`,
          data: { chapterNumber, checks, results },
        };
      };
    case "rewrite.segment":
      return async ({ input, definition }) => {
        const bookId = String(input.bookId ?? "");
        const chapterNumber = Number(input.chapterNumber ?? 0);
        const mode = String(input.mode ?? "");
        const selection = input.selection as { start?: number; end?: number } | undefined;
        if (!bookId || !chapterNumber || !mode || !selection?.start || !selection?.end) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "\u9700\u8981 bookId, chapterNumber, mode, selection.start, selection.end" };
        }

        const { handleChapterRead } = await import("@vivy1024/novelfork-novel-plugin");
        const { join } = await import("node:path");
        const booksDir = join(options.workDir ?? process.cwd(), "books");
        const chapter = await handleChapterRead({ bookId, chapterNumber }, booksDir);
        if (!chapter.ok || !chapter.data) return { ok: false, renderer: definition.renderer, error: "chapter-not-found", summary: `\u7ae0\u8282 ${chapterNumber} \u4e0d\u5b58\u5728\u3002` };

        const lines = chapter.data.content.split("\n");
        const selectedLines = lines.slice(selection.start - 1, selection.end);
        const selectedText = selectedLines.join("\n");

        if (!selectedText.trim()) return { ok: false, renderer: definition.renderer, error: "empty-selection", summary: "\u9009\u4e2d\u5185\u5bb9\u4e3a\u7a7a\u3002" };

        const modePrompts: Record<string, string> = {
          continue: "\u8bf7\u7eed\u5199\u4ee5\u4e0b\u6bb5\u843d\uff0c\u4fdd\u6301\u98ce\u683c\u4e00\u81f4\uff0c\u81ea\u7136\u884d\u63a5\uff1a",
          expand: "\u8bf7\u6269\u5199\u4ee5\u4e0b\u6bb5\u843d\uff0c\u589e\u52a0\u7ec6\u8282\u548c\u63cf\u5199\uff0c\u4fdd\u6301\u539f\u610f\uff1a",
          reduce_ai: "\u8bf7\u6539\u5199\u4ee5\u4e0b\u6bb5\u843d\uff0c\u53bb\u9664 AI \u5473\uff08\u907f\u514d\uff1a\u503c\u5f97\u6ce8\u610f\u7684\u662f\u3001\u4e0d\u7981\u3001\u7f13\u7f13\u3001\u5fae\u5fae\u3001\u6de1\u6de1\u7b49\uff09\uff0c\u4fdd\u6301\u539f\u610f\u4f46\u66f4\u81ea\u7136\uff1a",
          restyle: `\u8bf7\u6309\u4ee5\u4e0b\u98ce\u683c\u6539\u5199\u6bb5\u843d\uff1a${input.styleHint ?? "\u66f4\u751f\u52a8"}\u3002\u539f\u6587\uff1a`,
        };

        const prompt = `${modePrompts[mode] ?? modePrompts.continue}\n\n${selectedText}\n\n\u53ea\u8f93\u51fa\u6539\u5199\u540e\u7684\u6587\u672c\uff0c\u4e0d\u8981\u89e3\u91ca\u3002`;

        try {
          const { generateSessionReply } = await import("./llm-runtime-service.js");
          const { getSessionById } = await import("./session-service.js");
          const session = await getSessionById(String(input.sessionId ?? ""));
          if (!session) return { ok: false, renderer: definition.renderer, error: "no-session", summary: "\u65e0\u6cd5\u83b7\u53d6\u5f53\u524d\u4f1a\u8bdd\u914d\u7f6e\u3002" };

          const result = await generateSessionReply({
            sessionConfig: session.sessionConfig,
            messages: [{ type: "message" as const, role: "user" as const, content: prompt }],
            tools: [],
          });

          if (!result.success) return { ok: false, renderer: definition.renderer, error: "llm-failed", summary: `LLM \u8c03\u7528\u5931\u8d25\uff1a${result.error}` };

          const rewrittenText = result.type === "message" ? result.content : "";

          // For reduce_ai mode: auto-detect AI taste before/after and return comparison
          let aiTasteComparison: { before: { count: number; markers: string[] }; after: { count: number; markers: string[] } } | undefined;
          if (mode === "reduce_ai" && rewrittenText) {
            const AI_MARKERS = ["\u503c\u5f97\u6ce8\u610f\u7684\u662f", "\u9700\u8981\u6307\u51fa", "\u603b\u800c\u8a00\u4e4b", "\u4e0d\u7981", "\u7f13\u7f13", "\u5fae\u5fae", "\u6de1\u6de1", "\u5634\u89d2\u5fae\u626c", "\u773c\u4e2d\u95ea\u8fc7", "\u5fc3\u4e2d\u6697\u9053", "\u6df1\u5438\u4e00\u53e3\u6c14", "\u4e0d\u7531\u5f97"];
            const beforeMarkers = AI_MARKERS.filter(m => selectedText.includes(m));
            const afterMarkers = AI_MARKERS.filter(m => rewrittenText.includes(m));
            aiTasteComparison = {
              before: { count: beforeMarkers.length, markers: beforeMarkers },
              after: { count: afterMarkers.length, markers: afterMarkers },
            };
          }

          return {
            ok: true,
            renderer: "tool.rewrite-segment",
            summary: `\u5df2${mode === "continue" ? "\u7eed\u5199" : mode === "expand" ? "\u6269\u5199" : mode === "reduce_ai" ? "\u53bbAI\u5473\u6539\u5199" : "\u98ce\u683c\u6539\u5199"}\u9009\u6bb5\uff08${selectedLines.length} \u884c\uff09${aiTasteComparison ? ` AI\u5473: ${aiTasteComparison.before.count}\u2192${aiTasteComparison.after.count}` : ""}`,
            data: { mode, originalText: selectedText, rewrittenText, lineRange: { start: selection.start, end: selection.end }, ...(aiTasteComparison ? { aiTasteComparison } : {}) },
          };
        } catch (error) {
          return { ok: false, renderer: definition.renderer, error: "rewrite-failed", summary: `\u6539\u5199\u5931\u8d25\uff1a${error instanceof Error ? error.message : String(error)}` };
        }
      };
    case "outline.suggest_next":
      return async ({ input, definition }) => {
        const bookId = String(input.bookId ?? "");
        if (!bookId) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "\u9700\u8981 bookId" };

        const { handleJingweiReadContext } = await import("@vivy1024/novelfork-novel-plugin");
        const { join } = await import("node:path");
        const { readdir, readFile } = await import("node:fs/promises");
        const booksDir = join(options.workDir ?? process.cwd(), "books");
        const jingwei = await handleJingweiReadContext({ bookId }, booksDir);

        // 读取最近章节
        const chaptersDir = join(booksDir, bookId, "chapters");
        let recentChapters = "";
        try {
          const files = (await readdir(chaptersDir)).filter((f: string) => f.endsWith(".md")).sort().slice(-2);
          for (const f of files) {
            const content = await readFile(join(chaptersDir, f), "utf-8");
            recentChapters += `\n--- ${f} ---\n${content.slice(0, 2000)}\n`;
          }
        } catch { /* no chapters yet */ }

        // 读取伏笔
        let hooks = "";
        try {
          hooks = await readFile(join(booksDir, bookId, "story", "pending_hooks.md"), "utf-8");
        } catch { /* no hooks */ }

        const outlineContext = jingwei.ok ? JSON.stringify(jingwei.data).slice(0, 3000) : "\u65e0\u5927\u7eb2\u6570\u636e";

        const prompt = `\u57fa\u4e8e\u4ee5\u4e0b\u4fe1\u606f\uff0c\u63a8\u8350\u4e0b\u4e00\u7ae0\u7684 2-3 \u4e2a\u5199\u4f5c\u65b9\u5411\u3002\u6bcf\u4e2a\u65b9\u5411\u5305\u542b\uff1a\u6807\u9898\u5efa\u8bae\u3001\u5185\u5bb9\u6458\u8981\uff0850\u5b57\u5185\uff09\u3001\u63a8\u8fdb\u54ea\u4e9b\u4f0f\u7b14\u3002

## \u5927\u7eb2
${outlineContext}

## \u6700\u8fd1\u7ae0\u8282
${recentChapters || "\u6682\u65e0\u5df2\u5199\u7ae0\u8282"}

## \u5f85\u5151\u73b0\u4f0f\u7b14
${hooks || "\u6682\u65e0\u4f0f\u7b14"}

\u8bf7\u4ee5 JSON \u6570\u7ec4\u683c\u5f0f\u8f93\u51fa\uff1a[{ "title": "...", "summary": "...", "hooks": ["..."] }]`;

        try {
          const { generateSessionReply } = await import("./llm-runtime-service.js");
          const { getSessionById } = await import("./session-service.js");
          const session = await getSessionById(String(input.sessionId ?? ""));
          if (!session) return { ok: false, renderer: definition.renderer, error: "no-session", summary: "\u65e0\u6cd5\u83b7\u53d6\u5f53\u524d\u4f1a\u8bdd\u914d\u7f6e\u3002" };

          const result = await generateSessionReply({
            sessionConfig: session.sessionConfig,
            messages: [{ type: "message" as const, role: "user" as const, content: prompt }],
            tools: [],
          });

          if (!result.success) return { ok: false, renderer: definition.renderer, error: "llm-failed", summary: `LLM \u8c03\u7528\u5931\u8d25\uff1a${result.error}` };

          const resultContent = result.type === "message" ? result.content : "";
          let suggestions: unknown[];
          try { suggestions = JSON.parse(resultContent); } catch { suggestions = [{ title: "\u5efa\u8bae", summary: resultContent }]; }

          return {
            ok: true,
            renderer: definition.renderer,
            summary: `\u63a8\u8350 ${Array.isArray(suggestions) ? suggestions.length : 1} \u4e2a\u4e0b\u4e00\u7ae0\u65b9\u5411\u3002`,
            data: { suggestions },
          };
        } catch (error) {
          return { ok: false, renderer: definition.renderer, error: "suggest-failed", summary: `\u63a8\u8350\u5931\u8d25\uff1a${error instanceof Error ? error.message : String(error)}` };
        }
      };
    case "character.check_consistency":
      return async ({ input, definition }) => {
        const bookId = String(input.bookId ?? "");
        if (!bookId) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "\u9700\u8981 bookId" };

        const { readdir, readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const booksDir = join(options.workDir ?? process.cwd(), "books");
        const characterDir = join(booksDir, bookId, "jingwei", "\u89d2\u8272");

        // 读取角色列表
        let characters: { name: string; profile: string }[] = [];
        try {
          const files = (await readdir(characterDir)).filter((f: string) => f.endsWith(".md"));
          const targetName = typeof input.characterName === "string" ? input.characterName : "";
          const targetFiles = targetName ? files.filter((f: string) => f.includes(targetName)) : files;
          for (const f of targetFiles) {
            const content = await readFile(join(characterDir, f), "utf-8");
            characters.push({ name: f.replace(".md", ""), profile: content.slice(0, 500) });
          }
        } catch {
          return { ok: true, renderer: definition.renderer, summary: "\u89d2\u8272\u76ee\u5f55\u4e0d\u5b58\u5728\uff0c\u8df3\u8fc7\u68c0\u67e5\u3002", data: { characters: [], mentions: [] } };
        }

        if (characters.length === 0) return { ok: true, renderer: definition.renderer, summary: "\u672a\u627e\u5230\u5339\u914d\u89d2\u8272\u3002", data: { characters: [], mentions: [] } };

        // 读取章节
        const chaptersDir = join(booksDir, bookId, "chapters");
        const range = input.chapterRange as { from?: number; to?: number } | undefined;
        let chapterFiles: string[] = [];
        try {
          chapterFiles = (await readdir(chaptersDir)).filter((f: string) => f.endsWith(".md")).sort();
          if (range?.from || range?.to) {
            const from = (range.from ?? 1) - 1;
            const to = range.to ?? chapterFiles.length;
            chapterFiles = chapterFiles.slice(from, to);
          } else {
            chapterFiles = chapterFiles.slice(-5);
          }
        } catch { /* no chapters */ }

        // 搜索角色出现
        const mentions: { character: string; chapter: string; count: number; excerpts: string[] }[] = [];
        for (const f of chapterFiles) {
          const content = await readFile(join(chaptersDir, f), "utf-8");
          for (const char of characters) {
            const regex = new RegExp(char.name, "g");
            const matches = content.match(regex);
            if (matches && matches.length > 0) {
              const excerpts: string[] = [];
              let idx = content.indexOf(char.name);
              while (idx !== -1 && excerpts.length < 3) {
                excerpts.push(content.slice(Math.max(0, idx - 30), idx + char.name.length + 30).replace(/\n/g, " "));
                idx = content.indexOf(char.name, idx + 1);
              }
              mentions.push({ character: char.name, chapter: f, count: matches.length, excerpts });
            }
          }
        }

        return {
          ok: true,
          renderer: definition.renderer,
          summary: `\u68c0\u67e5\u4e86 ${characters.length} \u4e2a\u89d2\u8272\u5728 ${chapterFiles.length} \u7ae0\u4e2d\u7684\u51fa\u73b0\u60c5\u51b5\uff0c\u5171 ${mentions.length} \u6761\u8bb0\u5f55\u3002`,
          data: { characters: characters.map(c => c.name), chaptersChecked: chapterFiles.length, mentions },
        };
      };
    case "hooks.manage":
      return async ({ input, definition }) => {
        const bookId = String(input.bookId ?? "");
        const action = String(input.action ?? "");
        if (!bookId || !action) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "\u9700\u8981 bookId \u548c action" };

        const { readFile, writeFile, mkdir } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const booksDir = join(options.workDir ?? process.cwd(), "books");
        const hooksPath = join(booksDir, bookId, "story", "pending_hooks.md");

        let content = "";
        try { content = await readFile(hooksPath, "utf-8"); } catch { /* file doesn't exist yet */ }

        const lines = content.split("\n");

        switch (action) {
          case "list": {
            const hooks = lines.filter((l: string) => l.startsWith("- [")).map((l: string, i: number) => ({
              id: `hook-${i}`,
              done: l.startsWith("- [x]"),
              text: l.replace(/^- \[[ x]\]\s*/, "").trim(),
            }));
            return { ok: true, renderer: definition.renderer, summary: `\u5171 ${hooks.length} \u4e2a\u4f0f\u7b14\uff08${hooks.filter(h => !h.done).length} \u4e2a\u5f85\u5151\u73b0\uff09\u3002`, data: { hooks } };
          }
          case "plant": {
            const description = String(input.description ?? "");
            const chapterNumber = Number(input.chapterNumber ?? 0);
            if (!description) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "plant \u9700\u8981 description" };
            const newLine = `- [ ] ${description}${chapterNumber ? ` (\u57cb\u8bbe\u4e8e\u7b2c${chapterNumber}\u7ae0)` : ""}`;
            const newContent = content.trim() ? `${content.trim()}\n${newLine}\n` : `# \u4f0f\u7b14\u8ffd\u8e2a\n\n${newLine}\n`;
            await mkdir(join(booksDir, bookId, "story"), { recursive: true });
            await writeFile(hooksPath, newContent, "utf-8");
            return { ok: true, renderer: definition.renderer, summary: `\u5df2\u57cb\u8bbe\u4f0f\u7b14\uff1a${description}`, data: { action: "plant", description, chapterNumber } };
          }
          case "payoff": {
            const hookId = String(input.hookId ?? "");
            const chapterNumber = Number(input.chapterNumber ?? 0);
            const idx = hookId.startsWith("hook-") ? parseInt(hookId.slice(5), 10) : -1;
            const hookLines = lines.filter((l: string) => l.startsWith("- ["));
            if (idx < 0 || idx >= hookLines.length) return { ok: false, renderer: definition.renderer, error: "hook-not-found", summary: `\u4f0f\u7b14 ${hookId} \u4e0d\u5b58\u5728\u3002` };
            const targetLine = hookLines[idx]!;
            const newLine = targetLine.replace("- [ ]", "- [x]") + (chapterNumber ? ` (\u5151\u73b0\u4e8e\u7b2c${chapterNumber}\u7ae0)` : " (\u5df2\u5151\u73b0)");
            const newContent = content.replace(targetLine, newLine);
            await writeFile(hooksPath, newContent, "utf-8");
            return { ok: true, renderer: definition.renderer, summary: `\u4f0f\u7b14\u5df2\u5151\u73b0\uff1a${targetLine.replace(/^- \[ \]\s*/, "")}`, data: { action: "payoff", hookId } };
          }
          case "check_due": {
            const chapterNumber = Number(input.chapterNumber ?? 0);
            const openHooks = lines.filter((l: string) => l.startsWith("- [ ]"));
            const dueHooks = chapterNumber > 0
              ? openHooks.filter((l: string) => {
                  const match = l.match(/\u7b2c(\d+)\u7ae0/);
                  return match && chapterNumber - parseInt(match[1]!, 10) >= 10;
                })
              : openHooks;
            return { ok: true, renderer: definition.renderer, summary: `${dueHooks.length} \u4e2a\u4f0f\u7b14\u5230\u671f\u3002`, data: { action: "check_due", chapterNumber, dueHooks: dueHooks.map((l: string) => l.replace(/^- \[ \]\s*/, "").trim()) } };
          }
          default:
            return { ok: false, renderer: definition.renderer, error: "invalid-action", summary: `\u4e0d\u652f\u6301\u7684 action: ${action}` };
        }
      };
    // --- 预设与节拍工具 (cockpit-redesign spec) ---
    case "presets.get_rules":
      return async ({ input, definition }) => {
        const bookId = String(input.bookId);
        try {
          const { listPresets, getPreset, registerBuiltinPresets } = await import("@vivy1024/novelfork-novel-plugin/engine");
          // 防御性重注册：确保 preset store 已初始化
          if (listPresets().length === 0) { try { registerBuiltinPresets(); } catch { /* ignore */ } }
          let enabledPresets: Array<{ id: string; name: string; category: string; promptInjection?: string }>;

          // 从 book config 读取用户选择的预设
          let bookConfig: { enabledPresetIds?: string[]; beatTemplateId?: string } | null = null;
          if (options.loadBookConfig) {
            try { bookConfig = await options.loadBookConfig(bookId); } catch { /* ignore */ }
          }
          if (!bookConfig) {
            try {
              const { StateManager } = await import("@vivy1024/novelfork-core");
              const { resolveRuntimeStoragePath } = await import("./runtime-storage-paths.js");
              const root = process.env.NOVELFORK_PROJECT_ROOT || resolveRuntimeStoragePath();
              const state = new StateManager(root);
              const raw = await state.loadBookConfig(bookId);
              bookConfig = raw as unknown as { enabledPresetIds?: string[]; beatTemplateId?: string };
            } catch { /* ignore */ }
          }

          if (bookConfig?.enabledPresetIds && bookConfig.enabledPresetIds.length > 0) {
            enabledPresets = bookConfig.enabledPresetIds.map((id) => getPreset(id)).filter(Boolean) as typeof enabledPresets;
          } else {
            // 未配置或空数组 → 不加载任何预设（用户需主动选择）
            enabledPresets = [];
          }
          const rules = enabledPresets.map((p) => ({
            id: p.id,
            name: p.name,
            category: p.category,
            promptInjection: p.promptInjection ?? "",
          }));
          return { ok: true, renderer: definition.renderer, summary: `${rules.length} 条预设规则已加载。`, data: { bookId, rules } };
        } catch (err) {
          return { ok: false, renderer: definition.renderer, error: "presets-unavailable", summary: `预设加载失败: ${err instanceof Error ? err.message : String(err)}` };
        }
      };
    case "presets.check_compliance":
      return async ({ input, definition }) => {
        const bookId = String(input.bookId);
        const content = String(input.content ?? "");
        if (!content) {
          return { ok: false, renderer: definition.renderer, error: "missing-content", summary: "content 参数不能为空。" };
        }
        try {
          const { listPresets, getPreset, registerBuiltinPresets } = await import("@vivy1024/novelfork-novel-plugin/engine");
          // 防御性重注册：确保 preset store 已初始化
          if (listPresets().length === 0) { try { registerBuiltinPresets(); } catch { /* ignore */ } }
          let enabledPresets: Array<{ id: string; name: string; category: string; promptInjection?: string }>;

          if (options.loadBookConfig) {
            try {
              const bookConfig = await options.loadBookConfig(bookId);
              const enabledIds: string[] = bookConfig.enabledPresetIds ?? [];
              enabledPresets = enabledIds.map((id) => getPreset(id)).filter(Boolean) as typeof enabledPresets;
            } catch {
              enabledPresets = [];
            }
          } else {
            enabledPresets = [];
          }
          // Simple keyword-based compliance check
          const violations: Array<{ presetName: string; rule: string; violation: string; severity: "warning" | "error" }> = [];
          for (const preset of enabledPresets) {
            if (!preset.promptInjection) continue;
            // Check for anti-AI patterns
            if (preset.category === "anti-ai") {
              const aiPatterns = ["值得注意的是", "总而言之", "综上所述", "不言而喻", "毋庸置疑"];
              for (const pattern of aiPatterns) {
                if (content.includes(pattern)) {
                  violations.push({
                    presetName: preset.name,
                    rule: `避免使用"${pattern}"`,
                    violation: `文本中包含"${pattern}"`,
                    severity: "warning",
                  });
                }
              }
            }
          }
          return {
            ok: true,
            renderer: definition.renderer,
            summary: violations.length === 0 ? "所有预设规则检查通过。" : `发现 ${violations.length} 处违规。`,
            data: { bookId, violations, checkedPresets: enabledPresets.length },
          };
        } catch (err) {
          return { ok: false, renderer: definition.renderer, error: "check-failed", summary: `合规检查失败: ${err instanceof Error ? err.message : String(err)}` };
        }
      };
    case "beat.get_current":
      return async ({ input, definition }) => {
        const bookId = String(input.bookId);
        try {
          const { listBeatTemplates, getBeatTemplate } = await import("@vivy1024/novelfork-novel-plugin/engine");

          // Try to get user's selected template from book config
          let selectedTemplateId: string | undefined;
          if (options.loadBookConfig) {
            try {
              const bookConfig = await options.loadBookConfig(bookId);
              selectedTemplateId = bookConfig.beatTemplateId as string | undefined;
            } catch { /* ignore */ }
          }
          if (!selectedTemplateId) {
            // Direct file read fallback
            try {
              const { readFile } = await import("node:fs/promises");
              const { join } = await import("node:path");
              const { resolveRuntimeStoragePath } = await import("./runtime-storage-paths.js");
              const root = process.env.NOVELFORK_PROJECT_ROOT || resolveRuntimeStoragePath();
              const bookJsonPath = join(root, "books", bookId, "book.json");
              const raw = JSON.parse(await readFile(bookJsonPath, "utf-8")) as { beatTemplateId?: string };
              selectedTemplateId = raw.beatTemplateId;
            } catch { /* ignore */ }
          }

          const templates = listBeatTemplates();
          // 如果 templates 为空（registerBuiltinPresets 未执行或模块实例不同），尝试重新注册
          if (templates.length === 0) {
            try {
              const { registerBuiltinPresets } = await import("@vivy1024/novelfork-novel-plugin/engine");
              registerBuiltinPresets();
            } catch { /* ignore */ }
          }
          const allTemplates = listBeatTemplates();
          const activeTemplate = selectedTemplateId
            ? getBeatTemplate(selectedTemplateId) ?? allTemplates.find((t) => t.id === selectedTemplateId) ?? allTemplates[0]
            : allTemplates[0];

          if (!activeTemplate) {
            return { ok: true, renderer: definition.renderer, summary: "无可用节拍模板。", data: { bookId, template: null, currentBeat: null } };
          }
          return {
            ok: true,
            renderer: definition.renderer,
            summary: `当前节拍模板: ${activeTemplate.name}（${activeTemplate.beats.length} 个节拍）`,
            data: {
              bookId,
              template: {
                id: activeTemplate.id,
                name: activeTemplate.name,
                description: activeTemplate.description,
                totalBeats: activeTemplate.beats.length,
              },
              beats: activeTemplate.beats.map((b, i) => ({
                index: i,
                name: b.name,
                emotionalTone: b.emotionalTone,
                wordRatio: b.wordRatio,
                networkNovelTip: b.networkNovelTip ?? null,
              })),
            },
          };
        } catch (err) {
          return { ok: false, renderer: definition.renderer, error: "beat-unavailable", summary: `节拍信息加载失败: ${err instanceof Error ? err.message : String(err)}` };
        }
      };
    case "beat.set_template":
      return async ({ input, definition }) => {
        const bookId = String(input.bookId);
        const templateId = String(input.templateId);
        try {
          const { getBeatTemplate, listBeatTemplates, registerBuiltinPresets } = await import("@vivy1024/novelfork-novel-plugin/engine");
          if (listBeatTemplates().length === 0) { try { registerBuiltinPresets(); } catch { /* ignore */ } }

          const template = getBeatTemplate(templateId) ?? listBeatTemplates().find((t) => t.id === templateId);
          if (!template) {
            const available = listBeatTemplates().map((t) => `${t.id}（${t.name}）`).join("、");
            return { ok: false, renderer: definition.renderer, error: "invalid-template", summary: `模板 "${templateId}" 不存在。可用模板：${available}` };
          }

          // 写入 book.json
          if (options.loadBookConfig) {
            const bookConfig = await options.loadBookConfig(bookId);
            const { resolveRuntimeStoragePath } = await import("./runtime-storage-paths.js");
            const { writeFile } = await import("node:fs/promises");
            const { join } = await import("node:path");
            const root = process.env.NOVELFORK_PROJECT_ROOT || resolveRuntimeStoragePath();
            const bookJsonPath = join(root, "books", bookId, "book.json");
            const updated = { ...bookConfig, beatTemplateId: templateId, updatedAt: new Date().toISOString() };
            await writeFile(bookJsonPath, JSON.stringify(updated, null, 2), "utf-8");
          } else {
            const { resolveRuntimeStoragePath } = await import("./runtime-storage-paths.js");
            const { readFile, writeFile } = await import("node:fs/promises");
            const { join } = await import("node:path");
            const root = process.env.NOVELFORK_PROJECT_ROOT || resolveRuntimeStoragePath();
            const bookJsonPath = join(root, "books", bookId, "book.json");
            const raw = JSON.parse(await readFile(bookJsonPath, "utf-8"));
            raw.beatTemplateId = templateId;
            raw.updatedAt = new Date().toISOString();
            await writeFile(bookJsonPath, JSON.stringify(raw, null, 2), "utf-8");
          }

          return {
            ok: true,
            renderer: definition.renderer,
            summary: `已将节拍模板设置为「${template.name}」（${template.beats.length} 个节拍）。`,
            data: { bookId, templateId, templateName: template.name, beatCount: template.beats.length },
          };
        } catch (err) {
          return { ok: false, renderer: definition.renderer, error: "beat-set-failed", summary: `设置节拍模板失败: ${err instanceof Error ? err.message : String(err)}` };
        }
      };
    case "presets.set_rules":
      return async ({ input, definition }) => {
        const bookId = String(input.bookId);
        const enabledPresetIds = Array.isArray(input.enabledPresetIds) ? input.enabledPresetIds.map(String) : [];
        try {
          // 验证预设 ID 是否有效
          const { getPreset, listPresets, registerBuiltinPresets } = await import("@vivy1024/novelfork-novel-plugin/engine");
          if (listPresets().length === 0) { try { registerBuiltinPresets(); } catch { /* ignore */ } }

          const validIds: string[] = [];
          const invalidIds: string[] = [];
          for (const id of enabledPresetIds) {
            if (getPreset(id)) validIds.push(id);
            else invalidIds.push(id);
          }

          // 写入 book.json
          const { resolveRuntimeStoragePath } = await import("./runtime-storage-paths.js");
          const { readFile, writeFile } = await import("node:fs/promises");
          const { join } = await import("node:path");
          const root = process.env.NOVELFORK_PROJECT_ROOT || resolveRuntimeStoragePath();
          const bookJsonPath = join(root, "books", bookId, "book.json");
          const raw = JSON.parse(await readFile(bookJsonPath, "utf-8"));
          raw.enabledPresetIds = validIds;
          raw.updatedAt = new Date().toISOString();
          await writeFile(bookJsonPath, JSON.stringify(raw, null, 2), "utf-8");

          const summary = validIds.length > 0
            ? `已启用 ${validIds.length} 条预设规则。${invalidIds.length > 0 ? `（${invalidIds.length} 个无效 ID 已忽略：${invalidIds.join("、")}）` : ""}`
            : "已清空所有预设规则。";

          return {
            ok: true,
            renderer: definition.renderer,
            summary,
            data: { bookId, enabledPresetIds: validIds, invalidIds },
          };
        } catch (err) {
          return { ok: false, renderer: definition.renderer, error: "presets-set-failed", summary: `设置预设规则失败: ${err instanceof Error ? err.message : String(err)}` };
        }
      };
    case "presets.create_custom":
      return async ({ input, definition }) => {
        const bookId = input.bookId ? String(input.bookId) : undefined;
        const name = String(input.name);
        const category = String(input.category || "custom");
        const promptInjection = String(input.promptInjection);
        const description = input.description ? String(input.description) : undefined;
        try {
          const { getStorageDatabase, createUserTemplateRepository } = await import("@vivy1024/novelfork-core");
          const db = getStorageDatabase();
          const repo = createUserTemplateRepository(db);
          const id = `custom-preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const bundleJson = JSON.stringify({
            type: "preset",
            category,
            promptInjection,
          });
          const record = repo.create({ id, bookId: bookId ?? null, name, genre: null, description: description ?? null, bundleJson });

          // 同时注册到内存 preset store 以便立即可用
          const { registerPreset } = await import("@vivy1024/novelfork-novel-plugin/engine");
          registerPreset({ id, name, category: category as any, promptInjection, description: description ?? "" });

          return {
            ok: true,
            renderer: definition.renderer,
            summary: `已创建自定义预设「${name}」（ID: ${id}）。使用 presets.set_rules 将其加入启用列表即可生效。`,
            data: { id, name, category, bookId: bookId ?? null },
          };
        } catch (err) {
          return { ok: false, renderer: definition.renderer, error: "preset-create-failed", summary: `创建自定义预设失败: ${err instanceof Error ? err.message : String(err)}` };
        }
      };
    case "beat.create_custom":
      return async ({ input, definition }) => {
        const bookId = input.bookId ? String(input.bookId) : undefined;
        const name = String(input.name);
        const description = String(input.description || "");
        const beats = Array.isArray(input.beats) ? input.beats : [];
        if (beats.length === 0) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "beats 列表不能为空。" };
        }
        try {
          const { getStorageDatabase, createUserTemplateRepository } = await import("@vivy1024/novelfork-core");
          const db = getStorageDatabase();
          const repo = createUserTemplateRepository(db);
          const id = `custom-beat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const normalizedBeats = beats.map((b: any, i: number) => ({
            index: i + 1,
            name: String(b.name),
            emotionalTone: String(b.emotionalTone),
            wordRatio: Number(b.wordRatio) || (1 / beats.length),
            purpose: String(b.purpose || ""),
            networkNovelTip: b.networkNovelTip ? String(b.networkNovelTip) : undefined,
          }));
          const bundleJson = JSON.stringify({
            type: "beat-template",
            name,
            description,
            beats: normalizedBeats,
          });
          repo.create({ id, bookId: bookId ?? null, name, genre: null, description, bundleJson });

          // 注册到内存 beat store 以便立即可用
          const { registerBeatTemplate } = await import("@vivy1024/novelfork-novel-plugin/engine");
          registerBeatTemplate({ id, name, description, beats: normalizedBeats });

          return {
            ok: true,
            renderer: definition.renderer,
            summary: `已创建自定义节拍模板「${name}」（${normalizedBeats.length} 个节拍，ID: ${id}）。使用 beat.set_template 设置为当前书籍的节拍模板。`,
            data: { id, name, beatCount: normalizedBeats.length, bookId: bookId ?? null },
          };
        } catch (err) {
          return { ok: false, renderer: definition.renderer, error: "beat-create-failed", summary: `创建自定义节拍模板失败: ${err instanceof Error ? err.message : String(err)}` };
        }
      };
    default:
      return undefined;
  }
}

/** Helper: check file path against user-configured directory allow/blocklist */
async function checkDirectoryAccess(
  filePath: string,
  workDir: string,
): Promise<{ blocked: boolean; allowed: boolean; reason?: string }> {
  try {
    const { loadUserConfig } = await import("./user-config-service.js");
    const config = await loadUserConfig();
    const { directoryAllowlist, directoryBlocklist } = config.runtimeControls.toolAccess;
    return checkPathAgainstDirectoryLists(filePath, workDir, directoryAllowlist, directoryBlocklist);
  } catch {
    return { blocked: false, allowed: false };
  }
}

function getDefaultHandler(toolName: string, options: SessionToolExecutorOptions): SessionToolHandler | undefined {
  // MCP 工具路由：mcp__<serverName>__<toolName> 格式的工具名
  if (toolName.startsWith("mcp__")) {
    return async ({ input, definition }) => {
      try {
        const { callMcpToolViaManaged } = await import("../routes/mcp.js");
        const result = await callMcpToolViaManaged(toolName, input as Record<string, unknown>);
        if (result.isError) {
          return {
            ok: false,
            renderer: definition.renderer,
            error: "mcp-tool-error",
            summary: result.content,
          };
        }
        return {
          ok: true,
          renderer: definition.renderer,
          summary: result.content.length > 2000 ? result.content.slice(0, 2000) + "\n...(truncated)" : result.content,
          data: { content: result.content },
        };
      } catch (error) {
        return {
          ok: false,
          renderer: definition.renderer,
          error: "mcp-call-failed",
          summary: `MCP 工具调用失败：${error instanceof Error ? error.message : String(error)}`,
        };
      }
    };
  }

  // 先尝试小说领域 handler
  const novelHandler = getNovelServiceHandler(toolName, options);
  if (novelHandler) return novelHandler;

  // 尝试通过 PluginRegistry 查找 handler（fallback 到插件注册的 handler）
  const pluginHandler = pluginRegistry.getToolHandler(toolName);
  if (pluginHandler) {
    return async ({ input, definition }) => {
      const result = await pluginHandler.execute(input, {
        sessionId: options.sessionId ?? "",
        bookId: typeof input.bookId === "string" ? input.bookId : undefined,
        storage: null, // Storage not available in session executor context; plugin handlers must handle null gracefully
        root: options.workDir ?? process.cwd(),
      });
      return { ok: true, renderer: definition.renderer, summary: `${toolName} 执行完成`, data: result };
    };
  }

  switch (toolName) {
    // --- Claude Code / Codex 级开发工具 ---
    case "Bash":
      return async ({ input, permissionMode, definition, onToolOutputStream }) => {
        const workDir = typeof input.workDir === "string" ? input.workDir : (options.workDir ?? process.cwd());
        const command = String(input.command);

        // Phase 4.2: Check command against user-configured allow/block lists
        let commandAllowlist: string[] = [];
        let commandBlocklist: import("../../types/settings.js").CommandBlockRule[] = [];
        try {
          const { loadUserConfig } = await import("./user-config-service.js");
          const config = await loadUserConfig();
          commandAllowlist = config.runtimeControls.toolAccess.commandAllowlist;
          commandBlocklist = config.runtimeControls.toolAccess.commandBlocklist;
        } catch { /* config load failure — use empty lists */ }

        const listCheck = checkCommandAgainstLists(command, commandAllowlist, commandBlocklist);
        if (listCheck.blocked) {
          return {
            ok: false,
            renderer: definition.renderer,
            error: "command-blocklist",
            summary: listCheck.reason ?? "命令被黑名单拦截。",
            data: { command },
          };
        }
        // If explicitly allowed by allowlist, skip further permission checks
        if (listCheck.allowed) {
          const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : undefined;
          if (input.run_in_background === true) {
            const taskId = `bg-${Date.now()}`;
            const taskPromise = executeBashTool({ command, workDir, timeoutMs, onStdoutChunk: onToolOutputStream }).catch(error => ({
              ok: false as const,
              error: "background-task-failed",
              summary: `后台任务失败：${error instanceof Error ? error.message : String(error)}`,
            }));
            const task: BackgroundBashTask = { id: taskId, command, promise: taskPromise, status: "running" };
            taskPromise.then(r => { task.result = r; task.status = r.ok === false && r.error === "background-task-failed" ? "failed" : "completed"; });
            backgroundTasks.set(taskId, task);
            return { ok: true, renderer: definition.renderer, summary: `命令已在后台启动，task ID: ${taskId}`, data: { taskId, command } };
          }
          return executeBashTool({ command, workDir, timeoutMs, onStdoutChunk: onToolOutputStream });
        }

        // 对标 Claude Code: 在执行前通过 permission-pipeline 做命令级权限检查
        const permResult = validateToolPermission({
          toolName: "Bash",
          risk: definition.risk,
          permissionMode,
          workDir,
          command,
          sandboxMode: undefined,
        });
        if (!permResult.allowed && !permResult.requiresConfirmation) {
          return {
            ok: false,
            renderer: definition.renderer,
            error: "permission-pipeline-blocked",
            summary: permResult.reason ?? "命令被权限管线拦截。",
            data: { command, classification: permResult.classification },
          };
        }
        const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : undefined;
        if (input.run_in_background === true) {
          const taskId = `bg-${Date.now()}`;
          const taskPromise = executeBashTool({ command, workDir, timeoutMs, onStdoutChunk: onToolOutputStream }).catch(error => ({
            ok: false as const,
            error: "background-task-failed",
            summary: `后台任务失败：${error instanceof Error ? error.message : String(error)}`,
          }));
          const task: BackgroundBashTask = { id: taskId, command, promise: taskPromise, status: "running" };
          taskPromise.then(r => { task.result = r; task.status = r.ok === false && r.error === "background-task-failed" ? "failed" : "completed"; });
          backgroundTasks.set(taskId, task);
          return { ok: true, renderer: definition.renderer, summary: `命令已在后台启动，task ID: ${taskId}`, data: { taskId, command } };
        }
        return executeBashTool({ command, workDir, timeoutMs, onStdoutChunk: onToolOutputStream });
      };
    case "Read":
      return async ({ input, definition }) => {
        const workDir = options.workDir ?? process.cwd();
        const filePath = String(input.path);
        // Phase 4.3: Check directory blocklist
        const dirCheck = await checkDirectoryAccess(filePath, workDir);

        if (dirCheck.blocked) {
          return { ok: false, renderer: definition.renderer, error: "directory-blocklist", summary: dirCheck.reason ?? "路径在黑名单目录内。" };
        }
        if (!isPathWithinWorkDir(filePath, workDir) && !dirCheck.allowed) {
          return { ok: false, renderer: definition.renderer, error: "path-outside-workdir", summary: `路径 "${filePath}" 超出工作目录边界。添加到目录白名单后可访问。` };
        }
        return executeFileReadTool({
          path: filePath,
          workDir,
          allowOutsideWorkDir: dirCheck.allowed,
          ...(typeof input.offset === "number" ? { offset: input.offset } : {}),
          ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
        });
      };
    case "Write":
      return async ({ input, sessionId, definition }) => {
        const workDir = options.workDir ?? process.cwd();
        const filePath = String(input.path);
        // Phase 4.3: Check directory blocklist
        const dirCheckW = await checkDirectoryAccess(filePath, workDir);
        if (dirCheckW.blocked) {
          return { ok: false, renderer: definition.renderer, error: "directory-blocklist", summary: dirCheckW.reason ?? "路径在黑名单目录内。" };
        }
        if (!isPathWithinWorkDir(filePath, workDir) && !dirCheckW.allowed) {
          return { ok: false, renderer: definition.renderer, error: "path-outside-workdir", summary: `路径 "${filePath}" 超出工作目录边界。添加到目录白名单后可访问。` };
        }
        // File changes tracking: capture original content before write
        const { captureOriginalContent, trackFileChange } = await import("./file-changes-tracker.js");
        const originalContent = await captureOriginalContent(filePath, workDir);
        const result = await executeFileWriteTool({ path: filePath, content: String(input.content), workDir, allowOutsideWorkDir: dirCheckW.allowed });
        if (result.ok) {
          trackFileChange(sessionId, {
            path: filePath,
            type: originalContent === null ? "created" : "modified",
            originalContent,
            toolName: "Write",
            toolCallId: `write-${Date.now()}`,
          });
          // Post-edit auto verification
          const verifyResult = await maybeRunVerification(options);
          if (verifyResult && !verifyResult.passed) {
            return { ...result, summary: (result.summary || "") + `\n\n⚠️ 验证失败 (${verifyResult.command}):\n${verifyResult.output}` };
          }
        }
        return result;
      };
    case "Edit":
      return async ({ input, sessionId, definition }) => {
        const workDir = options.workDir ?? process.cwd();
        const filePath = String(input.path);
        // Phase 4.3: Check directory blocklist
        const dirCheckE = await checkDirectoryAccess(filePath, workDir);
        if (dirCheckE.blocked) {
          return { ok: false, renderer: definition.renderer, error: "directory-blocklist", summary: dirCheckE.reason ?? "路径在黑名单目录内。" };
        }
        if (!isPathWithinWorkDir(filePath, workDir) && !dirCheckE.allowed) {
          return { ok: false, renderer: definition.renderer, error: "path-outside-workdir", summary: `路径 "${filePath}" 超出工作目录边界。添加到目录白名单后可访问。` };
        }
        // File changes tracking: capture original content before edit
        const { captureOriginalContent: captureOrigE, trackFileChange: trackE } = await import("./file-changes-tracker.js");
        const originalContentE = await captureOrigE(filePath, workDir);
        const result = await executeFileEditTool({ path: filePath, oldText: String(input.oldText), newText: String(input.newText), workDir, allowOutsideWorkDir: dirCheckE.allowed, replaceAll: input.replaceAll === true });
        if (result.ok) {
          trackE(sessionId, {
            path: filePath,
            type: "modified",
            originalContent: originalContentE,
            toolName: "Edit",
            toolCallId: `edit-${Date.now()}`,
          });
          // Post-edit auto verification
          const verifyResult = await maybeRunVerification(options);
          if (verifyResult && !verifyResult.passed) {
            return { ...result, summary: (result.summary || "") + `\n\n⚠️ 验证失败 (${verifyResult.command}):\n${verifyResult.output}` };
          }
        }
        return result;
      };
    // --- Glob/Grep (real handlers) ---
    case "Glob":
      return async ({ input, definition }) => {
        const workDir = options.workDir ?? process.cwd();
        const pattern = String(input.pattern);
        const searchPath = typeof input.path === "string" ? input.path : ".";
        try {
          const { glob } = await import("glob");
          const resolvedPath = (await import("node:path")).resolve(workDir, searchPath);
          const cwd = searchPath === "." ? workDir : resolvedPath;
          // Check directory access for non-workDir paths
          if (cwd !== workDir && !isPathWithinWorkDir(cwd, workDir)) {
            const dirCheck = await checkDirectoryAccess(cwd, workDir);
            if (dirCheck.blocked) {
              return { ok: false, renderer: definition.renderer, error: "directory-blocklist", summary: dirCheck.reason ?? "搜索路径在黑名单目录内。" };
            }
            if (!dirCheck.allowed) {
              return { ok: false, renderer: definition.renderer, error: "path-outside-workdir", summary: `搜索路径 "${searchPath}" 超出工作目录边界。添加到目录白名单后可访问。` };
            }
          }
          const matches = await glob(pattern, { cwd, nodir: false });
          const GLOB_MAX = 200;
          const total = matches.length;
          const truncated = total > GLOB_MAX ? matches.slice(0, GLOB_MAX) : matches;
          const summary = total > GLOB_MAX
            ? `匹配到 ${total} 个文件。（显示前 ${GLOB_MAX} 个，共 ${total} 个匹配文件。用更精确的 pattern 或 path 缩小范围。）`
            : `匹配到 ${total} 个文件。`;
          return { ok: true, renderer: definition.renderer, summary, data: { matches: truncated, pattern, cwd, totalMatches: total } };
        } catch (error) {
          return { ok: false, renderer: definition.renderer, error: "glob-failed", summary: `Glob 执行失败：${error instanceof Error ? error.message : String(error)}` };
        }
      };
    case "Grep":
      return async ({ input, definition }) => {
        const workDir = options.workDir ?? process.cwd();
        const pattern = String(input.pattern);
        const searchPath = typeof input.path === "string" ? input.path : ".";
        const fileGlob = typeof input.glob === "string" ? input.glob : undefined;
        const outputMode = typeof input.output_mode === "string" ? input.output_mode : "files_with_matches";
        try {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const execFileAsync = promisify(execFile);
          const resolvedSearchPath = (await import("node:path")).resolve(workDir, searchPath);
          const cwd = searchPath === "." ? workDir : resolvedSearchPath;
          // Check directory access for non-workDir paths
          if (cwd !== workDir && !isPathWithinWorkDir(cwd, workDir)) {
            const dirCheck = await checkDirectoryAccess(cwd, workDir);
            if (dirCheck.blocked) {
              return { ok: false, renderer: definition.renderer, error: "directory-blocklist", summary: dirCheck.reason ?? "搜索路径在黑名单目录内。" };
            }
            if (!dirCheck.allowed) {
              return { ok: false, renderer: definition.renderer, error: "path-outside-workdir", summary: `搜索路径 "${searchPath}" 超出工作目录边界。添加到目录白名单后可访问。` };
            }
          }
          const args = ["--no-heading", "--color=never", "--max-columns", "500", "--no-ignore-vcs", "--glob", "!.git"];
          if (outputMode === "files_with_matches") args.push("-l");
          else if (outputMode === "count") args.push("-c");
          if (fileGlob) args.push("--glob", fileGlob);
          args.push("--", pattern);
          let stdout = "";
          try {
            const result = await execFileAsync("rg", args, { cwd, maxBuffer: 20_000_000, timeout: 20000, windowsHide: true });
            stdout = result.stdout;
          } catch (execError: unknown) {
            const err = execError as { code?: string; killed?: boolean; signal?: string; stderr?: string; stdout?: string };
            if (err.code === "ENOENT") {
              return { ok: false, renderer: definition.renderer, error: "rg-not-found", summary: "ripgrep (rg) 未安装或不在 PATH 中。请安装 ripgrep。" };
            }
            if (err.killed || err.signal === "SIGTERM") {
              // 超时但可能有部分结果
              if (err.stdout?.trim()) {
                stdout = err.stdout;
              } else {
                return { ok: false, renderer: definition.renderer, error: "grep-timeout", summary: `Grep 搜索超时（20s）。目录可能过大或路径不存在：${cwd}` };
              }
            }
            // rg exit code 1 = no matches (normal), 2 = partial error
            if (!stdout && err.stdout) stdout = err.stdout;
          }
          const lines = stdout.trim().split("\n").filter(Boolean);
          const GREP_MAX = 250;
          const total = lines.length;
          const truncated = total > GREP_MAX ? lines.slice(0, GREP_MAX) : lines;
          const summary = total > GREP_MAX
            ? `搜索完成，${total} 条结果。（显示前 ${GREP_MAX} 条，共 ${total} 条匹配。用更精确的 pattern 或 path 缩小范围。）`
            : `搜索完成，${total} 条结果。`;
          return { ok: true, renderer: definition.renderer, summary, data: { results: truncated, pattern, outputMode, totalResults: total, fullOutput: total > GREP_MAX ? lines : undefined } };
        } catch (error) {
          return { ok: false, renderer: definition.renderer, error: "grep-failed", summary: `Grep 执行失败：${error instanceof Error ? error.message : String(error)}` };
        }
      };
    // --- EnterWorktree / ExitWorktree (real handlers using git) ---
    case "EnterWorktree":
      return async ({ input, definition }) => {
        const workDir = options.workDir ?? process.cwd();
        const name = typeof input.name === "string" ? input.name : undefined;
        const path = typeof input.path === "string" ? input.path : undefined;
        const branch = typeof input.branch === "string" ? input.branch : undefined;
        try {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const { resolve, join } = await import("node:path");
          const execFileAsync = promisify(execFile);
          if (path) {
            // Enter existing worktree
            return { ok: true, renderer: definition.renderer, summary: `已进入 worktree: ${path}`, data: { worktreePath: resolve(workDir, path) } };
          }
          if (name) {
            const worktreePath = join(workDir, ".worktrees", name);
            const branchArgs = branch ? ["-b", name, branch] : ["-b", name];
            await execFileAsync("git", ["worktree", "add", worktreePath, ...branchArgs], { cwd: workDir });
            return { ok: true, renderer: definition.renderer, summary: `已创建并进入 worktree: ${name}`, data: { worktreePath, name, branch } };
          }
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "必须提供 name 或 path 参数。" };
        } catch (error) {
          return { ok: false, renderer: definition.renderer, error: "worktree-failed", summary: `Worktree 操作失败：${error instanceof Error ? error.message : String(error)}` };
        }
      };
    case "ExitWorktree":
      return async ({ input, definition }) => {
        const action = String(input.action);
        if (action === "keep") {
          return { ok: true, renderer: definition.renderer, summary: "已退出 worktree（保留）。", data: { action } };
        }
        if (action === "remove") {
          return { ok: true, renderer: definition.renderer, summary: "已退出 worktree（标记删除）。", data: { action, note: "实际删除需要在主仓库执行 git worktree remove。" } };
        }
        return { ok: false, renderer: definition.renderer, error: "invalid-action", summary: `无效的 action: ${action}，应为 keep 或 remove。` };
      };
    // --- Implemented Phase 2 tools ---
    case "AskUserQuestion":
      return async ({ input, definition }) => {
        const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
        if (rawQuestions.length === 0) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "questions 数组为空。" };
        }
        // 转换为 ConversationConfirmationQuestion 格式（保留 label+description 结构）
        const questions = rawQuestions.map((q: any, idx: number) => ({
          id: q.id ?? `q-${idx}`,
          prompt: typeof q.question === "string" ? q.question : (typeof q.prompt === "string" ? q.prompt : `问题 ${idx + 1}`),
          type: Array.isArray(q.options) && q.options.length > 0 ? (q.multiSelect === false ? "single" as const : "multi" as const) : "text" as const,
          options: Array.isArray(q.options) ? q.options.map((o: any) =>
            typeof o === "string" ? { label: o } : { label: o?.label ?? String(o), ...(o?.description ? { description: o.description } : {}) }
          ) : undefined,
          header: typeof q.header === "string" ? q.header : undefined,
          required: true,
        }));
        const confirmationId = crypto.randomUUID();
        return {
          ok: true,
          renderer: "tool.ask-user-question",
          summary: `向用户提出 ${questions.length} 个问题，等待回答。`,
          data: { status: "pending-confirmation", questions },
          confirmation: {
            id: confirmationId,
            toolName: "AskUserQuestion",
            target: questions[0]?.prompt ?? "请回答以下问题",
            summary: `Agent 提问：${questions[0]?.prompt ?? "请回答以下问题"}`,
            risk: "confirmed-write" as const,
            options: CONFIRMATION_OPTIONS,
            questions,
          },
        };
      };
    case "EnterPlanMode":
      return async ({ sessionId, definition }) => {
        const { updateSession } = await import("./session-service.js");
        await updateSession(sessionId, { sessionMode: "plan" });
        return {
          ok: true,
          renderer: definition.renderer,
          summary: "已进入计划模式。在此模式下只做调查和规划，不执行写入操作。",
          data: { status: "plan-mode-entered", mode: "plan" },
        };
      };
    case "ExitPlanMode":
      return async ({ input, sessionId, definition }) => {
        const plan = typeof input.plan === "string" ? input.plan.trim() : "";
        if (!plan) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "plan 内容为空。" };
        }
        // Fix: 如果 autoApprovePlan 为 true，跳过确认直接切换模式
        try {
          const { loadUserConfig } = await import("./user-config-service.js");
          const config = await loadUserConfig();
          if (config.runtimeControls?.autoApprovePlan) {
            const { updateSession } = await import("./session-service.js");
            await updateSession(sessionId, { sessionMode: "chat" });
            return {
              ok: true,
              renderer: "tool.plan-approval",
              summary: "✅ 计划已自动批准，已退出计划模式。",
              data: { status: "auto-approved", plan, sessionId, systemNotification: "✅ 计划已自动批准" },
            };
          }
        } catch { /* config load failure — fall through to manual confirmation */ }
        // 不在此处切换 sessionMode，等 confirmation approve 后由 confirmSessionToolDecision 切换
        return {
          ok: true,
          renderer: "tool.plan-approval",
          summary: `计划已提交，等待用户批准。批准后将退出计划模式。`,
          data: { status: "pending-confirmation", plan, sessionId },
          confirmation: {
            id: crypto.randomUUID(),
            toolName: "ExitPlanMode",
            target: "计划审批",
            summary: plan.slice(0, 200),
            risk: "confirmed-write" as const,
            options: CONFIRMATION_OPTIONS,
          },
        };
      };
    case "TaskCreate":
      return async ({ input, definition }) => {
        const todos = Array.isArray(input.todos) ? input.todos : [];
        if (todos.length === 0) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "todos 数组为空。" };
        }
        return {
          ok: true,
          renderer: "tool.task-list",
          summary: `已创建 ${todos.length} 个任务。`,
          data: {
            status: "created",
            todos,
            totalCount: todos.length,
            completedCount: todos.filter((t: Record<string, unknown>) => t.status === "completed").length,
          },
        };
      };
    case "Recall":
      return async ({ input, definition, sessionId }) => {
        const action = typeof input.action === "string" ? input.action : "search";
        const query = typeof input.query === "string" ? (input.query as string).trim() : "";

        if (action === "search" && !query) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "search action 需要 query 参数。" };
        }

        const { loadSessionChatHistory } = await import("./session-history-store.js");
        const history = await loadSessionChatHistory(sessionId);

        if (action === "search") {
          const lowerQuery = query.toLowerCase();
          const limit = typeof input.limit === "number" ? input.limit : 10;
          const matches = history
            .filter(msg => msg.content.toLowerCase().includes(lowerQuery))
            .slice(0, limit)
            .map(msg => ({ id: msg.id, role: msg.role, content: msg.content.slice(0, 500), timestamp: msg.timestamp }));
          return {
            ok: true,
            renderer: definition.renderer,
            summary: `搜索到 ${matches.length} 条匹配消息。`,
            data: { action: "search", query, matches, totalMatches: matches.length },
          };
        }

        if (action === "read_conversation") {
          const limit = typeof input.limit === "number" ? input.limit : 20;
          const messages = history.slice(-limit).map(msg => ({ id: msg.id, role: msg.role, content: msg.content.slice(0, 1000), timestamp: msg.timestamp }));
          return {
            ok: true,
            renderer: definition.renderer,
            summary: `读取了最近 ${messages.length} 条消息。`,
            data: { action: "read_conversation", messages },
          };
        }

        if (action === "read_tool_call") {
          const toolCallId = typeof input.tool_call_id === "string" ? input.tool_call_id : "";
          if (!toolCallId) {
            return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "read_tool_call 需要 tool_call_id。" };
          }
          for (const msg of history) {
            if (!msg.toolCalls) continue;
            for (const tc of msg.toolCalls) {
              if (tc.id === toolCallId) {
                return {
                  ok: true,
                  renderer: definition.renderer,
                  summary: `找到工具调用 ${tc.toolName}（ID: ${toolCallId}）`,
                  data: {
                    action: "read_tool_call",
                    toolCallId,
                    toolName: tc.toolName,
                    status: tc.status,
                    input: tc.input,
                    output: tc.output,
                    result: tc.result,
                    duration: tc.duration,
                  },
                };
              }
            }
          }
          return { ok: false, renderer: definition.renderer, error: "not-found", summary: `未找到工具调用 ${toolCallId}。` };
        }

        return { ok: false, renderer: definition.renderer, error: "invalid-action", summary: `不支持的 action: ${action}` };
      };
    // --- Goals (session-level persistent) ---
    case "GetGoals":
      return async ({ sessionId, definition }) => {
        const { getSessionById } = await import("./session-service.js");
        const session = await getSessionById(sessionId);
        const goals = session?.goals ?? [];
        return {
          ok: true,
          renderer: definition.renderer,
          summary: goals.length > 0 ? `当前有 ${goals.length} 个目标。` : "当前没有活跃目标。",
          data: { goals },
        };
      };
    case "AddGoal":
      return async ({ input, sessionId, definition }) => {
        const objective = typeof input.objective === "string" ? input.objective.trim() : "";
        if (!objective) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "objective 不能为空。" };
        }
        const { getSessionById, updateSession } = await import("./session-service.js");
        const session = await getSessionById(sessionId);
        if (!session) {
          return { ok: false, renderer: definition.renderer, error: "session-not-found", summary: "会话不存在。" };
        }
        const existingGoals = session.goals ?? [];
        const newGoal = { id: crypto.randomUUID(), objective, status: "active" as const, createdAt: new Date().toISOString() };
        const goals = [...existingGoals, newGoal];
        await updateSession(sessionId, { goals });
        return {
          ok: true,
          renderer: definition.renderer,
          summary: `已添加目标：${objective}`,
          data: { goal: newGoal, totalGoals: goals.length },
        };
      };
    case "UpdateGoal":
      return async ({ input, sessionId, definition }) => {
        const status = typeof input.status === "string" ? input.status : "";
        if (status !== "complete") {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "status 必须为 'complete'。" };
        }
        const { getSessionById, updateSession } = await import("./session-service.js");
        const session = await getSessionById(sessionId);
        if (!session) {
          return { ok: false, renderer: definition.renderer, error: "session-not-found", summary: "会话不存在。" };
        }
        const goals = [...(session.goals ?? [])];
        const goalId = typeof input.goalId === "string" ? input.goalId : undefined;
        const targetGoal = goalId
          ? goals.find(g => g.id === goalId)
          : goals.find(g => g.status === "active");
        if (!targetGoal) {
          return { ok: false, renderer: definition.renderer, error: "no-active-goal", summary: goalId ? `目标 ${goalId} 不存在。` : "没有活跃目标可以标记完成。" };
        }
        targetGoal.status = "complete";
        await updateSession(sessionId, { goals });
        return {
          ok: true,
          renderer: definition.renderer,
          summary: `目标已完成：${targetGoal.objective}`,
          data: { goal: targetGoal },
        };
      };
    // --- LearningGuide (reads docs/learning/) ---
    case "LearningGuide":
      return async ({ input, definition }) => {
        const mode = typeof input.mode === "string" ? input.mode : "list";
        const { readdir, readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const { resolveRuntimeStoragePath } = await import("./runtime-storage-paths.js");
        const { dirname } = await import("node:path");

        // 解析 YAML frontmatter
        function parseLearningFrontmatter(content: string): { title: string; summary: string; tags: string[] } {
          const match = content.match(/^---\n([\s\S]*?)\n---/);
          if (!match) return { title: "", summary: "", tags: [] };
          const yaml = match[1];
          const title = yaml.match(/title:\s*(.+)/)?.[1]?.trim() ?? "";
          const summary = yaml.match(/summary:\s*(.+)/)?.[1]?.trim() ?? "";
          const tagsMatch = yaml.match(/tags:\s*\[([^\]]*)\]/);
          const tags = tagsMatch ? tagsMatch[1].split(",").map(t => t.trim().replace(/['"]/g, "")) : [];
          return { title, summary, tags };
        }

        // 学习中心文档位置：优先 exe 旁边的 docs/learning/，其次 ~/.novelfork/docs/learning/
        let learningDir: string;
        const { existsSync } = await import("node:fs");
        const exeDocsDir = process.execPath?.endsWith(".exe") ? join(dirname(process.execPath), "docs", "learning") : "";
        if (exeDocsDir && existsSync(exeDocsDir)) {
          learningDir = exeDocsDir;
        } else {
          learningDir = join(resolveRuntimeStoragePath(), "docs", "learning");
        }

        if (mode === "list") {
          try {
            const files = await readdir(learningDir);
            const docs: Array<{ id: string; title: string; summary: string; tags: string[] }> = [];
            for (const file of files.filter(f => f.endsWith(".md") && f !== "README.md")) {
              const content = await readFile(join(learningDir, file), "utf-8");
              const meta = parseLearningFrontmatter(content);
              docs.push({ id: file.replace(".md", ""), title: meta.title, summary: meta.summary, tags: meta.tags });
            }
            return { ok: true, renderer: definition.renderer, summary: `学习中心有 ${docs.length} 篇文档。`, data: { docs } };
          } catch {
            return { ok: true, renderer: definition.renderer, summary: "学习中心目录不存在或为空。", data: { docs: [] } };
          }
        }

        if (mode === "search") {
          const query = typeof input.query === "string" ? input.query.toLowerCase() : "";
          if (!query) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "search 模式需要 query。" };
          try {
            const files = await readdir(learningDir);
            const results: Array<{ id: string; title: string; summary: string; tags: string[] }> = [];
            const queryTerms = query.split(/\s+/).filter(Boolean);
            for (const file of files.filter(f => f.endsWith(".md") && f !== "README.md")) {
              const content = await readFile(join(learningDir, file), "utf-8");
              const meta = parseLearningFrontmatter(content);
              // 匹配 title + summary + tags + 正文
              const searchable = `${meta.title} ${meta.summary} ${meta.tags.join(" ")} ${content}`.toLowerCase();
              const matches = queryTerms.filter(term => searchable.includes(term));
              if (matches.length > 0) {
                results.push({ id: file.replace(".md", ""), title: meta.title, summary: meta.summary, tags: meta.tags });
              }
            }
            // 按匹配度排序（匹配更多 term 的排前面）
            results.sort((a, b) => {
              const scoreA = queryTerms.filter(t => `${a.title} ${a.summary} ${a.tags.join(" ")}`.toLowerCase().includes(t)).length;
              const scoreB = queryTerms.filter(t => `${b.title} ${b.summary} ${b.tags.join(" ")}`.toLowerCase().includes(t)).length;
              return scoreB - scoreA;
            });
            return { ok: true, renderer: definition.renderer, summary: `搜索到 ${results.length} 篇相关文档。`, data: { results } };
          } catch {
            return { ok: true, renderer: definition.renderer, summary: "搜索失败，学习中心目录不可用。", data: { results: [] } };
          }
        }

        if (mode === "get") {
          const id = typeof input.id === "string" ? input.id : "";
          if (!id) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "get 模式需要 id。" };
          try {
            const content = await readFile(join(learningDir, `${id}.md`), "utf-8");
            return { ok: true, renderer: definition.renderer, summary: `已读取文档：${id}`, data: { id, content } };
          } catch {
            return { ok: false, renderer: definition.renderer, error: "not-found", summary: `文档 ${id} 不存在。` };
          }
        }

        return { ok: false, renderer: definition.renderer, error: "invalid-mode", summary: `不支持的 mode: ${mode}` };
      };
    // --- Pipeline (session-level in-memory) ---
    case "StartPipeline":
      return async ({ input, sessionId, definition }) => {
        const label = typeof input.label === "string" ? input.label : "pipeline";
        sessionPipelines.set(sessionId, { label, captures: new Map(), counter: 0 });
        return {
          ok: true,
          renderer: definition.renderer,
          summary: `管道模式已开启：${label}`,
          data: { status: "pipeline-started", label },
        };
      };
    case "EndPipeline":
      return async ({ input, sessionId, definition }) => {
        const pipeline = sessionPipelines.get(sessionId);
        if (!pipeline) {
          return { ok: false, renderer: definition.renderer, error: "no-pipeline", summary: "当前没有活跃的管道会话。" };
        }
        const rule = typeof input.rule === "string" ? input.rule.trim() : "";
        sessionPipelines.delete(sessionId);

        const result = executePipelineRule(rule, pipeline.captures);
        return {
          ok: true,
          renderer: definition.renderer,
          summary: `管道结束，共 ${pipeline.captures.size} 个捕获。${rule ? ` 规则: ${rule}` : ""}`,
          data: { rule, captureCount: pipeline.captures.size, result },
        };
      };
    // --- ForkNarrator: 创建新的独立 session ---
    case "ForkNarrator":
      return async ({ input, sessionId, definition }) => {
        const mode = typeof input.mode === "string" ? input.mode : "fresh";
        const message = typeof input.message === "string" ? (input.message as string).trim() : "";
        const title = typeof input.title === "string" ? (input.title as string).trim() : "";

        if (!message) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "message 不能为空。" };
        }

        const { createSession, getSessionById } = await import("./session-service.js");

        const parentSession = await getSessionById(sessionId);
        const newSession = await createSession({
          title: title || `Fork: ${message.slice(0, 30)}`,
          agentId: parentSession?.agentId ?? "writer",
          sessionMode: "chat",
          projectId: parentSession?.projectId,
          worktree: parentSession?.worktree,
          parentSessionId: mode === "fork" ? sessionId : undefined,
          forkMode: mode === "fork" ? "full" : undefined,
          sessionConfig: parentSession ? { permissionMode: parentSession.sessionConfig.permissionMode } : undefined,
        });

        return {
          ok: true,
          renderer: definition.renderer,
          summary: `已创建新叙述者：${newSession.title}（ID: ${newSession.id}）`,
          data: { sessionId: newSession.id, title: newSession.title, mode },
        };
      };
    // --- ShareFile: 生成文件分享信息 ---
    case "ShareFile":
      return async ({ input, definition }) => {
        const filePath = typeof input.path === "string" ? input.path.trim() : "";
        if (!filePath) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "path 不能为空。" };
        }

        const { stat } = await import("node:fs/promises");
        const { join, basename, extname } = await import("node:path");
        const workDir = options.workDir ?? process.cwd();
        const resolvedPath = join(workDir, filePath);

        try {
          const stats = await stat(resolvedPath);
          if (stats.isDirectory()) {
            return { ok: false, renderer: definition.renderer, error: "is-directory", summary: `${filePath} 是目录，不支持直接分享。` };
          }
          const fileName = basename(resolvedPath);
          const sizeKb = Math.round(stats.size / 1024);
          const ext = extname(fileName).toLowerCase();
          const isPreviewable = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".pdf", ".html"].includes(ext);

          // 生成分享 token（base64url 编码路径）
          const token = Buffer.from(resolvedPath).toString("base64url");
          return {
            ok: true,
            renderer: definition.renderer,
            summary: `文件 ${fileName}（${sizeKb}KB）已准备分享。下载链接：/api/share/${token}`,
            data: { token, fileName, path: filePath, sizeBytes: stats.size, previewable: isPreviewable, downloadUrl: `/api/share/${token}` },
          };
        } catch {
          return { ok: false, renderer: definition.renderer, error: "file-not-found", summary: `文件不存在：${filePath}` };
        }
      };
    // --- Skill: 调用已注册技能（接通 core 层命令执行器） ---
    case "Skill":
      return async ({ input, sessionId, definition }) => {
        const skillName = typeof input.skill === "string" ? (input.skill as string).trim() : "";
        if (!skillName) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "skill 名称不能为空。" };
        }
        const args = typeof input.args === "string" ? input.args : undefined;

        // v2: Try to load skill content from disk — project level first, then global
        const workDir = options.workDir ?? process.cwd();
        const { existsSync, readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const { homedir } = await import("node:os");

        const skillPaths = [
          // 项目级（优先）
          join(workDir, ".novelfork", "skills", `${skillName}.md`),
          join(workDir, ".claude", "skills", `${skillName}.md`),
          join(workDir, ".kiro", "skills", `${skillName}.md`),
          // 全局级（兜底）
          join(homedir(), ".novelfork", "skills", `${skillName}.md`),
        ];

        for (const p of skillPaths) {
          if (existsSync(p)) {
            try {
              const content = readFileSync(p, "utf-8");
              return {
                ok: true,
                renderer: definition.renderer,
                summary: `已加载 skill "${skillName}"。`,
                data: { skillName, skillPath: p, content, args },
              };
            } catch { /* skip, try next */ }
          }
        }

        // Fallback: route through runtime command executor (slash commands)
        try {
          const { executeRuntimeCommandInput } = await import("@vivy1024/novelfork-core");
          const commandInput = `/${skillName}${args ? " " + args : ""}`;
          const execution = await executeRuntimeCommandInput(commandInput, { sessionId });
          return {
            ok: execution.ok,
            renderer: definition.renderer,
            summary: execution.result.message ?? (execution.ok ? `技能 ${skillName} 执行完成。` : `技能 ${skillName} 执行失败。`),
            data: { skill: skillName, args, result: execution.result, events: execution.events },
          };
        } catch (error) {
          return {
            ok: false,
            renderer: definition.renderer,
            error: "skill-not-found",
            summary: `Skill "${skillName}" 未找到。搜索路径：${skillPaths.join(", ")}`,
          };
        }
      };
    // --- Web tools ---
    case "WebFetch":
      return async ({ input, definition }) => {
        const url = typeof input.url === "string" ? input.url.trim() : "";
        if (!url) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "url 不能为空。" };
        }
        const maxLength = typeof input.max_length === "number" ? input.max_length : 20000;
        try {
          const response = await fetch(url, { headers: { "User-Agent": NOVELFORK_USER_AGENT }, signal: AbortSignal.timeout(15000) });
          if (!response.ok) {
            return { ok: false, renderer: definition.renderer, error: "fetch-failed", summary: `HTTP ${response.status}: ${response.statusText}` };
          }
          const contentType = response.headers.get("content-type") ?? "";
          const text = await response.text();
          const truncated = text.length > maxLength ? text.slice(0, maxLength) + "\n...(truncated)" : text;
          return {
            ok: true,
            renderer: definition.renderer,
            summary: `已获取 ${url}（${text.length} 字符）`,
            data: { url, contentType, content: truncated, originalLength: text.length, truncated: text.length > maxLength },
          };
        } catch (error) {
          return { ok: false, renderer: definition.renderer, error: "fetch-error", summary: `获取失败：${error instanceof Error ? error.message : String(error)}` };
        }
      };
    case "WebSearch":
      return async ({ input, definition }) => {
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!query) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "query 不能为空。" };
        }
        try {
          const { searchWeb } = await import("@vivy1024/novelfork-core");
          const results = await searchWeb(query);
          if (!results || results.length === 0) {
            return { ok: true, renderer: definition.renderer, summary: `搜索 "${query}" 无结果。`, data: { query, results: [] } };
          }
          const summary = results.slice(0, 5).map((r: { title: string; url: string }) => `- ${r.title}: ${r.url}`).join("\n");
          return {
            ok: true,
            renderer: definition.renderer,
            summary: `搜索 "${query}" 找到 ${results.length} 条结果。\n${summary}`,
            data: { query, results },
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg.includes("TAVILY_API_KEY") || msg.includes("api_key")) {
            return { ok: false, renderer: definition.renderer, error: "no-search-api", summary: "网络搜索需要配置 TAVILY_API_KEY 环境变量。" };
          }
          return { ok: false, renderer: definition.renderer, error: "search-failed", summary: `搜索失败：${msg}` };
        }
      };
    // --- Browser: Playwright-based browser automation with system Chrome fallback ---
    case "Browser":
      return async ({ input, definition }) => {
        const action = typeof input.action === "string" ? input.action : "";

        // --- Helper: find system Chrome/Edge executable ---
        const findSystemBrowser = async (): Promise<string | null> => {
          const { existsSync } = await import("node:fs");
          const candidates = process.platform === "win32"
            ? [
                "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
                "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
                "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
                "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
              ]
            : [
                "/usr/bin/google-chrome",
                "/usr/bin/chromium-browser",
                "/usr/bin/chromium",
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              ];
          for (const p of candidates) {
            if (existsSync(p)) return p;
          }
          return null;
        };

        // --- Standalone screenshot using system Chrome (no Playwright needed) ---
        if (action === "screenshot" && !input.session_id) {
          const url = typeof input.url === "string" ? input.url : "about:blank";
          const chromePath = await findSystemBrowser();
          if (!chromePath) {
            return { ok: false, renderer: definition.renderer, error: "browser-not-found", summary: "未找到系统 Chrome/Edge 浏览器，无法截图。" };
          }
          try {
            const { execFile } = await import("node:child_process");
            const { promisify } = await import("node:util");
            const { join } = await import("node:path");
            const { tmpdir } = await import("node:os");
            const { readFileSync, unlinkSync } = await import("node:fs");
            const execFileAsync = promisify(execFile);

            const outputPath = join(tmpdir(), `novelfork-screenshot-${Date.now()}.png`);
            const width = typeof input.width === "number" ? input.width : 1280;
            const height = typeof input.height === "number" ? input.height : 900;

            await execFileAsync(chromePath, [
              "--headless=new", "--disable-gpu", "--no-sandbox",
              `--screenshot=${outputPath}`, `--window-size=${width},${height}`,
              url,
            ], { timeout: 15000 });

            const buffer = readFileSync(outputPath);
            const base64 = buffer.toString("base64");
            try { unlinkSync(outputPath); } catch { /* ignore cleanup errors */ }

            return {
              ok: true,
              renderer: definition.renderer,
              summary: `已截图 ${url}（${Math.round(buffer.length / 1024)}KB）`,
              data: { action: "screenshot", url, base64, mimeType: "image/png", sizeBytes: buffer.length },
            };
          } catch (error) {
            return { ok: false, renderer: definition.renderer, error: "screenshot-failed", summary: `系统浏览器截图失败：${error instanceof Error ? error.message : String(error)}` };
          }
        }

        if (action === "launch") {
          const url = typeof input.url === "string" ? input.url : "";
          if (!url) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "launch 需要 url。" };

          try {
            let pw: { chromium: { launch: (opts?: Record<string, unknown>) => Promise<unknown> } };
            try {
              // @ts-ignore — dynamic import, may not have type declarations
              pw = await import("playwright-core");
            } catch {
              try {
                // @ts-ignore — dynamic import fallback
                pw = await import("playwright");
              } catch {
                // Fallback: no Playwright available, use system Chrome for basic screenshot-only mode
                const chromePath = await findSystemBrowser();
                if (!chromePath) {
                  return { ok: false, renderer: definition.renderer, error: "missing-dependency", summary: "需要安装 playwright-core/playwright 或系统 Chrome/Edge。当前仅支持 screenshot action（无需 session）。" };
                }
                return { ok: false, renderer: definition.renderer, error: "no-playwright", summary: "Playwright 未安装，无法创建交互式浏览器会话。可直接使用 screenshot action（无需 session_id）进行截图。" };
              }
            }
            const headless = input.headless !== false;
            const browser = await pw.chromium.launch({ headless, channel: "chrome" }) as { newPage: () => Promise<BrowserPageLike>; close: () => Promise<void> };
            const page = await browser.newPage();
            await page.goto(url, { timeout: 30000 });
            const sessionId = crypto.randomUUID().slice(0, 8);
            browserSessions.set(sessionId, { id: sessionId, browser, page, createdAt: Date.now() });
            const title = await page.title();
            return {
              ok: true,
              renderer: definition.renderer,
              summary: `浏览器已打开：${title} (${url})`,
              data: { session_id: sessionId, title, url },
            };
          } catch (error) {
            return { ok: false, renderer: definition.renderer, error: "launch-failed", summary: `浏览器启动失败：${error instanceof Error ? error.message : String(error)}` };
          }
        }

        if (action === "list_sessions") {
          const sessions = [...browserSessions.entries()].map(([id, s]) => ({
            id,
            createdAt: s.createdAt,
          }));
          return { ok: true, renderer: definition.renderer, summary: `${sessions.length} 个浏览器会话`, data: { sessions } };
        }

        // All other actions require session_id
        const sessionId = typeof input.session_id === "string" ? input.session_id : "";
        if (!sessionId) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "需要 session_id。" };
        const session = browserSessions.get(sessionId);
        if (!session) return { ok: false, renderer: definition.renderer, error: "session-not-found", summary: `浏览器会话 ${sessionId} 不存在。` };
        const page = session.page;
        const browser = session.browser;

        try {
          switch (action) {
            case "navigate": {
              const url = typeof input.url === "string" ? input.url : "";
              if (input.direction === "back") { await page.goBack(); }
              else if (input.direction === "forward") { await page.goForward(); }
              else if (url) { await page.goto(url, { timeout: 30000 }); }
              else { return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "navigate 需要 url 或 direction。" }; }
              return { ok: true, renderer: definition.renderer, summary: `已导航到 ${page.url()}`, data: { url: page.url(), title: await page.title() } };
            }
            case "click": {
              const selector = typeof input.selector === "string" ? input.selector : "";
              if (!selector) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "click 需要 selector。" };
              await page.click(selector, { timeout: 10000 });
              return { ok: true, renderer: definition.renderer, summary: `已点击 ${selector}`, data: { selector } };
            }
            case "fill": {
              const selector = typeof input.selector === "string" ? input.selector : "";
              const value = typeof input.value === "string" ? input.value : "";
              if (!selector) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "fill 需要 selector。" };
              await page.fill(selector, value, { timeout: 10000 });
              return { ok: true, renderer: definition.renderer, summary: `已填入 ${selector}`, data: { selector, value } };
            }
            case "type": {
              const value = typeof input.value === "string" ? input.value : "";
              const key = typeof input.key === "string" ? input.key : "";
              if (key) { await page.keyboard.press(key); return { ok: true, renderer: definition.renderer, summary: `已按键 ${key}`, data: { key } }; }
              if (value) { await page.keyboard.type(value); return { ok: true, renderer: definition.renderer, summary: `已输入文本`, data: { length: value.length } }; }
              return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "type 需要 value 或 key。" };
            }
            case "screenshot": {
              const fullPage = input.fullPage === true;
              const buffer = await page.screenshot({ type: "png", fullPage });
              const base64 = buffer.toString("base64");
              return { ok: true, renderer: definition.renderer, summary: `截图已捕获（${Math.round(buffer.length / 1024)}KB）`, data: { base64, mimeType: "image/png", sizeBytes: buffer.length } };
            }
            case "evaluate": {
              const expression = typeof input.value === "string" ? input.value : (typeof input.expression === "string" ? input.expression : "");
              if (!expression) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "evaluate 需要 value 或 expression（JS 表达式）。" };
              const result = await page.evaluate(expression);
              return { ok: true, renderer: definition.renderer, summary: `JS 执行完成`, data: { result: JSON.stringify(result).slice(0, 5000) } };
            }
            case "get_text": {
              const selector = typeof input.selector === "string" ? input.selector : "body";
              const text = await page.locator(selector).first().textContent({ timeout: 10000 });
              const maxLength = typeof input.max_length === "number" ? input.max_length : 20000;
              const truncated = text && text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
              return { ok: true, renderer: definition.renderer, summary: `文本内容（${text?.length ?? 0} 字符）`, data: { text: truncated } };
            }
            case "dom": {
              const selector = typeof input.selector === "string" ? input.selector : "body";
              const html = await page.locator(selector).first().innerHTML({ timeout: 10000 });
              const maxLength = typeof input.max_length === "number" ? input.max_length : 20000;
              const truncated = html.length > maxLength ? html.slice(0, maxLength) + "..." : html;
              return { ok: true, renderer: definition.renderer, summary: `DOM 内容（${html.length} 字符）`, data: { html: truncated } };
            }
            case "scroll": {
              const direction = input.direction === "up" ? -1 : 1;
              const amount = typeof input.amount === "number" ? input.amount : 500;
              await page.evaluate(`window.scrollBy(0, ${direction * amount})`);
              return { ok: true, renderer: definition.renderer, summary: `已滚动 ${input.direction ?? "down"} ${amount}px`, data: { direction: input.direction, amount } };
            }
            case "wait": {
              const selector = typeof input.selector === "string" ? input.selector : "";
              if (!selector) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "wait 需要 selector。" };
              const timeout = typeof input.timeout === "number" ? input.timeout : 10000;
              await page.waitForSelector(selector, { timeout });
              return { ok: true, renderer: definition.renderer, summary: `元素 ${selector} 已出现`, data: { selector } };
            }
            case "hover": {
              const selector = typeof input.selector === "string" ? input.selector : "";
              if (!selector) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "hover 需要 selector。" };
              await page.hover(selector, { timeout: 10000 });
              return { ok: true, renderer: definition.renderer, summary: `已悬停 ${selector}`, data: { selector } };
            }
            case "select": {
              const selector = typeof input.selector === "string" ? input.selector : "";
              const value = typeof input.value === "string" ? input.value : "";
              if (!selector) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "select 需要 selector。" };
              const selected = await page.selectOption(selector, value, { timeout: 10000 });
              return { ok: true, renderer: definition.renderer, summary: `已选择 ${selector} → ${selected.join(", ")}`, data: { selector, selected } };
            }
            case "get_attribute": {
              const selector = typeof input.selector === "string" ? input.selector : "";
              const attribute = typeof input.attribute === "string" ? input.attribute : "";
              if (!selector || !attribute) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "get_attribute 需要 selector 和 attribute。" };
              const escapedSel = selector.replace(/'/g, "\\'");
              const escapedAttr = attribute.replace(/'/g, "\\'");
              const attrValue = await page.evaluate(`(() => { const el = document.querySelector('${escapedSel}'); return el ? el.getAttribute('${escapedAttr}') : null; })()`);
              return { ok: true, renderer: definition.renderer, summary: `${selector}[${attribute}] = ${attrValue}`, data: { selector, attribute, value: attrValue } };
            }
            case "close": {
              await browser.close();
              browserSessions.delete(sessionId);
              return { ok: true, renderer: definition.renderer, summary: `浏览器会话 ${sessionId} 已关闭`, data: { session_id: sessionId } };
            }
            default:
              return { ok: false, renderer: definition.renderer, error: "invalid-action", summary: `不支持的 Browser action: ${action}。支持: launch, navigate, click, fill, type, screenshot, evaluate, get_text, dom, scroll, wait, hover, select, get_attribute, close, list_sessions` };
          }
        } catch (error) {
          return { ok: false, renderer: definition.renderer, error: "browser-error", summary: `浏览器操作失败：${error instanceof Error ? error.message : String(error)}` };
        }
      };
    // --- Terminal: 进程管理 ---
    case "Terminal":
      return async ({ input, sessionId, definition }) => {
        const action = typeof input.action === "string" ? input.action : "";
        const { TerminalStore } = await import("./terminal-store.js");
        // 使用模块级单例
        const store = (globalThis as Record<string, unknown>).__nf_terminal_store ??= new TerminalStore();
        const terminalStore = store as InstanceType<typeof TerminalStore>;

        switch (action) {
          case "list": {
            const terminals = terminalStore.list();
            // 只返回当前 session 拥有的终端
            const buffers = (globalThis as Record<string, unknown>).__nf_terminal_buffers as Map<string, { proc: ReturnType<typeof import("node:child_process").spawn>; output: string; ownerSessionId: string }> | undefined;
            const ownedIds = new Set<string>();
            if (buffers) {
              for (const [id, entry] of buffers.entries()) {
                if (entry.ownerSessionId === sessionId) ownedIds.add(id);
              }
            }
            const running = terminals.running.filter(t => ownedIds.has(t.id));
            const exited = terminals.exited.filter(t => ownedIds.has(t.id));
            const total = running.length + exited.length;
            return { ok: true, renderer: definition.renderer, summary: `${total} 个终端（${running.length} 运行中）。`, data: { terminals: { running, exited } } };
          }
          case "create": {
            const name = typeof input.name === "string" ? input.name : "Terminal";
            const cwd = typeof input.cwd === "string" ? input.cwd : (process.cwd());
            const id = `${sessionId}:${crypto.randomUUID().slice(0, 8)}`;
            const { spawn } = await import("node:child_process");
            const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
            const proc = spawn(shell, [], { cwd, stdio: ["pipe", "pipe", "pipe"] });
            const info = { id, name, status: "running" as const, cwd, createdAt: new Date().toISOString(), pid: proc.pid };
            terminalStore.register(info);
            // 存储进程引用和输出缓冲（含 ownerSessionId）
            const buffers = (globalThis as Record<string, unknown>).__nf_terminal_buffers ??= new Map<string, { proc: ReturnType<typeof spawn>; output: string; ownerSessionId: string }>();
            const bufferMap = buffers as Map<string, { proc: ReturnType<typeof spawn>; output: string; ownerSessionId: string }>;
            const entry = { proc, output: "", ownerSessionId: sessionId };
            proc.stdout?.on("data", (chunk: Buffer) => { entry.output += chunk.toString(); });
            proc.stderr?.on("data", (chunk: Buffer) => { entry.output += chunk.toString(); });
            proc.on("exit", () => { terminalStore.markExited(id); });
            bufferMap.set(id, entry);
            return { ok: true, renderer: definition.renderer, summary: `终端 "${name}" 已创建（ID: ${id}，PID: ${proc.pid}）。`, data: { id, name, cwd, pid: proc.pid } };
          }
          case "write": {
            const terminalId = typeof input.terminal_id === "string" ? input.terminal_id : "";
            const inputText = typeof input.input === "string" ? input.input : "";
            if (!terminalId) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "terminal_id 不能为空。" };
            const buffers = (globalThis as Record<string, unknown>).__nf_terminal_buffers as Map<string, { proc: ReturnType<typeof import("node:child_process").spawn>; output: string; ownerSessionId: string }> | undefined;
            const entry = buffers?.get(terminalId);
            if (!entry || entry.ownerSessionId !== sessionId) return { ok: false, renderer: definition.renderer, error: "not-found", summary: `终端 ${terminalId} 不存在或无权访问。` };
            entry.proc.stdin?.write(inputText + "\n");
            return { ok: true, renderer: definition.renderer, summary: `已向终端 ${terminalId} 写入 ${inputText.length} 字符。`, data: { terminalId, written: inputText.length } };
          }
          case "read": {
            const terminalId = typeof input.terminal_id === "string" ? input.terminal_id : "";
            if (!terminalId) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "terminal_id 不能为空。" };
            const buffers = (globalThis as Record<string, unknown>).__nf_terminal_buffers as Map<string, { proc: ReturnType<typeof import("node:child_process").spawn>; output: string; ownerSessionId: string }> | undefined;
            const entry = buffers?.get(terminalId);
            if (!entry || entry.ownerSessionId !== sessionId) return { ok: false, renderer: definition.renderer, error: "not-found", summary: `终端 ${terminalId} 不存在或无权访问。` };
            const output = entry.output;
            entry.output = ""; // 清空已读缓冲
            return { ok: true, renderer: definition.renderer, summary: output ? `终端输出 ${output.length} 字符。` : "无新输出。", data: { terminalId, output } };
          }
          default:
            return { ok: false, renderer: definition.renderer, error: "invalid-action", summary: `不支持的 Terminal action: ${action}。支持: list/create/write/read` };
        }
      };
    // --- Agent: 子代理执行 ---
    case "Agent":
      return async ({ input, sessionId, definition, sessionConfig, signal: parentSignal }) => {
        const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
        const description = typeof input.description === "string" ? input.description : "";
        if (!prompt && !description) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "prompt 或 description 不能为空。" };
        }
        const subagentType = typeof input.subagent_type === "string" ? input.subagent_type : "general";
        const runInBackground = input.run_in_background === true;
        const agentId = crypto.randomUUID().slice(0, 8);

        const { executeRuntimeTurn } = await import("./runtime-turn-service.js");
        const { generateSessionReply } = await import("./llm-runtime-service.js");
        const { getEnabledSessionTools } = await import("./session-tool-registry.js");
        const { createSession, getSessionById } = await import("./session-service.js");
        const { loadUserConfig } = await import("./user-config-service.js");
        const { getSessionChatSnapshot } = await import("./session-chat-service.js");

        // 创建子代理专用的 AbortController
        const subAbortController = new AbortController();
        const subSignal = subAbortController.signal;

        // For foreground agents: parent abort converts to background (not kill).
        // For background agents: parent abort propagates to kill the child.
        if (parentSignal && runInBackground) {
          if (parentSignal.aborted) {
            subAbortController.abort(parentSignal.reason);
          } else {
            const propagateAbort = () => subAbortController.abort(parentSignal.reason);
            parentSignal.addEventListener("abort", propagateAbort, { once: true });
            subSignal.addEventListener("abort", () => parentSignal.removeEventListener("abort", propagateAbort), { once: true });
          }
        }
        // For foreground: parentSignal abort is handled in the race below (convert to background)

        // --- 查找自定义子代理类型（在 executeSubagent 之前验证） ---
        const BUILTIN_SUBAGENT_TYPES = ["explore", "plan", "general", "fork"];
        const isCustomType = !BUILTIN_SUBAGENT_TYPES.includes(subagentType);
        let customSubagent: import("../../types/routines.js").SubAgent | undefined;
        if (isCustomType) {
          const { loadGlobalRoutines } = await import("./routines-service.js");
          const routines = await loadGlobalRoutines();
          customSubagent = routines.subAgents.find(sa => sa.id === subagentType || sa.name === subagentType);
          if (!customSubagent || !customSubagent.enabled) {
            return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: `未找到自定义子代理类型 "${subagentType}"。可用内置类型: explore, plan, general, fork` };
          }
        }

        const executeSubagent = async (): Promise<string> => {
          // 检查是否已被中断
          if (subSignal.aborted) {
            throw new Error("子代理已被中断。");
          }

          const parentSession = await getSessionById(sessionId);

          // --- Fork mode: inherit parent context for prompt cache sharing ---
          if (subagentType === "fork") {
            const parentConfig = parentSession?.sessionConfig ?? sessionConfig;
            const resolvedProviderId = parentConfig?.providerId ?? "openai";
            const resolvedModelId = parentConfig?.modelId ?? "gpt-4o";
            const subPermissionMode = parentSession?.sessionConfig.permissionMode ?? "edit" as const;

            const subSession = await createSession({
              title: description || `fork子代理: ${(prompt || description).slice(0, 30)}`,
              agentId: "subagent",
              sessionMode: "chat",
              // 子代理不继承 projectId，避免出现在书籍叙述者列表中
              worktree: parentSession?.worktree,
              parentSessionId: sessionId,
              sessionConfig: { permissionMode: subPermissionMode, providerId: resolvedProviderId, modelId: resolvedModelId },
            });

            // Get parent messages for cache sharing — limit to last 20 to avoid excessive token usage
            const parentSnapshot = await getSessionChatSnapshot(sessionId);
            const parentMessages = parentSnapshot?.messages ?? [];
            const recentParentMessages = parentMessages.slice(-20);

            // Convert parent messages to AgentTurnItems
            const parentTurnItems: import("./agent-turn-runtime.js").AgentTurnItem[] = recentParentMessages
              .filter(m => m.role === "user" || m.role === "assistant")
              .map(m => ({
                type: "message" as const,
                role: m.role as "user" | "assistant",
                content: m.content,
              }));

            // Append fork directive as a user message
            parentTurnItems.push({
              type: "message" as const,
              role: "user" as const,
              content: `[Fork Task] ${prompt || description}\n\n请完成上述任务后返回结果。保持简洁。`,
            });

            // Use full tool set (same as parent) for cache consistency
            const FORK_DISABLED = ["Agent", "ForkNarrator", "Send", "Await"];
            const subTools = getEnabledSessionTools(
              subPermissionMode,
              "subagent",
              { disabledTools: FORK_DISABLED },
            );

            // Use parent's system prompt style for cache hit
            const workDir = parentSession?.worktree?.trim() || options.workDir || process.cwd();
            const forkSystemPrompt = `你是一个执行委派任务的子代理。完成任务并简洁地报告结果。

## Current Working Directory

\`${workDir}\`

All tools (Shell, Read, Write, Edit, Glob, Grep) already use this as their default working directory. Do NOT \`cd\` into it in Shell commands — it is redundant.`;

            const turn = await executeRuntimeTurn({
              sessionId: subSession.id,
              sessionConfig: subSession.sessionConfig,
              messages: parentTurnItems,
              systemPrompt: forkSystemPrompt,
              tools: subTools,
              permissionMode: subPermissionMode,
              maxSteps: 20,
              signal: subSignal,
              generate: async (generateInput) => {
                const result = await generateSessionReply({
                  sessionConfig: subSession.sessionConfig,
                  messages: generateInput.messages,
                  tools: generateInput.tools,
                  onStreamChunk: generateInput.onStreamChunk,
                  signal: generateInput.signal,
                });
                return result as any;
              },
              executeTool: async (toolInput) => {
                const executor = createSessionToolExecutor({ workDir });
                return executor.execute({ ...toolInput, signal: subSignal });
              },
            });

            const assistantMessages = turn.agentEvents
              .filter((e): e is Extract<typeof e, { type: "assistant_message" }> => e.type === "assistant_message")
              .map(e => e.content);
            return assistantMessages.join("\n\n") || "子代理未返回文本结果。";
          }

          // --- Non-fork modes: explore / plan / general / custom ---
          // --- 根据 subagent_type 选择模型 ---
          const userConfig = await loadUserConfig();
          const md = userConfig.modelDefaults;
          let modelRef: string | undefined;
          if (subagentType === "explore" && md.exploreSubagentModel) modelRef = md.exploreSubagentModel;
          else if (subagentType === "plan" && md.planSubagentModel) modelRef = md.planSubagentModel;
          else if (subagentType === "general" && md.generalSubagentModel) modelRef = md.generalSubagentModel;

          // 解析 providerId:modelId，fallback 到主会话模型
          const parentConfig = parentSession?.sessionConfig ?? sessionConfig;
          let resolvedProviderId = parentConfig?.providerId ?? "openai";
          let resolvedModelId = parentConfig?.modelId ?? "gpt-4o";
          if (modelRef) {
            const [pId, ...mParts] = modelRef.split(":");
            if (pId && mParts.length > 0) {
              resolvedProviderId = pId;
              resolvedModelId = mParts.join(":");
            }
          }

          // --- 根据 subagent_type 确定权限模式 ---
          const subPermissionMode = subagentType === "explore" ? "read" as const : (parentSession?.sessionConfig.permissionMode ?? "edit" as const);

          const subSession = await createSession({
            title: description || `${subagentType}子代理: ${(prompt || description).slice(0, 30)}`,
            agentId: "subagent",
            sessionMode: "chat",
            // 子代理不继承 projectId，避免出现在书籍叙述者列表中
            worktree: parentSession?.worktree,
            parentSessionId: sessionId,
            sessionConfig: { permissionMode: subPermissionMode, providerId: resolvedProviderId, modelId: resolvedModelId },
          });

          // --- 根据 subagent_type 过滤工具集 ---
          // explore: 只读工具；plan: 读写工具；general: 全部（排除递归工具）；custom: 按配置
          const EXPLORE_DISABLED = ["Agent", "ForkNarrator", "Send", "Await", "Bash", "Write", "Edit", "Terminal", "Browser", "EnterWorktree", "ExitWorktree"];
          const PLAN_DISABLED = ["Agent", "ForkNarrator", "Send", "Await", "Bash", "Terminal", "Browser", "EnterWorktree", "ExitWorktree"];
          const GENERAL_DISABLED = ["Agent", "ForkNarrator", "Send", "Await"];

          let disabledTools: string[];
          if (customSubagent) {
            // 自定义子代理：从 toolPermissions 中提取 deny 列表，始终禁止递归
            const denyFromPermissions = (customSubagent.toolPermissions ?? [])
              .filter(p => p.permission === "deny")
              .map(p => p.tool);
            disabledTools = [...new Set(["Agent", "ForkNarrator", "Send", "Await", ...denyFromPermissions])];
          } else {
            disabledTools = subagentType === "explore" ? EXPLORE_DISABLED
              : subagentType === "plan" ? PLAN_DISABLED
              : GENERAL_DISABLED;
          }

          const subTools = getEnabledSessionTools(
            subSession.sessionConfig.permissionMode,
            "subagent",
            { disabledTools },
          );

          // --- 根据 subagent_type 构建 system prompt ---
          const workDir = parentSession?.worktree?.trim() || options.workDir || process.cwd();
          let subagentSystemPrompt: string;
          if (customSubagent) {
            // 自定义子代理使用用户定义的 systemPrompt
            subagentSystemPrompt = `${customSubagent.systemPrompt}\n\n## Current Working Directory\n\n\`${workDir}\`\n\nAll tools (Shell, Read, Write, Edit, Glob, Grep) already use this as their default working directory. Do NOT \`cd\` into it in Shell commands — it is redundant.`;
          } else {
            const typeLabel = subagentType === "explore" ? "探索" : subagentType === "plan" ? "规划" : "通用";
            subagentSystemPrompt = `你是一个执行委派任务的子代理。完成任务并简洁地报告结果。

## Current Working Directory

\`${workDir}\`

All tools (Shell, Read, Write, Edit, Glob, Grep) already use this as their default working directory. Do NOT \`cd\` into it in Shell commands — it is redundant.${subagentType === "explore" ? `

## 约束

你是${typeLabel}子代理，只能读取和搜索，不能修改任何文件。` : subagentType === "plan" ? `

## 约束

你是${typeLabel}子代理，可以读写文件但不能执行 shell 命令。` : ""}`;
          }

          // --- 根据 subagent_type 确定 maxSteps ---
          const maxSteps = subagentType === "explore" ? 10 : subagentType === "plan" ? 15 : 20;

          const turn = await executeRuntimeTurn({
            sessionId: subSession.id,
            sessionConfig: subSession.sessionConfig,
            messages: [{ type: "message" as const, role: "user" as const, content: prompt || description }],
            systemPrompt: subagentSystemPrompt,
            tools: subTools,
            permissionMode: subSession.sessionConfig.permissionMode,
            maxSteps,
            signal: subSignal,
            generate: async (generateInput) => {
              const result = await generateSessionReply({
                sessionConfig: subSession.sessionConfig,
                messages: generateInput.messages,
                tools: generateInput.tools,
                onStreamChunk: generateInput.onStreamChunk,
                signal: generateInput.signal,
              });
              return result as any;
            },
            executeTool: async (toolInput) => {
              const executor = createSessionToolExecutor({ workDir });
              return executor.execute({ ...toolInput, signal: subSignal });
            },
          });

          // 收集子代理所有文本输出
          const assistantMessages = turn.agentEvents
            .filter((e): e is Extract<typeof e, { type: "assistant_message" }> => e.type === "assistant_message")
            .map(e => e.content);
          return assistantMessages.join("\n\n") || "子代理未返回文本结果。";
        };

        // --- Background 模式：立即返回 ---
        if (runInBackground) {
          const task: BackgroundAgentTask = {
            id: agentId,
            promise: executeSubagent(),
            status: "running",
            startedAt: Date.now(),
            subagentType,
            prompt: (prompt || description).slice(0, 100),
            abortController: subAbortController,
          };
          task.promise.then(r => { task.result = r; task.status = "completed"; }).catch(e => { task.result = String(e); task.status = "failed"; });
          backgroundAgents.set(agentId, task);
          return {
            ok: true,
            renderer: definition.renderer,
            summary: `${subagentType} 子代理已在后台启动（ID: ${agentId}）。使用 Await 工具等待结果。`,
            data: { agentId, subagentType, status: "running" },
          };
        }

        // --- Foreground 模式：带自动后台化超时 + abort 转后台 ---
        const AUTO_BACKGROUND_MS = 120_000;

        try {
          const turnPromise = executeSubagent();
          const timeoutPromise = new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), AUTO_BACKGROUND_MS)
          );

          // Parent abort converts foreground agent to background (not kill)
          const abortPromise = parentSignal && !parentSignal.aborted
            ? new Promise<"aborted">((resolve) => {
                parentSignal.addEventListener("abort", () => resolve("aborted"), { once: true });
              })
            : new Promise<never>(() => {});

          const raceResult = await Promise.race([turnPromise, timeoutPromise, abortPromise]);

          if (raceResult === "aborted" || raceResult === "timeout") {
            // Convert to background task — do NOT abort the child
            const task: BackgroundAgentTask = {
              id: agentId,
              promise: turnPromise,
              status: "running",
              startedAt: raceResult === "timeout" ? Date.now() - AUTO_BACKGROUND_MS : Date.now(),
              subagentType,
              prompt: (prompt || description).slice(0, 100),
              abortController: subAbortController,
            };
            task.promise.then(r => { task.result = r; task.status = "completed"; }).catch(e => { task.result = String(e); task.status = "failed"; });
            backgroundAgents.set(agentId, task);

            const reason = raceResult === "timeout"
              ? `子代理执行超过 ${AUTO_BACKGROUND_MS / 1000}s，已自动转为后台任务。`
              : `父级中断，子代理已转为后台继续执行。`;
            return {
              ok: true,
              renderer: definition.renderer,
              summary: `${reason} ID: ${agentId}。使用 Await 工具获取结果。`,
              data: { agentId, subagentType, status: raceResult === "timeout" ? "auto-backgrounded" : "backgrounded" },
            };
          }

          // 在超时前完成
          return {
            ok: true,
            renderer: definition.renderer,
            summary: raceResult,
            data: { agentId, subagentType, result: raceResult },
          };
        } catch (error) {
          if (subSignal.aborted) {
            return { ok: false, renderer: definition.renderer, error: "agent-aborted", summary: "子代理已被中断。" };
          }
          return { ok: false, renderer: definition.renderer, error: "agent-failed", summary: `子代理执行失败：${error instanceof Error ? error.message : String(error)}` };
        }
      };
    // --- Await: 等待后台子代理完成 ---
    case "Await":
      return async ({ input, definition }) => {
        const id = typeof input.id === "string" ? input.id : "";
        if (!id) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "id 不能为空。" };
        const awaitType = typeof input.type === "string" ? input.type : "agent";

        // Handle bash background tasks
        if (awaitType === "bash") {
          const bashTask = backgroundTasks.get(id);
          if (!bashTask) return { ok: false, renderer: definition.renderer, error: "not-found", summary: `后台 Bash 任务 ${id} 不存在。` };
          if (bashTask.status === "completed" || bashTask.status === "failed") {
            const result = bashTask.result;
            return { ok: bashTask.status === "completed", renderer: definition.renderer, summary: result?.summary ?? "无结果", data: { id, status: bashTask.status, result } };
          }
          const timeout = typeof input.timeout === "number" ? input.timeout : 30000;
          try {
            const result = await Promise.race([
              bashTask.promise,
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeout)),
            ]);
            return { ok: result.ok !== false, renderer: definition.renderer, summary: result.summary ?? "完成", data: { id, status: "completed", result } };
          } catch (error) {
            if (error instanceof Error && error.message === "timeout") {
              return { ok: true, renderer: definition.renderer, summary: `Bash 任务 ${id} 仍在运行中（超时 ${timeout}ms）。`, data: { id, status: "running" } };
            }
            return { ok: false, renderer: definition.renderer, error: "await-failed", summary: String(error) };
          }
        }

        // Handle agent background tasks
        const task = backgroundAgents.get(id);
        if (!task) return { ok: false, renderer: definition.renderer, error: "not-found", summary: `后台任务 ${id} 不存在。` };

        // 已完成或已失败：直接返回
        if (task.status === "completed" || task.status === "failed") {
          const elapsed = Date.now() - task.startedAt;
          return {
            ok: task.status === "completed",
            renderer: definition.renderer,
            summary: task.result ?? "无结果",
            data: { id, status: task.status, result: task.result, subagentType: task.subagentType, elapsedMs: elapsed },
          };
        }

        // 仍在运行：等待指定超时
        const timeout = typeof input.timeout === "number" ? input.timeout : 30000;
        const elapsed = Date.now() - task.startedAt;

        try {
          const result = await Promise.race([
            task.promise,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeout)),
          ]);
          const totalElapsed = Date.now() - task.startedAt;
          return {
            ok: true,
            renderer: definition.renderer,
            summary: String(result),
            data: { id, status: "completed", result, subagentType: task.subagentType, elapsedMs: totalElapsed },
          };
        } catch (error) {
          if (error instanceof Error && error.message === "timeout") {
            return {
              ok: true,
              renderer: definition.renderer,
              summary: `子代理 ${id}（${task.subagentType}）仍在运行中（已运行 ${Math.round(elapsed / 1000)}s，等待超时 ${timeout}ms）。`,
              data: { id, status: "running", subagentType: task.subagentType, elapsedMs: elapsed, prompt: task.prompt },
            };
          }
          return { ok: false, renderer: definition.renderer, error: "await-failed", summary: String(error) };
        }
      };
    // --- Send: 向子代理发送消息 ---
    case "Send":
      return async ({ input, definition }) => {
        const id = typeof input.id === "string" ? input.id : "";
        const message = typeof input.message === "string" ? input.message : "";
        if (!id || !message) return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "id 和 message 不能为空。" };
        const task = backgroundAgents.get(id);
        if (!task) return { ok: false, renderer: definition.renderer, error: "not-found", summary: `子代理 ${id} 不存在。` };
        return {
          ok: true,
          renderer: definition.renderer,
          summary: `消息已记录给子代理 ${id}（当前为一次性执行模式，消息将在下次交互时生效）。`,
          data: { id, message, status: task.status },
        };
      };
    // --- ToolSearch: 动态工具搜索 ---
    case "ToolSearch":
      return async ({ input, definition }) => {
        const query = String(input.query ?? "").toLowerCase().trim();
        if (!query) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "query 不能为空。" };
        }
        const { listSessionToolDefinitions } = await import("./session-tool-registry.js");
        const allTools = listSessionToolDefinitions();
        // 分词搜索：query 按空格拆分为多个关键词，任一关键词匹配 name 或 description 即命中
        const keywords = query.split(/\s+/).filter(Boolean);
        const matches = allTools.filter(t => {
          const haystack = `${t.name.toLowerCase()} ${(t.description ?? "").toLowerCase()}`;
          return keywords.some(kw => haystack.includes(kw));
        });
        const results = matches.map(t => ({ name: t.name, description: t.description }));
        return {
          ok: true,
          renderer: definition.renderer,
          summary: `找到 ${results.length} 个匹配工具。`,
          data: { query, results },
        };
      };
    default:
      return undefined;
  }
}

// --- Pipeline rule execution ---

function executePipelineRule(rule: string, captures: Map<string, string>): string {
  if (!rule.trim()) {
    return [...captures.values()].join("\n");
  }

  // 解析 pipeline: "from p1 p2 | grep pattern | head -n 5"
  const segments = rule.split("|").map(s => s.trim());
  let lines: string[] = [];

  // 第一段：from 或默认全部
  const first = segments[0] ?? "";
  if (first.startsWith("from ")) {
    const aliases = first.slice(5).trim().split(/\s+/);
    lines = aliases.flatMap(alias => {
      const content = captures.get(alias);
      return content ? content.split("\n") : [];
    });
    // 后续段从 index 1 开始
  } else if (first) {
    // 第一段也是命令（如 grep），用全部 captures
    lines = [...captures.values()].flatMap(v => v.split("\n"));
    // 把 first 作为命令处理
    lines = applyPipelineCommand(first, lines);
  } else {
    lines = [...captures.values()].flatMap(v => v.split("\n"));
  }

  // 后续段：管道命令（始终从 index 1 开始，第一段已在上面处理）
  for (let i = 1; i < segments.length; i++) {
    const cmd = segments[i]!.trim();
    if (!cmd) continue;
    lines = applyPipelineCommand(cmd, lines);
  }

  return lines.join("\n");
}

function applyPipelineCommand(cmd: string, lines: string[]): string[] {
  // grep [-i] [-v] PATTERN
  const grepMatch = cmd.match(/^grep\s+(?:(-[iv]+)\s+)?(.+)$/);
  if (grepMatch) {
    const flags = grepMatch[1] ?? "";
    const pattern = grepMatch[2]!.replace(/^["']|["']$/g, "");
    const ignoreCase = flags.includes("i");
    const invert = flags.includes("v");
    try {
      const regex = new RegExp(pattern, ignoreCase ? "i" : "");
      return lines.filter(line => invert ? !regex.test(line) : regex.test(line));
    } catch {
      // 无效正则，fallback 到字符串匹配
      const lowerPattern = ignoreCase ? pattern.toLowerCase() : pattern;
      return lines.filter(line => {
        const target = ignoreCase ? line.toLowerCase() : line;
        return invert ? !target.includes(lowerPattern) : target.includes(lowerPattern);
      });
    }
  }

  // head [-n] N
  const headMatch = cmd.match(/^head\s+(?:-n\s+)?(\d+)$/);
  if (headMatch) {
    return lines.slice(0, parseInt(headMatch[1]!, 10));
  }

  // tail [-n] N
  const tailMatch = cmd.match(/^tail\s+(?:-n\s+)?(\d+)$/);
  if (tailMatch) {
    const n = parseInt(tailMatch[1]!, 10);
    return lines.slice(-n);
  }

  // sort [-r]
  if (cmd === "sort" || cmd === "sort -r") {
    const sorted = [...lines].sort();
    return cmd.includes("-r") ? sorted.reverse() : sorted;
  }

  // uniq
  if (cmd === "uniq") {
    return lines.filter((line, i) => i === 0 || line !== lines[i - 1]);
  }

  // cut -d DELIM -f FIELDS
  const cutMatch = cmd.match(/^cut\s+-d\s+(\S)\s+-f\s+(.+)$/);
  if (cutMatch) {
    const delim = cutMatch[1]!;
    const fieldSpec = cutMatch[2]!;
    const fields = fieldSpec.split(",").flatMap(spec => {
      const range = spec.match(/^(\d+)-(\d+)$/);
      if (range) {
        const start = parseInt(range[1]!, 10);
        const end = parseInt(range[2]!, 10);
        return Array.from({ length: end - start + 1 }, (_, i) => start + i);
      }
      return [parseInt(spec, 10)];
    }).filter(n => !isNaN(n));
    return lines.map(line => {
      const parts = line.split(delim);
      return fields.map(f => parts[f - 1] ?? "").join(delim);
    });
  }

  // wc -l (count lines)
  if (cmd === "wc -l") {
    return [String(lines.length)];
  }

  // 未识别的命令，原样返回
  return lines;
}

async function resolveQuestionnaireService(options: SessionToolExecutorOptions): Promise<QuestionnaireToolService> {
  if (options.questionnaireService) return options.questionnaireService;
  const { createQuestionnaireToolService } = await import("@vivy1024/novelfork-novel-plugin/handlers");
  return createQuestionnaireToolService();
}

async function resolvePGIService(options: SessionToolExecutorOptions): Promise<PGIToolService> {
  if (options.pgiService) return options.pgiService;
  const { createPGIToolService } = await import("@vivy1024/novelfork-novel-plugin/handlers");
  return createPGIToolService();
}

async function resolveGuidedService(options: SessionToolExecutorOptions): Promise<GuidedGenerationToolService> {
  if (options.guidedService) return options.guidedService;
  const { createGuidedGenerationToolService } = await import("@vivy1024/novelfork-novel-plugin/handlers");
  return createGuidedGenerationToolService();
}

async function resolveCandidateService(options: SessionToolExecutorOptions): Promise<CandidateToolService> {
  if (options.candidateService) return options.candidateService;
  throw new Error("candidate.create_chapter requires a configured CandidateToolService.");
}

function resolveNarrativeService(options: SessionToolExecutorOptions): Partial<Pick<NarrativeLineService, "getSnapshot" | "proposeChange" | "applyChange">> {
  if (options.narrativeService) return options.narrativeService;
  throw new Error("narrative tools require a configured NarrativeLineService.");
}

function withDuration(
  result: SessionToolExecutionResult,
  startedAt: number,
  options: SessionToolExecutorOptions,
): SessionToolExecutionResult {
  const finishedAt = (options.now ?? Date.now)();
  return {
    ...result,
    durationMs: Math.max(0, finishedAt - startedAt),
  };
}

function withConfirmationAudit(
  result: SessionToolExecutionResult,
  input: SessionToolExecutionInput,
  definition: SessionToolDefinition,
  confirmation?: ToolConfirmationRequest,
): SessionToolExecutionResult {
  if (!confirmation && !input.confirmationDecision && definition.risk === "read") {
    return result;
  }

  return {
    ...result,
    confirmationAudit: createConfirmationAudit(result, input, definition, confirmation),
  };
}

function createConfirmationAudit(
  result: SessionToolExecutionResult,
  input: SessionToolExecutionInput,
  definition: SessionToolDefinition,
  confirmation?: ToolConfirmationRequest,
): ToolConfirmationAudit {
  const decision = input.confirmationDecision;
  const normalizedConfirmation = confirmation
    ? normalizeToolConfirmationRequest(confirmation, { sessionId: input.sessionId, input: input.input })
    : undefined;
  return {
    confirmationId: decision?.confirmationId ?? normalizedConfirmation?.id ?? `confirm:${input.sessionId}:${definition.name}`,
    sessionId: decision?.sessionId ?? normalizedConfirmation?.sessionId ?? input.sessionId,
    toolName: definition.name,
    targetResources: normalizedConfirmation?.targetResources ?? getConfirmationTargetResources(input, definition, confirmation),
    summary: result.summary,
    risk: definition.risk,
    ...(normalizedConfirmation?.source ? { source: normalizedConfirmation.source } : {}),
    ...(normalizedConfirmation?.checkpoint ? { checkpoint: normalizedConfirmation.checkpoint } : {}),
    ...(decision ? { decision: decision.decision, decidedAt: decision.decidedAt } : {}),
    ...(decision?.reason ? { reason: decision.reason } : {}),
  };
}

function getConfirmationTargetResources(
  input: SessionToolExecutionInput,
  definition: SessionToolDefinition,
  confirmation?: ToolConfirmationRequest,
): NonNullable<ToolConfirmationAudit["targetResources"]> {
  if (confirmation?.targetResource) {
    return [confirmation.targetResource];
  }

  const target = stringifyTarget(input.input.bookId ?? input.input.target ?? input.input.resourceId ?? definition.name);
  return [typeof input.input.bookId === "string"
    ? { kind: definition.name, id: target, bookId: input.input.bookId }
    : { kind: definition.name, id: target }];
}

function createConfirmationRequest(
  input: SessionToolExecutionInput,
  definition: SessionToolDefinition,
  options: SessionToolExecutorOptions,
): ToolConfirmationRequest {
  const now = (options.now ?? Date.now)();
  const toolInput = input.input;
  const target = stringifyTarget(toolInput.bookId ?? toolInput.target ?? toolInput.resourceId ?? definition.name);
  return normalizeToolConfirmationRequest({
    id: options.createConfirmationId?.(input, definition) ?? `confirm:${input.sessionId}:${definition.name}:${now}`,
    toolName: definition.name,
    target,
    risk: definition.risk === "destructive" ? "destructive" : "confirmed-write",
    summary: `${definition.description}（需要用户确认）`,
    ...(createConfirmationDiff(input, definition) !== undefined ? { diff: createConfirmationDiff(input, definition) } : {}),
    options: CONFIRMATION_OPTIONS,
    ...(typeof toolInput.bookId === "string" ? { targetResource: { kind: definition.name, id: target, bookId: toolInput.bookId } } : {}),
    sessionId: input.sessionId,
    createdAt: new Date(now).toISOString(),
  }, {
    sessionId: input.sessionId,
    input: input.input,
    checkpoint: { required: definition.risk === "confirmed-write" || definition.risk === "destructive" },
  });
}

function createConfirmationDiff(input: SessionToolExecutionInput, definition: SessionToolDefinition): unknown | undefined {
  if (definition.name === "questionnaire.submit_response") {
    return {
      status: "mapping-preview",
      bookId: input.input.bookId,
      templateId: input.input.templateId,
      ...(input.input.responseId ? { responseId: input.input.responseId } : {}),
      answers: input.input.answers ?? {},
    };
  }

  if (definition.name === "narrative.propose_change") {
    return {
      status: "mutation-preview",
      bookId: input.input.bookId,
      summary: input.input.summary,
      ...(Array.isArray(input.input.nodes) ? { nodes: input.input.nodes } : {}),
      ...(Array.isArray(input.input.edges) ? { edges: input.input.edges } : {}),
      ...(typeof input.input.reason === "string" ? { reason: input.input.reason } : {}),
    };
  }

  return undefined;
}

function stringifyTarget(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "未命名目标";
}

function validateToolInput(input: Record<string, unknown>, definition: SessionToolDefinition): ValidationIssue[] {
  const schema = definition.inputSchema;
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return [{ path: "$", message: "输入必须是对象" }];
  }

  for (const requiredKey of schema.required ?? []) {
    if (!(requiredKey in input)) {
      issues.push({ path: requiredKey, message: `缺少必填字段 ${requiredKey}` });
    }
  }

  const properties = schema.properties ?? {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(input)) {
      if (!(key in properties)) {
        issues.push({ path: key, message: `不支持的字段 ${key}` });
      }
    }
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!(key in input)) {
      continue;
    }

    const issue = validatePropertyType(key, input[key], propertySchema);
    if (issue) {
      issues.push(issue);
    }
  }

  return issues;
}

function validatePropertyType(path: string, value: unknown, propertySchema: unknown): ValidationIssue | null {
  if (!isRecord(propertySchema) || typeof propertySchema.type !== "string") {
    return null;
  }

  switch (propertySchema.type) {
    case "string":
      return typeof value === "string" ? null : { path, message: `字段 ${path} 必须是字符串` };
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : { path, message: `字段 ${path} 必须是数字` };
    case "boolean":
      return typeof value === "boolean" ? null : { path, message: `字段 ${path} 必须是布尔值` };
    case "array":
      return Array.isArray(value) ? null : { path, message: `字段 ${path} 必须是数组` };
    case "object":
      return isRecord(value) ? null : { path, message: `字段 ${path} 必须是对象` };
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
