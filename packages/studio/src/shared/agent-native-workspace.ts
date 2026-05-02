import type { SessionConfig, SessionPermissionMode } from "./session-types.js";

export type { SessionConfig, SessionPermissionMode } from "./session-types.js";

export const SESSION_TOOL_RISKS = ["read", "draft-write", "confirmed-write", "destructive"] as const;
export type SessionToolRisk = (typeof SESSION_TOOL_RISKS)[number];
export type SessionToolRiskDecision = "allow" | "confirm" | "deny";

export type JsonObjectSchema = {
  readonly type: "object";
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
};

export type SessionToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObjectSchema;
  readonly risk: SessionToolRisk;
  readonly renderer: string;
  readonly enabledForModes: readonly SessionPermissionMode[];
};

export type WorkspaceResourceViewKind =
  | "chapter-editor"
  | "candidate-editor"
  | "draft-editor"
  | "outline-editor"
  | "bible-category-view"
  | "bible-entry-editor"
  | "markdown-viewer"
  | "material-viewer"
  | "publish-report-viewer"
  | "unsupported"
  | "guided-plan"
  | "tool-result"
  | "narrative-line";

export type WorkspaceArtifactKind =
  | "book"
  | "chapter"
  | "candidate"
  | "draft"
  | "outline"
  | "jingwei"
  | "story-file"
  | "truth-file"
  | "material"
  | "publish-report"
  | "guided-plan"
  | "tool-result"
  | "narrative-line";

export type WorkspaceResourceRef = {
  readonly kind: WorkspaceArtifactKind | string;
  readonly id: string;
  readonly bookId?: string;
  readonly title?: string;
  readonly path?: string;
};

export type CanvasArtifact = {
  readonly id: string;
  readonly kind: WorkspaceArtifactKind | string;
  readonly title: string;
  readonly summary?: string;
  readonly resourceRef?: WorkspaceResourceRef;
  readonly payloadRef?: string;
  readonly renderer?: string;
  readonly openInCanvas?: boolean;
  readonly createdAt?: string;
  readonly metadata?: Record<string, unknown>;
};

export type OpenResourceTab = {
  readonly id: string;
  readonly nodeId: string;
  readonly kind: WorkspaceResourceViewKind;
  readonly title: string;
  readonly dirty: boolean;
  readonly source: "user" | "agent";
  readonly payloadRef?: string;
  readonly artifact?: CanvasArtifact;
};

export type CanvasSelection = {
  readonly text?: string;
  readonly start?: number;
  readonly end?: number;
};

export type CanvasContext = {
  readonly activeTabId?: string;
  readonly activeResource?: WorkspaceResourceRef;
  readonly selection?: CanvasSelection;
  readonly dirty?: boolean;
  readonly openTabs?: readonly OpenResourceTab[];
};

export type ToolConfirmationRisk = Extract<SessionToolRisk, "confirmed-write" | "destructive">;
export type ToolConfirmationOption = "approve" | "reject" | "open-in-canvas";

export type ToolConfirmationRequest = {
  readonly id: string;
  readonly toolName: string;
  readonly target: string;
  readonly risk: ToolConfirmationRisk;
  readonly summary: string;
  readonly diff?: unknown;
  readonly options: readonly ToolConfirmationOption[];
  readonly targetResource?: WorkspaceResourceRef;
  readonly sessionId?: string;
  readonly createdAt?: string;
};

export type ToolConfirmationDecision = {
  readonly confirmationId: string;
  readonly decision: "approved" | "rejected";
  readonly reason?: string;
  readonly decidedAt: string;
  readonly sessionId: string;
};

export type GuidedGenerationStatus =
  | "planning"
  | "awaiting-user"
  | "approved"
  | "rejected"
  | "executing"
  | "completed";

export type GuidedGenerationTarget = "book-foundation" | "chapter-candidate" | "jingwei-update" | "rewrite" | "audit";
export type GuidedQuestionType = "single" | "multi" | "text" | "ranged-number" | "ai-suggest";
export type GuidedQuestionSource = "questionnaire" | "pgi" | "agent";

