import { SESSION_TOOL_RISKS } from "../../shared/agent-native-workspace.js";
import type {
  JsonObjectSchema,
  SessionToolDefinition,
  SessionToolRisk,
} from "../../shared/agent-native-workspace.js";
import type { SessionPermissionMode } from "../../shared/session-types.js";

export { SESSION_TOOL_RISKS };
export type { JsonObjectSchema, SessionToolDefinition, SessionToolRisk };

export type ProviderSessionToolDefinition = {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: JsonObjectSchema;
  };
};

const ALL_SESSION_PERMISSION_MODES = ["ask", "edit", "allow", "read", "plan"] as const;
const WRITE_SESSION_PERMISSION_MODES = ["ask", "edit", "allow"] as const;

function objectSchema(
  properties: Record<string, unknown> = {},
  required: readonly string[] = [],
): JsonObjectSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function stringSchema(description: string): Record<string, unknown> {
  return { type: "string", description };
}

function numberSchema(description: string): Record<string, unknown> {
  return { type: "number", description };
}

function booleanSchema(description: string): Record<string, unknown> {
  return { type: "boolean", description };
}

function arraySchema(description: string, items: Record<string, unknown> = { type: "object" }): Record<string, unknown> {
  return { type: "array", description, items };
}

function sessionTool(
  definition: SessionToolDefinition,
): SessionToolDefinition {
  return definition;
}

