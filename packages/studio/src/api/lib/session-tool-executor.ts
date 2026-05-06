import type { CockpitService } from "./cockpit-service.js";
import {
  getSessionToolRiskDecision,
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
import { getSessionToolPolicyDecision } from "./session-tool-policy.js";

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

function riskDecisionFromPolicy(
  input: SessionToolExecutionInput,
  definition: SessionToolDefinition,
): { action: "inherit" | "deny" | "ask" | "allow"; source?: string; pattern?: string } {
  const decision = getSessionToolPolicyDecision(definition.name, input.sessionConfig?.toolPolicy);
  return decision;
}

function createPolicyDeniedResult(
  input: SessionToolExecutionInput,
  definition: SessionToolDefinition,
  source: string | undefined,
  pattern: string | undefined,
): SessionToolExecutionResult {
  return {
    ok: false,
    renderer: definition.renderer,
    error: "policy-denied",
    summary: `工具策略禁止执行 ${definition.name}。`,
    data: {
      status: "policy-denied",
      toolName: definition.name,
      ...(source ? { source } : {}),
      ...(pattern ? { pattern } : {}),
      risk: definition.risk,
      permissionMode: input.permissionMode,
    },
  };
}

function createPolicyAskResult(
  input: SessionToolExecutionInput,
  definition: SessionToolDefinition,
  source: string | undefined,
  pattern: string | undefined,
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
      ...(source ? { source } : {}),
      ...(pattern ? { pattern } : {}),
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

  const policyDecision = riskDecisionFromPolicy(input, definition);
  if (policyDecision.action === "deny") {
    return withDuration(createPolicyDeniedResult(input, definition, policyDecision.source, policyDecision.pattern), startedAt, options);
  }

  const riskDecision = policyDecision.action === "allow" ? "allow" : getSessionToolRiskDecision(input.permissionMode, definition.risk);
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

  if (riskDecision === "deny") {
    return withDuration({
      ok: false,
      renderer: definition.renderer,
      error: "permission-denied",
      summary: `权限模式 ${input.permissionMode} 不允许执行 ${definition.risk} 工具 ${definition.name}`,
    }, startedAt, options);
  }

  if (policyDecision.action === "ask" && input.confirmationDecision?.decision !== "approved") {
    return withDuration(createPolicyAskResult(input, definition, policyDecision.source, policyDecision.pattern, options), startedAt, options);
  }

  if (definition.risk !== "read" && input.canvasContext?.dirty === true) {
    return withDuration({
      ok: false,
      renderer: definition.renderer,
      error: "dirty-resource-blocked",
      summary: `当前画布资源存在未保存编辑，请先保存、放弃或另存为候选后再执行 ${definition.name}。`,
      data: {
        status: "dirty-resource-blocked",
        activeTabId: input.canvasContext.activeTabId,
        activeResource: input.canvasContext.activeResource,
      },
    }, startedAt, options);
  }

  if (riskDecision === "confirm" && input.confirmationDecision?.decision !== "approved") {
    const confirmation = createConfirmationRequest(input, definition, options);
    const result: SessionToolExecutionResult = {
      ok: true,
      renderer: definition.renderer,
      summary: `工具 ${definition.name} 需要确认后执行。`,
      data: { status: "pending-confirmation" },
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
  return {
    confirmationId: decision?.confirmationId ?? confirmation?.id ?? `confirm:${input.sessionId}:${definition.name}`,
    sessionId: decision?.sessionId ?? confirmation?.sessionId ?? input.sessionId,
    toolName: definition.name,
    targetResources: getConfirmationTargetResources(input, definition, confirmation),
    summary: result.summary,
    risk: definition.risk,
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
  return {
    id: options.createConfirmationId?.(input, definition) ?? `confirm:${input.sessionId}:${definition.name}:${now}`,
    toolName: definition.name,
    target,
    risk: definition.risk === "destructive" ? "destructive" : "confirmed-write",
    summary: `${definition.description}（需要用户确认）`,
    ...(createConfirmationDiff(input, definition) !== undefined ? { diff: createConfirmationDiff(input, definition) } : {}),
    options: CONFIRMATION_OPTIONS,
    targetResource: typeof toolInput.bookId === "string"
      ? { kind: definition.name, id: target, bookId: toolInput.bookId }
      : undefined,
    sessionId: input.sessionId,
    createdAt: new Date(now).toISOString(),
  };
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