export type GuidedContextSource = {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly resourceRef?: WorkspaceResourceRef;
  readonly excerpt?: string;
  readonly metadata?: Record<string, unknown>;
};

export type GuidedQuestionMapping = {
  readonly target: "jingwei" | "writer-context" | "candidate-metadata";
  readonly fieldPath?: string;
};

export type GuidedQuestion = {
  readonly id: string;
  readonly prompt: string;
  readonly type: GuidedQuestionType;
  readonly options?: readonly string[];
  readonly reason: string;
  readonly required: boolean;
  readonly source: GuidedQuestionSource;
  readonly mapping?: GuidedQuestionMapping;
  readonly aiSuggestion?: string;
};

export type JingweiMutationPreview = {
  readonly id?: string;
  readonly target: string;
  readonly fieldPath?: string;
  readonly operation: "create" | "update" | "delete" | "link";
  readonly summary: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly risk?: SessionToolRisk;
};

export type GuidedGenerationPlan = {
  readonly title: string;
  readonly goal: string;
  readonly target: GuidedGenerationTarget;
  readonly contextSummary: string;
  readonly contextSources: readonly GuidedContextSource[];
  readonly authorDecisions: readonly string[];
  readonly proposedJingweiMutations: readonly JingweiMutationPreview[];
  readonly proposedCandidate?: {
    readonly chapterNumber?: number;
    readonly title?: string;
    readonly intent: string;
    readonly expectedLength?: number;
  };
  readonly risks: readonly string[];
  readonly confirmationItems: readonly string[];
};

