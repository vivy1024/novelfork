import { describe, expect, it } from "vitest";
import type {
  CanvasArtifact,
  CanvasContext,
  GuidedGenerationPlan,
  GuidedGenerationState,
  GuidedQuestion,
  NarrativeLineSnapshot,
  OpenResourceTab,
  SessionToolExecutionResult,
  ToolConfirmationRequest,
} from "./agent-native-workspace";
import type { NarratorSessionChatMessage, ToolCall } from "./session-types";

const canvasArtifactContract = {
  id: "artifact-candidate-1",
  kind: "candidate",
  title: "第二章候选稿",
  summary: "Agent 生成的下一章候选稿。",
  resourceRef: {
    kind: "candidate",
    id: "candidate-1",
    bookId: "book-1",
  },
  renderer: "candidate.created",
  openInCanvas: true,
} satisfies CanvasArtifact;

const openResourceTabContract = {
  id: "tab-candidate-1",
  nodeId: "candidate:candidate-1",
  kind: "candidate-editor",
  title: "第二章候选稿",
  dirty: false,
  source: "agent",
  payloadRef: "candidate-1",
} satisfies OpenResourceTab;

const canvasContextContract = {
  activeTabId: openResourceTabContract.id,
  activeResource: {
    kind: "candidate",
    id: "candidate-1",
    bookId: "book-1",
  },
  selection: {
    text: "这里需要承接上一章冲突。",
    start: 0,
    end: 12,
  },
  dirty: false,
  openTabs: [openResourceTabContract],
} satisfies CanvasContext;

const confirmationContract = {
  id: "confirm-guided-exit-1",
  toolName: "guided.exit",
  target: "第二章候选稿生成计划",
  risk: "confirmed-write",
  summary: "批准后创建候选稿，不覆盖正式章节。",
  options: ["approve", "reject", "open-in-canvas"],
  targetResource: {
    kind: "guided-plan",
    id: "guided-plan-1",
    bookId: "book-1",
  },
} satisfies ToolConfirmationRequest;

const guidedQuestionContract = {
  id: "question-1",
  prompt: "本章是否要立即回收上一章伏笔？",
  type: "single",
  options: ["立即回收", "继续悬置"],
  reason: "上一章留下了即将触发的伏笔。",
  required: true,
  source: "pgi",
  mapping: {
    target: "writer-context",
    fieldPath: "chapter.hookPayoffDecision",
  },
} satisfies GuidedQuestion;

const guidedPlanContract = {
  title: "第二章候选稿计划",
  goal: "写下一章",
  target: "chapter-candidate",
  contextSummary: "读取上一章摘要、当前焦点与待回收伏笔后形成计划。",
  contextSources: [
    {
      id: "chapter-1",
      type: "chapter",
      title: "第一章",
      resourceRef: {
        kind: "chapter",
        id: "chapter-1",
        bookId: "book-1",
      },
    },
  ],
  authorDecisions: ["本章先升级矛盾，不直接解决主线危机。"],
  proposedJingweiMutations: [],
  proposedCandidate: {
    chapterNumber: 2,
    title: "风雨将至",
    intent: "承接第一章结尾冲突并引出更大危机。",
    expectedLength: 3000,
  },
  risks: ["若直接回收伏笔，主线悬念会过早消失。"],
  confirmationItems: ["确认生成候选稿而非覆盖正式正文。"],
} satisfies GuidedGenerationPlan;

const guidedStateContract = {
  id: "guided-state-1",
  sessionId: "session-1",
  bookId: "book-1",
  status: "awaiting-user",
  goal: "写下一章",
  contextSources: guidedPlanContract.contextSources,
  questions: [guidedQuestionContract],
  answers: {
    "question-1": "继续悬置",
  },
  plan: guidedPlanContract,
  artifacts: [canvasArtifactContract],
  createdAt: "2026-05-02T00:00:00.000Z",
  updatedAt: "2026-05-02T00:01:00.000Z",
} satisfies GuidedGenerationState;

const narrativeSnapshotContract = {
  bookId: "book-1",
  nodes: [
    {
      id: "node-chapter-1",
      bookId: "book-1",
      type: "chapter",
      title: "第一章",
      sourceRef: {
        kind: "chapter",
        id: "chapter-1",
        bookId: "book-1",
      },
      chapterNumber: 1,
    },
  ],
  edges: [
    {
      id: "edge-foreshadow-1",
      bookId: "book-1",
      fromNodeId: "node-chapter-1",
      toNodeId: "node-hook-1",
      type: "foreshadows",
      confidence: "agent-proposed",
    },
  ],
  warnings: [
    {
      id: "warning-open-hook-1",
      type: "open-foreshadow",
      severity: "warning",
      summary: "第一章伏笔尚未进入回收窗口。",
      nodeIds: ["node-chapter-1"],
    },
  ],
} satisfies NarrativeLineSnapshot;