export const SESSION_TOOL_DEFINITIONS = [
  sessionTool({
    name: "cockpit.get_snapshot",
    description: "读取当前书籍的驾驶舱快照，包括进度、当前焦点、风险、伏笔、候选稿与模型状态。",
    inputSchema: objectSchema({
      bookId: stringSchema("要读取快照的书籍 ID。"),
      includeModelStatus: booleanSchema("是否包含当前模型配置与工具支持状态。"),
    }, ["bookId"]),
    risk: "read",
    renderer: "cockpit.snapshot",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "cockpit.list_open_hooks",
    description: "列出当前书籍仍待推进或回收的伏笔与开放 hook。",
    inputSchema: objectSchema({
      bookId: stringSchema("要读取伏笔的书籍 ID。"),
      limit: numberSchema("最多返回的伏笔数量。"),
    }, ["bookId"]),
    risk: "read",
    renderer: "cockpit.openHooks",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "cockpit.list_recent_candidates",
    description: "列出当前书籍最近生成的候选稿与可在画布打开的 artifact 引用。",
    inputSchema: objectSchema({
      bookId: stringSchema("要读取候选稿的书籍 ID。"),
      limit: numberSchema("最多返回的候选稿数量。"),
    }, ["bookId"]),
    risk: "read",
    renderer: "cockpit.recentCandidates",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "questionnaire.list_templates",
    description: "列出可用于建立书籍前提、世界模型、人物弧光或主要矛盾的问卷模板。",
    inputSchema: objectSchema({
      bookId: stringSchema("当前书籍 ID，用于筛选适用模板。"),
      purpose: stringSchema("本次问卷的目标或创作阶段。"),
    }),
    risk: "read",
    renderer: "questionnaire.templates",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "questionnaire.start",
    description: "根据模板启动结构化问卷流程，返回待展示的问题卡，不写入正式经纬。",
    inputSchema: objectSchema({
      bookId: stringSchema("当前书籍 ID。"),
      templateId: stringSchema("要启动的问卷模板 ID。"),
      goal: stringSchema("本次问卷要服务的创作目标。"),
    }, ["bookId", "templateId"]),
    risk: "read",
    renderer: "questionnaire.questions",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "questionnaire.suggest_answer",
    description: "基于真实 provider/model 上下文为问卷问题生成建议答案；模型不可用时应返回 unsupported。",
    inputSchema: objectSchema({
      bookId: stringSchema("当前书籍 ID。"),
      templateId: stringSchema("问卷模板 ID。"),
      questionId: stringSchema("需要建议答案的问题 ID。"),
      providerId: stringSchema("用于生成建议的 provider ID。"),
      modelId: stringSchema("用于生成建议的 model ID。"),
      existingAnswers: { type: "object", description: "当前已填写的问卷答案。" },
      context: stringSchema("用户已提供的上下文或现有答案摘要。"),
    }, ["bookId", "templateId", "questionId"]),
    risk: "read",
    renderer: "questionnaire.suggestion",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "questionnaire.submit_response",
    description: "提交问卷回答并准备写入 Bible/Jingwei 的事务化 mapping；正式写入必须经过确认。",
    inputSchema: objectSchema({
      bookId: stringSchema("当前书籍 ID。"),
      templateId: stringSchema("问卷模板 ID。"),
      responseId: stringSchema("问卷回答 ID。"),
      answers: { type: "object", description: "结构化问卷答案。" },
    }, ["bookId", "templateId", "answers"]),
    risk: "confirmed-write",
    renderer: "jingwei.mutationPreview",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "pgi.generate_questions",
    description: "根据当前章节意图、伏笔、冲突与章节上下文生成 2-5 个生成前追问。",
    inputSchema: objectSchema({
      bookId: stringSchema("当前书籍 ID。"),
      chapterNumber: numberSchema("目标章节序号。"),
      chapterIntent: stringSchema("本章写作意图或用户请求。"),
      maxQuestions: numberSchema("最多生成的问题数量。"),
    }, ["bookId"]),
    risk: "read",
    renderer: "pgi.questions",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "pgi.record_answers",
    description: "记录 PGI 问题回答或跳过原因，用作后续候选稿 metadata 与写作上下文。",
    inputSchema: objectSchema({
      bookId: stringSchema("当前书籍 ID。"),
      sessionId: stringSchema("当前会话 ID。"),
      questions: arraySchema("PGI 问题及触发原因列表。"),
      answers: arraySchema("PGI 问题回答列表。"),
      heuristicsTriggered: arraySchema("本轮触发的 PGI 启发式。"),
      skippedReason: stringSchema("跳过 PGI 时的原因。"),
    }, ["bookId", "sessionId"]),
    risk: "draft-write",
    renderer: "pgi.answers",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "pgi.format_answers_for_prompt",
    description: "将 PGI 问题与答案整理成 writer 可直接使用的本章作者指示。",
    inputSchema: objectSchema({
      bookId: stringSchema("当前书籍 ID。"),
      answers: arraySchema("PGI 问题回答列表。"),
      skippedReason: stringSchema("跳过 PGI 时的原因。"),
    }, ["bookId"]),
    risk: "read",
    renderer: "pgi.promptInstructions",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "guided.enter",
    description: "进入引导式生成模式，只创建计划状态与问题流，不执行正式资源写入。",
    inputSchema: objectSchema({
      bookId: stringSchema("当前书籍 ID。"),
      sessionId: stringSchema("当前会话 ID。"),
      goal: stringSchema("引导式生成目标。"),
      target: stringSchema("计划目标类型，例如 chapter-candidate、jingwei-update 或 audit。"),
      stateId: stringSchema("可选的引导式生成状态 ID，用于恢复测试或外部状态接入。"),
      questions: arraySchema("初始结构化问题列表。"),
      contextSources: arraySchema("已读取的上下文来源。"),
      answers: { type: "object", description: "已有引导式问题回答。" },
    }, ["bookId", "sessionId", "goal"]),
    risk: "read",
    renderer: "guided.questions",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "guided.answer_question",
    description: "回答、跳过或编辑引导式生成中的结构化问题，并写回 GuidedGenerationState。",
    inputSchema: objectSchema({
      bookId: stringSchema("当前书籍 ID。"),
      sessionId: stringSchema("当前会话 ID。"),
      guidedStateId: stringSchema("引导式生成状态 ID。"),
      answers: { type: "object", description: "按问题 ID 记录的回答。" },
      skippedQuestionIds: arraySchema("被用户跳过的问题 ID。"),
    }, ["bookId", "sessionId", "guidedStateId"]),
    risk: "read",
    renderer: "guided.questions",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "guided.exit",
    description: "提交 GuidedGenerationPlan 到确认门；用户批准前不执行写入或候选稿生成。",
    inputSchema: objectSchema({
      bookId: stringSchema("当前书籍 ID。"),
      sessionId: stringSchema("当前会话 ID。"),
      guidedStateId: stringSchema("引导式生成状态 ID。"),
      plan: { type: "object", description: "可供用户审查的 GuidedGenerationPlan。" },
    }, ["bookId", "sessionId", "guidedStateId", "plan"]),
    risk: "confirmed-write",
    renderer: "guided.plan",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "candidate.create_chapter",
    description: "根据章节意图、PGI 指示和引导式计划生成下一章候选稿，不覆盖正式章节正文。",
    inputSchema: objectSchema({
      bookId: stringSchema("当前书籍 ID。"),
      chapterIntent: stringSchema("候选章节写作意图。"),
      chapterNumber: numberSchema("目标章节序号。"),
      title: stringSchema("候选章节标题。"),
      pgiInstructions: stringSchema("由 PGI 格式化得到的本章作者指示。"),
      guidedPlanId: stringSchema("关联的 GuidedGenerationPlan ID。"),
    }, ["bookId", "chapterIntent"]),
    risk: "draft-write",
    renderer: "candidate.created",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "narrative.read_line",
    description: "读取当前书籍的叙事线只读快照，包括节点、边与可计算 warnings。",
    inputSchema: objectSchema({
      bookId: stringSchema("当前书籍 ID。"),
      includeWarnings: booleanSchema("是否包含叙事线 warnings。"),
    }, ["bookId"]),
    risk: "read",
    renderer: "narrative.line",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
  }),
  sessionTool({
    name: "narrative.propose_change",
    description: "生成叙事线变更草案和差异预览，不直接写入正式叙事线。",
    inputSchema: objectSchema({
      bookId: stringSchema("当前书籍 ID。"),
      summary: stringSchema("叙事线变更摘要。"),
      nodes: arraySchema("拟新增或修改的叙事节点。"),
      edges: arraySchema("拟新增或修改的叙事边。"),
      reason: stringSchema("提出该变更的原因。"),
    }, ["bookId", "summary"]),
    risk: "draft-write",
    renderer: "narrative.mutationPreview",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  }),
] as const;

