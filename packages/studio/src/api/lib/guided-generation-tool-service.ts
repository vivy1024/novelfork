import type {
  CanvasArtifact,
  GuidedGenerationPlan,
  GuidedGenerationState,
  GuidedGenerationTarget,
  GuidedQuestion,
  SessionToolExecutionResult,
  ToolConfirmationDecision,
} from "../../shared/agent-native-workspace.js";

export type GuidedGenerationToolServiceOptions = {
  readonly now?: () => Date;
  readonly createStateId?: () => string;
  readonly initialStates?: readonly GuidedGenerationState[];
};

export type GuidedGenerationToolService = {
  readonly enter: (input: Record<string, unknown>) => Promise<SessionToolExecutionResult>;
  readonly answerQuestion: (input: Record<string, unknown>) => Promise<SessionToolExecutionResult>;
  readonly exit: (input: Record<string, unknown>, decision?: ToolConfirmationDecision) => Promise<SessionToolExecutionResult>;
  readonly getState: (stateId: string) => GuidedGenerationState | undefined;
};

const GUIDED_INSTRUCTIONS = `你现在处于引导式生成模式：
1. 先读取上下文。
2. 必要时调用 cockpit/questionnaire/PGI 工具。
3. 输出 GuidedGenerationPlan。
4. 等待用户确认。
5. 确认前不得写入正式正文或经纬。`;

export function createGuidedGenerationToolService(options: GuidedGenerationToolServiceOptions = {}): GuidedGenerationToolService {
  const states = new Map<string, GuidedGenerationState>();
  for (const state of options.initialStates ?? []) {
    states.set(state.id, { ...state });
  }

  const nowIso = () => (options.now?.() ?? new Date()).toISOString();
  const createStateId = () => options.createStateId?.() ?? `guided-state-${crypto.randomUUID()}`;
  const save = (state: GuidedGenerationState) => {
    states.set(state.id, state);
    return state;
  };

  return {
    enter: async (input) => {
      const timestamp = nowIso();
      const state: GuidedGenerationState = save({
        id: optionalString(input.stateId) ?? createStateId(),
        sessionId: stringInput(input.sessionId, "sessionId"),
        bookId: stringInput(input.bookId, "bookId"),
        status: "awaiting-user",
        goal: stringInput(input.goal, "goal"),
        contextSources: contextSourcesInput(input.contextSources),
        questions: questionsInput(input.questions),
        answers: recordInput(input.answers),
        artifacts: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const artifact = stateArtifact(state, "引导式生成状态");
      return {
        ok: true,
        renderer: "guided.questions",
        summary: `已进入引导式生成模式：${state.goal}。`,
        data: {
          status: state.status,
          instructions: GUIDED_INSTRUCTIONS,
          state,
        },
        artifact,
        guided: {
          stateId: state.id,
          status: state.status,
          state,
        },
        metadata: {
          guided: {
            stateId: state.id,
            status: state.status,
            state,
          },
        },
      };
    },
    answerQuestion: async (input) => {
      const state = getExistingState(states, stringInput(input.guidedStateId, "guidedStateId"));
      const directAnswers = recordInput(input.answers);
      const skippedIds = stringArrayInput(input.skippedQuestionIds);
      const answers = {
        ...state.answers,
        ...directAnswers,
        ...Object.fromEntries(skippedIds.map((id) => [id, { skipped: true }])),
      };
      const nextState = save({
        ...state,
        answers,
        status: "awaiting-user",
        updatedAt: nowIso(),
      });
      const answeredCount = Object.keys(directAnswers).length;
      return {
        ok: true,
        renderer: "guided.questions",
        summary: `已更新 ${answeredCount} 条引导式问题回答，跳过 ${skippedIds.length} 条。`,
        data: {
          status: nextState.status,
          state: nextState,
        },
        guided: {
          stateId: nextState.id,
          status: nextState.status,
          state: nextState,
        },
        metadata: {
          guided: {
            stateId: nextState.id,
            status: nextState.status,
            state: nextState,
          },
        },
      };
    },
    exit: async (input, decision) => {
      const state = getExistingState(states, stringInput(input.guidedStateId, "guidedStateId"));
      const plan = planInput(input.plan);
      const rejected = decision?.decision === "rejected";
      const nextStatus = rejected ? "rejected" : "executing";
      const nextState = save({
        ...state,
        status: nextStatus,
        plan,
        artifacts: [...state.artifacts, planArtifact(state, plan)],
        updatedAt: nowIso(),
      });
      const guided = {
        stateId: nextState.id,
        status: nextState.status,
        state: nextState,
        plan,
        ...(decision ? { decision } : {}),
      };
      const artifact = planArtifact(nextState, plan);
      if (rejected) {
        const suffix = decision?.reason ? `：${decision.reason}` : "。";
        return {
          ok: true,
          renderer: "guided.plan",
          summary: `引导式生成计划已拒绝，回到规划状态${suffix}。`,
          data: {
            status: "rejected",
            guidedStateId: nextState.id,
            plan,
            rejectionReason: decision?.reason,
            state: nextState,
          },
          artifact,
          guided,
          metadata: { guided },
        };
      }
      return {
        ok: true,
        renderer: "guided.plan",
        summary: "引导式生成计划已批准，进入执行阶段。",
        data: {
          status: "executing",
          guidedStateId: nextState.id,
          plan,
          state: nextState,
          allowedNextTools: ["questionnaire.submit_response", "candidate.create_chapter", "writing.update_current_focus"],
        },
        artifact,
        guided,
        metadata: { guided },
      };
    },
    getState: (stateId) => states.get(stateId),
  };
}

function getExistingState(states: Map<string, GuidedGenerationState>, stateId: string): GuidedGenerationState {
  const state = states.get(stateId);
  if (!state) {
    throw new Error(`GuidedGenerationState not found: ${stateId}`);
  }
  return state;
}

function stateArtifact(state: GuidedGenerationState, title: string): CanvasArtifact {
  return {
    id: `guided:${state.id}`,
    kind: "guided-plan",
    title,
    renderer: "guided.questions",
    openInCanvas: true,
    metadata: { guidedStateId: state.id, status: state.status },
  };
}

function planArtifact(state: GuidedGenerationState, plan: GuidedGenerationPlan): CanvasArtifact {
  return {
    id: `guided:${state.id}:plan`,
    kind: "guided-plan",
    title: plan.title,
    summary: plan.contextSummary,
    renderer: "guided.plan",
    openInCanvas: true,
    metadata: { guidedStateId: state.id, status: state.status, target: plan.target },
  };
}

function stringInput(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Guided tool input must include a non-empty ${field}.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function recordInput(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return { ...value };
  return {};
}

function contextSourcesInput(value: unknown): GuidedGenerationState["contextSources"] {
  return Array.isArray(value) ? value.filter(isRecord).map((entry, index) => ({
    id: typeof entry.id === "string" ? entry.id : `context-${index + 1}`,
    type: typeof entry.type === "string" ? entry.type : "unknown",
    title: typeof entry.title === "string" ? entry.title : `上下文 ${index + 1}`,
    ...(isRecord(entry.resourceRef) ? { resourceRef: entry.resourceRef as GuidedGenerationState["contextSources"][number]["resourceRef"] } : {}),
    ...(typeof entry.excerpt === "string" ? { excerpt: entry.excerpt } : {}),
    ...(isRecord(entry.metadata) ? { metadata: entry.metadata } : {}),
  })) : [];
}

function questionsInput(value: unknown): GuidedQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.prompt !== "string") return [];
    return [{
      id: entry.id,
      prompt: entry.prompt,
      type: isGuidedQuestionType(entry.type) ? entry.type : "text",
      ...(Array.isArray(entry.options) ? { options: entry.options.filter((item): item is string => typeof item === "string") } : {}),
      reason: typeof entry.reason === "string" ? entry.reason : "Agent 需要澄清生成前判断。",
      required: typeof entry.required === "boolean" ? entry.required : true,
      source: isGuidedQuestionSource(entry.source) ? entry.source : "agent",
      ...(isRecord(entry.mapping) ? { mapping: entry.mapping as GuidedQuestion["mapping"] } : {}),
      ...(typeof entry.aiSuggestion === "string" ? { aiSuggestion: entry.aiSuggestion } : {}),
    } satisfies GuidedQuestion];
  });
}