const sessionToolExecutionResultContract = {
  ok: true,
  renderer: "guided.plan",
  summary: "已生成待确认的引导式生成计划。",
  data: {
    guidedStateId: guidedStateContract.id,
  },
  artifact: canvasArtifactContract,
  confirmation: confirmationContract,
  metadata: {
    guided: {
      stateId: guidedStateContract.id,
      status: guidedStateContract.status,
      plan: guidedPlanContract,
    },
    pgi: {
      used: false,
      skippedReason: "no-questions",
    },
    narrative: {
      snapshot: narrativeSnapshotContract,
    },
  },
} satisfies SessionToolExecutionResult;

const toolCallContract = {
  id: "tool-guided-exit-1",
  toolName: "guided.exit",
  status: "success",
  summary: "引导式计划等待确认。",
  renderer: "guided.plan",
  result: sessionToolExecutionResultContract,
  artifact: canvasArtifactContract,
  confirmation: confirmationContract,
  guided: {
    stateId: guidedStateContract.id,
    status: guidedStateContract.status,
    plan: guidedPlanContract,
  },
  pgi: {
    used: false,
    skippedReason: "no-questions",
  },
  narrative: {
    snapshot: narrativeSnapshotContract,
  },
} satisfies ToolCall;

const chatMessageContract = {
  id: "message-1",
  role: "assistant",
  content: "计划已生成，等待确认。",
  timestamp: 1,
  toolCalls: [toolCallContract],
  metadata: {
    renderer: "guided.plan",
    artifact: canvasArtifactContract,
    confirmation: confirmationContract,
    guided: {
      state: guidedStateContract,
    },
    pgi: {
      used: false,
      skippedReason: "no-questions",
    },
    narrative: {
      snapshot: narrativeSnapshotContract,
    },
    toolResult: sessionToolExecutionResultContract,
  },
} satisfies NarratorSessionChatMessage;

async function loadContracts() {
  try {
    return await import("./agent-native-workspace");
  } catch (error) {
    expect.fail(error instanceof Error ? error.message : String(error));
  }
}

describe("agent-native workspace shared contracts", () => {
  it("declares the canonical session tool risk levels", async () => {
    const contracts = await loadContracts();

    expect(contracts.SESSION_TOOL_RISKS).toEqual(["read", "draft-write", "confirmed-write", "destructive"]);
  });

  it("maps session permission modes to risk decisions without allowing destructive writes silently", async () => {
    const contracts = await loadContracts();

    expect(contracts.getSessionToolRiskDecision("read", "read")).toBe("allow");
    expect(contracts.getSessionToolRiskDecision("read", "draft-write")).toBe("deny");
    expect(contracts.getSessionToolRiskDecision("plan", "confirmed-write")).toBe("deny");
    expect(contracts.getSessionToolRiskDecision("ask", "draft-write")).toBe("confirm");
    expect(contracts.getSessionToolRiskDecision("edit", "draft-write")).toBe("allow");
    expect(contracts.getSessionToolRiskDecision("edit", "confirmed-write")).toBe("confirm");
    expect(contracts.getSessionToolRiskDecision("allow", "confirmed-write")).toBe("confirm");
    expect(contracts.getSessionToolRiskDecision("allow", "destructive")).toBe("confirm");
  });

  it("normalizes unknown or unsafe risk values to destructive", async () => {
    const contracts = await loadContracts();

    expect(contracts.normalizeSessionToolRisk("draft-write")).toBe("draft-write");
    expect(contracts.normalizeSessionToolRisk("unknown-risk")).toBe("destructive");
    expect(contracts.getSessionToolRiskDecision("edit", "unknown-risk")).toBe("confirm");
  });

  it("describes canvas artifacts, guided plans, narrative snapshots and tool-result metadata", () => {
    expect(canvasContextContract.openTabs?.[0]?.title).toBe("第二章候选稿");
    expect(sessionToolExecutionResultContract).toMatchObject({
      ok: true,
      renderer: "guided.plan",
      summary: "已生成待确认的引导式生成计划。",
    });
    expect(toolCallContract.confirmation?.risk).toBe("confirmed-write");
    expect(chatMessageContract.metadata?.guided?.state?.id).toBe("guided-state-1");
    expect(narrativeSnapshotContract.nodes[0]?.type).toBe("chapter");
  });
});