export const SESSION_TOOL_NAMES = SESSION_TOOL_DEFINITIONS.map((tool) => tool.name);

function cloneDefinition(definition: SessionToolDefinition): SessionToolDefinition {
  return {
    ...definition,
    inputSchema: JSON.parse(JSON.stringify(definition.inputSchema)) as JsonObjectSchema,
    enabledForModes: [...definition.enabledForModes],
  };
}

export function getAllSessionToolDefinitions(): SessionToolDefinition[] {
  return SESSION_TOOL_DEFINITIONS.map(cloneDefinition);
}

export function getSessionToolDefinition(name: string): SessionToolDefinition | undefined {
  const definition = SESSION_TOOL_DEFINITIONS.find((tool) => tool.name === name);
  return definition ? cloneDefinition(definition) : undefined;
}

export function isSessionToolEnabledForMode(
  toolName: string,
  permissionMode: SessionPermissionMode,
): boolean {
  const definition = SESSION_TOOL_DEFINITIONS.find((tool) => tool.name === toolName);
  return definition?.enabledForModes.includes(permissionMode) ?? false;
}

export function getEnabledSessionTools(permissionMode: SessionPermissionMode): SessionToolDefinition[] {
  return SESSION_TOOL_DEFINITIONS
    .filter((tool) => tool.enabledForModes.includes(permissionMode))
    .map(cloneDefinition);
}

export function getProviderSessionToolDefinitions(
  permissionMode: SessionPermissionMode,
): ProviderSessionToolDefinition[] {
  return getEnabledSessionTools(permissionMode).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}
