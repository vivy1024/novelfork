import type { CockpitService } from "./cockpit-service.js";
import {
  normalizeToolConfirmationRequest,
  type SessionToolDefinition,
  type SessionToolExecutionInput,
  type SessionToolExecutionResult,
  type ToolConfirmationAudit,
  type ToolConfirmationRequest,
} from "../../shared/agent-native-workspace.js";
import type { CandidateToolService } from "./candidate-tool-service.js";
import type { GuidedGenerationToolService } from "./guided-generation-tool-service.js";
import type { NarrativeLineService } from "./narrative-line-service.js";
import type { PGIToolService } from "./pgi-tool-service.js";
import type { QuestionnaireToolService } from "./questionnaire-tool-service.js";
import { getSessionToolDefinition } from "./session-tool-registry.js";
import { resolveSessionToolPolicy, type SessionToolPolicyResolution } from "./session-tool-policy.js";
import { executeBashTool, executeFileReadTool, executeFileWriteTool, executeFileEditTool } from "./real-tool-handlers.js";
import { validateToolPermission, classifyBashCommand, isPathWithinWorkDir } from "./permission-pipeline.js";

// --- Session-level in-memory state for Goals and Pipelines ---
const sessionGoals = new Map<string, Array<{ id: string; objective: string; status: string; createdAt: string }>>();
const sessionPipelines = new Map<string, { label: string; captures: Map<string, string>; counter: number }>();

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
  readonly now?: () => number;
  readonly createConfirmationId?: (input: SessionToolExecutionInput, definition: SessionToolDefinition) => string;
};

export type SessionToolExecutor = {
  readonly execute: (input: SessionToolExecutionInput) => Promise<SessionToolExecutionResult>;
};

type ValidationIssue = {
  readonly path: string;
  readonly message: string;
};