export type GuidedGenerationState = {
  readonly id: string;
  readonly sessionId: string;
  readonly bookId: string;
  readonly status: GuidedGenerationStatus;
  readonly goal: string;
  readonly contextSources: readonly GuidedContextSource[];
  readonly questions: readonly GuidedQuestion[];
  readonly answers: Record<string, unknown>;
  readonly plan?: GuidedGenerationPlan;
  readonly artifacts: readonly CanvasArtifact[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type PgiQuestionMetadata = {
  readonly id: string;
  readonly prompt: string;
  readonly reason: string;
  readonly required?: boolean;
  readonly heuristicsTriggered?: readonly string[];
};

export type PgiMetadata =
  | {
      readonly used: true;
      readonly questions: readonly PgiQuestionMetadata[];
      readonly answers: Record<string, unknown> | readonly unknown[];
      readonly heuristicsTriggered: readonly string[];
    }
  | {
      readonly used: false;
      readonly skippedReason: "user-skipped" | "no-questions" | "unsupported";
      readonly questions?: readonly PgiQuestionMetadata[];
      readonly heuristicsTriggered?: readonly string[];
    };

export type NarrativeNodeType = "chapter" | "event" | "conflict" | "foreshadow" | "payoff" | "character-arc" | "setting";
export type NarrativeEdgeType = "causes" | "reveals" | "escalates" | "resolves" | "foreshadows" | "pays-off" | "contradicts" | "supports";
export type NarrativeEdgeConfidence = "explicit" | "inferred" | "agent-proposed";

export type NarrativeLine = {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly summary?: string;
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly updatedAt?: string;
};

export type NarrativeNode = {
  readonly id: string;
  readonly bookId: string;
  readonly type: NarrativeNodeType;
  readonly title: string;
  readonly summary?: string;
  readonly sourceRef?: WorkspaceResourceRef;
  readonly chapterNumber?: number;
  readonly status?: string;
};

export type NarrativeEdge = {
  readonly id: string;
  readonly bookId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly type: NarrativeEdgeType;
  readonly label?: string;
  readonly confidence: NarrativeEdgeConfidence;
};

export type StoryBeat = {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly summary?: string;
  readonly chapterNumber?: number;
  readonly nodeIds: readonly string[];
};

export type ConflictThread = {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly status: "open" | "escalating" | "paused" | "resolved";
  readonly nodeIds: readonly string[];
  readonly nextExpectedChapter?: number;
};

export type ForeshadowThread = {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly status: "open" | "due" | "paid-off" | "abandoned";
  readonly setupNodeIds: readonly string[];
  readonly dueChapter?: number;
};

export type PayoffLink = {
  readonly id: string;
  readonly bookId: string;
  readonly foreshadowThreadId: string;
  readonly payoffNodeId: string;
  readonly summary?: string;
};

export type NarrativeWarning = {
  readonly id?: string;
  readonly type: "open-foreshadow" | "stalled-conflict" | "missing-payoff" | "chapter-drift" | "mainline-risk" | string;
  readonly severity: "info" | "warning" | "critical";
  readonly summary: string;
  readonly nodeIds?: readonly string[];
};

export type NarrativeLineSnapshot = {
  readonly bookId: string;
  readonly lines?: readonly NarrativeLine[];
  readonly nodes: readonly NarrativeNode[];
  readonly edges: readonly NarrativeEdge[];
  readonly beats?: readonly StoryBeat[];
  readonly conflictThreads?: readonly ConflictThread[];
  readonly foreshadowThreads?: readonly ForeshadowThread[];
  readonly payoffLinks?: readonly PayoffLink[];
  readonly warnings: readonly NarrativeWarning[];
  readonly generatedAt?: string;
};

export type NarrativeLineMutationPreview = {
  readonly id: string;
  readonly bookId: string;
  readonly summary: string;
  readonly nodes?: readonly NarrativeNode[];
  readonly edges?: readonly NarrativeEdge[];
  readonly warnings?: readonly NarrativeWarning[];
};

export type GuidedToolMetadata = {
  readonly stateId?: string;
  readonly status?: GuidedGenerationStatus;
  readonly state?: GuidedGenerationState;
  readonly plan?: GuidedGenerationPlan;
  readonly decision?: ToolConfirmationDecision;
};

export type NarrativeToolMetadata = {
  readonly snapshot?: NarrativeLineSnapshot;
  readonly mutationPreview?: NarrativeLineMutationPreview;
};

export type AgentNativeToolMetadata = {
  readonly renderer?: string;
  readonly artifact?: CanvasArtifact;
  readonly confirmation?: ToolConfirmationRequest;
  readonly guided?: GuidedToolMetadata;
  readonly pgi?: PgiMetadata;
  readonly narrative?: NarrativeToolMetadata;
};

export type SessionToolExecutionInput = {
  readonly sessionId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly permissionMode: SessionPermissionMode;
  readonly sessionConfig?: SessionConfig;
  readonly canvasContext?: CanvasContext;
  readonly confirmationDecision?: ToolConfirmationDecision;
};

export type SessionToolExecutionResult = AgentNativeToolMetadata & {
  readonly ok: boolean;
  readonly summary: string;
  readonly data?: unknown;
  readonly error?: string;
  readonly durationMs?: number;
  readonly metadata?: AgentNativeToolMetadata;
};

export type AgentNativeMessageMetadata = AgentNativeToolMetadata & {
  readonly toolResult?: SessionToolExecutionResult;
  readonly canvasContext?: CanvasContext;
};

export function normalizeSessionToolRisk(value: unknown): SessionToolRisk {
  if (typeof value === "string" && (SESSION_TOOL_RISKS as readonly string[]).includes(value)) {
    return value as SessionToolRisk;
  }

  return "destructive";
}

export function getSessionToolRiskDecision(
  permissionMode: SessionPermissionMode,
  riskInput: unknown,
): SessionToolRiskDecision {
  const risk = normalizeSessionToolRisk(riskInput);

  if (risk === "read") {
    return "allow";
  }

  if (permissionMode === "read" || permissionMode === "plan") {
    return "deny";
  }

  if (risk === "draft-write") {
    return permissionMode === "edit" || permissionMode === "allow" ? "allow" : "confirm";
  }

  return "confirm";
}