function planInput(value: unknown): GuidedGenerationPlan {
  if (!isRecord(value)) {
    throw new Error("Guided exit input must include a plan object.");
  }
  return {
    title: typeof value.title === "string" ? value.title : "引导式生成计划",
    goal: typeof value.goal === "string" ? value.goal : "未命名目标",
    target: isGuidedTarget(value.target) ? value.target : "chapter-candidate",
    contextSummary: typeof value.contextSummary === "string" ? value.contextSummary : "暂无上下文摘要。",
    contextSources: contextSourcesInput(value.contextSources),
    authorDecisions: stringArrayInput(value.authorDecisions),
    proposedJingweiMutations: Array.isArray(value.proposedJingweiMutations)
      ? value.proposedJingweiMutations.filter(isRecord).map((entry) => ({
        ...(typeof entry.id === "string" ? { id: entry.id } : {}),
        target: typeof entry.target === "string" ? entry.target : "unknown",
        ...(typeof entry.fieldPath === "string" ? { fieldPath: entry.fieldPath } : {}),
        operation: isMutationOperation(entry.operation) ? entry.operation : "update",
        summary: typeof entry.summary === "string" ? entry.summary : "引导式生成拟写入变更。",
        ...("before" in entry ? { before: entry.before } : {}),
        ...("after" in entry ? { after: entry.after } : {}),
      }))
      : [],
    ...(isRecord(value.proposedCandidate) ? { proposedCandidate: {
      ...(typeof value.proposedCandidate.chapterNumber === "number" ? { chapterNumber: value.proposedCandidate.chapterNumber } : {}),
      ...(typeof value.proposedCandidate.title === "string" ? { title: value.proposedCandidate.title } : {}),
      intent: typeof value.proposedCandidate.intent === "string" ? value.proposedCandidate.intent : "生成候选稿",
      ...(typeof value.proposedCandidate.expectedLength === "number" ? { expectedLength: value.proposedCandidate.expectedLength } : {}),
    } } : {}),
    risks: stringArrayInput(value.risks),
    confirmationItems: stringArrayInput(value.confirmationItems),
  };
}

function stringArrayInput(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isGuidedTarget(value: unknown): value is GuidedGenerationTarget {
  return value === "book-foundation" || value === "chapter-candidate" || value === "jingwei-update" || value === "rewrite" || value === "audit";
}

function isGuidedQuestionType(value: unknown): value is GuidedQuestion["type"] {
  return value === "single" || value === "multi" || value === "text" || value === "ranged-number" || value === "ai-suggest";
}

function isGuidedQuestionSource(value: unknown): value is GuidedQuestion["source"] {
  return value === "questionnaire" || value === "pgi" || value === "agent";
}

function isMutationOperation(value: unknown): value is "create" | "update" | "delete" | "link" {
  return value === "create" || value === "update" || value === "delete" || value === "link";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