const CONFIRMATION_OPTIONS = ["approve", "reject", "open-in-canvas"] as const;

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

  const handler = options.handlers?.[definition.name] ?? getDefaultHandler(definition.name, options);
  if (!handler) {
    return withDuration({
      ok: false,
      renderer: definition.renderer,
      error: "tool-handler-missing",
      summary: `session tool ${definition.name} 未配置执行处理器。`,
    }, startedAt, options);
  }

  try {
    const result = await handler({ ...input, definition });
    return withDuration(withConfirmationAudit({
      ...result,
      renderer: result.renderer ?? definition.renderer,
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

function getDefaultHandler(toolName: string, options: SessionToolExecutorOptions): SessionToolHandler | undefined {
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
      return async ({ input, sessionConfig }) => (await resolveCandidateService(options)).createChapter({ ...input, ...(sessionConfig ? { sessionConfig } : {}) });
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
        const bookId = String(input.bookId);
        const chapterNumber = Number(input.chapterNumber);
        const workDir = options.workDir ?? process.cwd();
        try {
          const { readFile } = await import("node:fs/promises");
          const { join } = await import("node:path");
          const { readdirSync } = await import("node:fs");
          // Find chapter file by number pattern
          const chaptersDir = join(workDir, "books", bookId, "chapters");
          let chapterFile: string | undefined;
          try {
            const files = readdirSync(chaptersDir);
            const padded = String(chapterNumber).padStart(4, "0");
            chapterFile = files.find(f => f.startsWith(padded) && f.endsWith(".md"));
          } catch { /* chapters dir may not exist */ }
          if (!chapterFile) {
            return { ok: false, renderer: definition.renderer, error: "chapter-not-found", summary: `第 ${chapterNumber} 章文件未找到。` };
          }
          const content = await readFile(join(chaptersDir, chapterFile), "utf-8");
          return {
            ok: true,
            renderer: definition.renderer,
            summary: `已读取第 ${chapterNumber} 章（${content.length} 字）。`,
            data: { bookId, chapterNumber, fileName: chapterFile, content, wordCount: content.length },
          };
        } catch (error) {
          return { ok: false, renderer: definition.renderer, error: "read-failed", summary: `读取章节失败：${error instanceof Error ? error.message : String(error)}` };
        }
      };
    case "jingwei.read_context":
      return async ({ input, definition }) => {
        const bookId = String(input.bookId);
        const workDir = options.workDir ?? process.cwd();
        try {
          const { readdir, readFile } = await import("node:fs/promises");
          const { join } = await import("node:path");
          const CATEGORIES = ["角色", "势力", "设定", "伏笔", "大纲", "状态", "规则"];
          const jingweiDir = join(workDir, "books", bookId, "jingwei");
          const categories: Array<{ name: string; files: Array<{ name: string; content: string }> }> = [];
          for (const cat of CATEGORIES) {
            const catDir = join(jingweiDir, cat);
            try {
              const files = await readdir(catDir);
              const mdFiles = files.filter(f => f.endsWith(".md"));
              const entries = await Promise.all(mdFiles.map(async (f) => {
                const content = await readFile(join(catDir, f), "utf-8").catch(() => "");
                return { name: f, content: content.slice(0, 2000) };
              }));
              if (entries.length > 0) categories.push({ name: cat, files: entries });
            } catch { /* category dir may not exist */ }
          }
          // Also try root-level jingwei files
          try {
            const rootFiles = await readdir(jingweiDir);
            const rootMd = rootFiles.filter(f => f.endsWith(".md"));
            const rootEntries = await Promise.all(rootMd.map(async (f) => {
              const content = await readFile(join(jingweiDir, f), "utf-8").catch(() => "");
              return { name: f, content: content.slice(0, 2000) };
            }));
            if (rootEntries.length > 0) categories.push({ name: "根目录", files: rootEntries });
          } catch { /* jingwei dir may not exist */ }
          return {
            ok: true,
            renderer: definition.renderer,
            summary: `已读取书籍 ${bookId} 的经纬上下文（${categories.length} 个分类）。`,
            data: { bookId, categories, totalFiles: categories.reduce((sum, c) => sum + c.files.length, 0) },
          };
        } catch (error) {
          return { ok: false, renderer: definition.renderer, error: "read-failed", summary: `读取经纬失败：${error instanceof Error ? error.message : String(error)}` };
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
    // --- Claude Code / Codex 级开发工具 ---
    case "Bash":
      return async ({ input, permissionMode, definition }) => {
        const workDir = typeof input.workDir === "string" ? input.workDir : (options.workDir ?? process.cwd());
        const command = String(input.command);
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
        return executeBashTool({ command, workDir, timeoutMs });
      };
    case "Read":
      return async ({ input, definition }) => {
        const workDir = options.workDir ?? process.cwd();
        const filePath = String(input.path);
        if (!isPathWithinWorkDir(filePath, workDir)) {
          return { ok: false, renderer: definition.renderer, error: "path-outside-workdir", summary: `路径 "${filePath}" 超出工作目录边界。` };
        }
        return executeFileReadTool({
          path: filePath,
          workDir,
          ...(typeof input.offset === "number" ? { offset: input.offset } : {}),
          ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
        });
      };
    case "Write":
      return async ({ input, definition }) => {
        const workDir = options.workDir ?? process.cwd();
        const filePath = String(input.path);
        if (!isPathWithinWorkDir(filePath, workDir)) {
          return { ok: false, renderer: definition.renderer, error: "path-outside-workdir", summary: `路径 "${filePath}" 超出工作目录边界。` };
        }
        return executeFileWriteTool({ path: filePath, content: String(input.content), workDir });
      };
    case "Edit":
      return async ({ input, definition }) => {
        const workDir = options.workDir ?? process.cwd();
        const filePath = String(input.path);
        if (!isPathWithinWorkDir(filePath, workDir)) {
          return { ok: false, renderer: definition.renderer, error: "path-outside-workdir", summary: `路径 "${filePath}" 超出工作目录边界。` };
        }
        return executeFileEditTool({ path: filePath, oldText: String(input.oldText), newText: String(input.newText), workDir });
      };
    // --- Glob/Grep (real handlers) ---
    case "Glob":
      return async ({ input, definition }) => {
        const workDir = options.workDir ?? process.cwd();
        const pattern = String(input.pattern);
        const searchPath = typeof input.path === "string" ? input.path : ".";
        try {
          const { glob } = await import("glob");
          const cwd = searchPath === "." ? workDir : (await import("node:path")).resolve(workDir, searchPath);
          const matches = await glob(pattern, { cwd, nodir: false });
          return { ok: true, renderer: definition.renderer, summary: `匹配到 ${matches.length} 个文件。`, data: { matches, pattern, cwd } };
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
          const cwd = searchPath === "." ? workDir : (await import("node:path")).resolve(workDir, searchPath);
          const args = ["--no-heading", "--color=never"];
          if (outputMode === "files_with_matches") args.push("-l");
          else if (outputMode === "count") args.push("-c");
          if (fileGlob) args.push("--glob", fileGlob);
          args.push(pattern);
          const { stdout } = await execFileAsync("rg", args, { cwd, maxBuffer: 1024 * 1024 }).catch(() => ({ stdout: "" }));
          const lines = stdout.trim().split("\n").filter(Boolean);
          return { ok: true, renderer: definition.renderer, summary: `搜索完成，${lines.length} 条结果。`, data: { results: lines.slice(0, 200), pattern, outputMode, totalResults: lines.length } };
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
        const questions = Array.isArray(input.questions) ? input.questions : [];
        if (questions.length === 0) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "questions 数组为空。" };
        }
        const questionText = (questions[0] as { question?: string })?.question ?? "请回答以下问题";
        return {
          ok: true,
          renderer: "tool.ask-user-question",
          summary: `向用户提出 ${questions.length} 个问题，等待回答。`,
          data: { status: "pending-confirmation", questions },
          confirmation: {
            id: crypto.randomUUID(),
            toolName: "AskUserQuestion",
            target: questionText,
            summary: `Agent 提问：${questionText}`,
            risk: "confirmed-write",
            options: CONFIRMATION_OPTIONS,
          },
        };
      };
    case "EnterPlanMode":
      return async ({ definition }) => ({
        ok: true,
        renderer: definition.renderer,
        summary: "已进入计划模式。在此模式下只做调查和规划，不执行写入操作。",
        data: { status: "plan-mode-entered", mode: "plan" },
      });
    case "ExitPlanMode":
      return async ({ input, definition }) => {
        const plan = typeof input.plan === "string" ? (input.plan as string).trim() : "";
        if (!plan) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "plan 内容为空。" };
        }
        return {
          ok: true,
          renderer: "tool.plan-approval",
          summary: `计划已提交，等待用户批准。`,
          data: { status: "pending-confirmation", plan },
          confirmation: {
            id: crypto.randomUUID(),
            toolName: "ExitPlanMode",
            target: "计划审批",
            summary: plan.slice(0, 200),
            risk: "confirmed-write",
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

        return { ok: false, renderer: definition.renderer, error: "invalid-action", summary: `不支持的 action: ${action}` };
      };
    // --- Goals (session-level in-memory) ---
    case "GetGoals":
      return async ({ sessionId, definition }) => {
        const goals = sessionGoals.get(sessionId) ?? [];
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
        const goals = sessionGoals.get(sessionId) ?? [];
        const newGoal = { id: crypto.randomUUID(), objective, status: "active", createdAt: new Date().toISOString() };
        goals.push(newGoal);
        sessionGoals.set(sessionId, goals);
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
        const goals = sessionGoals.get(sessionId) ?? [];
        const activeGoal = goals.find(g => g.status === "active");
        if (!activeGoal) {
          return { ok: false, renderer: definition.renderer, error: "no-active-goal", summary: "没有活跃目标可以标记完成。" };
        }
        activeGoal.status = "complete";
        return {
          ok: true,
          renderer: definition.renderer,
          summary: `目标已完成：${activeGoal.objective}`,
          data: { goal: activeGoal },
        };
      };
    // --- LearningGuide (reads docs/learning/) ---
    case "LearningGuide":
      return async ({ input, definition }) => {
        const mode = typeof input.mode === "string" ? input.mode : "list";
        const { readdir, readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");

        const learningDir = join(options.workDir ?? process.cwd(), "docs", "learning");

        if (mode === "list") {
          try {
            const files = await readdir(learningDir);
            const docs = files.filter(f => f.endsWith(".md")).map(f => ({ id: f.replace(".md", ""), title: f.replace(".md", "").replace(/-/g, " ") }));
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
            const results: Array<{ id: string; title: string; snippet: string }> = [];
            for (const file of files.filter(f => f.endsWith(".md"))) {
              const content = await readFile(join(learningDir, file), "utf-8");
              if (content.toLowerCase().includes(query)) {
                const idx = content.toLowerCase().indexOf(query);
                results.push({ id: file.replace(".md", ""), title: file.replace(".md", ""), snippet: content.slice(Math.max(0, idx - 50), idx + 150) });
              }
            }
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
        const rule = typeof input.rule === "string" ? input.rule : "";
        const captures = Object.fromEntries(pipeline.captures);
        sessionPipelines.delete(sessionId);
        const allContent = [...pipeline.captures.values()].join("\n");
        return {
          ok: true,
          renderer: definition.renderer,
          summary: `管道结束，共 ${pipeline.captures.size} 个捕获。`,
          data: { rule, captures, result: allContent },
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
        const filePath = typeof input.path === "string" ? (input.path as string).trim() : "";
        if (!filePath) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "path 不能为空。" };
        }

        const { stat } = await import("node:fs/promises");
        const { join, basename } = await import("node:path");
        const workDir = options.workDir ?? process.cwd();
        const resolvedPath = join(workDir, filePath);

        try {
          const stats = await stat(resolvedPath);
          const fileName = basename(resolvedPath);
          const sizeKb = Math.round(stats.size / 1024);
          const shareId = crypto.randomUUID().slice(0, 8);
          return {
            ok: true,
            renderer: definition.renderer,
            summary: `文件 ${fileName}（${sizeKb}KB）已准备分享。`,
            data: { shareId, fileName, path: filePath, sizeBytes: stats.size, isDirectory: stats.isDirectory() },
          };
        } catch {
          return { ok: false, renderer: definition.renderer, error: "file-not-found", summary: `文件不存在：${filePath}` };
        }
      };
    // --- Skill: 调用已注册技能 ---
    case "Skill":
      return async ({ definition, input }) => {
        const skillName = typeof input.skill === "string" ? (input.skill as string).trim() : "";
        if (!skillName) {
          return { ok: false, renderer: definition.renderer, error: "invalid-input", summary: "skill 名称不能为空。" };
        }
        const args = typeof input.args === "string" ? input.args : "";
        return {
          ok: true,
          renderer: definition.renderer,
          summary: `技能 "${skillName}" 已识别，参数：${args || "(无)"}。技能系统尚未完全接入运行时，请通过叙述者会话直接使用 /${skillName} 命令。`,
          data: { skill: skillName, args, status: "partial", note: "技能执行需要通过会话消息路由，当前工具入口仅做识别。" },
        };
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
          const response = await fetch(url, { headers: { "User-Agent": "NovelFork/0.2.0" }, signal: AbortSignal.timeout(15000) });
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
        // WebSearch 需要外部搜索 API（如 SerpAPI、Tavily 等），当前返回提示
        return {
          ok: false,
          renderer: definition.renderer,
          error: "no-search-api",
          summary: `网络搜索需要配置搜索 API。请在设置中配置搜索服务，或使用 WebFetch 直接获取已知 URL 的内容。`,
          data: { query, status: "no-search-api-configured" },
        };
      };
    // --- Stub handlers for remaining complex tools ---
    case "Browser":
    case "Agent":
    case "Await":
    case "Send":
    case "Terminal":
      return async ({ definition }) => ({
        ok: false,
        renderer: definition.renderer,
        error: "not-implemented",
        summary: `工具 ${definition.name} 尚未实现，请使用其他方式完成此操作。`,
        data: { status: "not-implemented", toolName: definition.name },
      });
    default:
      return undefined;
  }
}

async function resolveQuestionnaireService(options: SessionToolExecutorOptions): Promise<QuestionnaireToolService> {
  if (options.questionnaireService) return options.questionnaireService;
  const { createQuestionnaireToolService } = await import("./questionnaire-tool-service.js");
  return createQuestionnaireToolService();
}

async function resolvePGIService(options: SessionToolExecutorOptions): Promise<PGIToolService> {
  if (options.pgiService) return options.pgiService;
  const { createPGIToolService } = await import("./pgi-tool-service.js");
  return createPGIToolService();
}

async function resolveGuidedService(options: SessionToolExecutorOptions): Promise<GuidedGenerationToolService> {
  if (options.guidedService) return options.guidedService;
  const { createGuidedGenerationToolService } = await import("./guided-generation-tool-service.js");
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
