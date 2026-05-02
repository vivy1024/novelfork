import { describe, expect, it } from "vitest";
import type { GuidedGenerationPlan, SessionToolExecutionInput } from "../../shared/agent-native-workspace.js";
import { createGuidedGenerationToolService } from "./guided-generation-tool-service.js";
import { createSessionToolExecutor } from "./session-tool-executor.js";

function input(overrides: Partial<SessionToolExecutionInput> = {}): SessionToolExecutionInput {
  return {
    sessionId: "session-1",
    toolName: "guided.enter",
    input: { bookId: "book-1", sessionId: "session-1", goal: "写下一章", target: "chapter-candidate" },
    permissionMode: "read",
    ...overrides,
  };
}

function plan(): GuidedGenerationPlan {
  return {
    title: "第二章候选稿计划",
    goal: "写下一章",
    target: "chapter-candidate",
    contextSummary: "已读取驾驶舱、PGI 与上一章摘要。",
    contextSources: [{ id: "cockpit:book-1:snapshot", type: "cockpit", title: "驾驶舱快照" }],
    authorDecisions: ["本章继续推进灵田争夺"],
    proposedJingweiMutations: [{ id: "mutation-1", target: "current_focus", operation: "update", summary: "更新当前焦点" }],
    proposedCandidate: { chapterNumber: 2, title: "第二章", intent: "生成下一章候选稿", expectedLength: 3000 },
    risks: ["伏笔回收过早"],
    confirmationItems: ["确认只创建候选稿，不覆盖正式章节"],
  };
}

describe("guided generation session tools", () => {
  it("enters read-only guided generation with a recoverable awaiting-user state", async () => {
    const executor = createSessionToolExecutor({
      guidedService: createGuidedGenerationToolService({
        now: () => new Date("2026-05-03T05:00:00.000Z"),
        createStateId: () => "guided-state-1",
      }),
    });

    const result = await executor.execute(input());

    expect(result).toMatchObject({
      ok: true,
      renderer: "guided.questions",
      summary: "已进入引导式生成模式：写下一章。",
      data: {
        status: "awaiting-user",
        instructions: expect.stringContaining("确认前不得写入正式正文或经纬"),
        state: {
          id: "guided-state-1",
          sessionId: "session-1",
          bookId: "book-1",
          status: "awaiting-user",
          goal: "写下一章",
          questions: [],
          answers: {},
          artifacts: [],
        },
      },
      guided: {
        stateId: "guided-state-1",
        status: "awaiting-user",
        state: expect.objectContaining({ id: "guided-state-1" }),
      },
      artifact: { id: "guided:guided-state-1", kind: "guided-plan", openInCanvas: true },
    });
  });

  it("answers and skips structured questions in existing guided state", async () => {
    const service = createGuidedGenerationToolService({ now: () => new Date("2026-05-03T05:01:00.000Z"), createStateId: () => "guided-state-1" });
    const executor = createSessionToolExecutor({ guidedService: service });
    await executor.execute(input({ input: {
      bookId: "book-1",
      sessionId: "session-1",
      goal: "写下一章",
      target: "chapter-candidate",
      stateId: "guided-state-1",
      questions: [
        { id: "q-1", prompt: "是否回收伏笔？", type: "single", reason: "PGI 触发", required: true, source: "pgi" },
        { id: "q-2", prompt: "本章情绪基调？", type: "text", reason: "Agent 澄清", required: false, source: "agent" },
      ],
    } }));

    const result = await executor.execute(input({
      toolName: "guided.answer_question",
      input: { bookId: "book-1", sessionId: "session-1", guidedStateId: "guided-state-1", answers: { "q-1": "继续悬置" }, skippedQuestionIds: ["q-2"] },
    }));

    expect(result).toMatchObject({
      ok: true,
      renderer: "guided.questions",
      summary: "已更新 1 条引导式问题回答，跳过 1 条。",
      guided: {
        stateId: "guided-state-1",
        status: "awaiting-user",
        state: expect.objectContaining({
          answers: { "q-1": "继续悬置", "q-2": { skipped: true } },
        }),
      },
    });
  });

  it("submits a guided plan to confirmation gate and executes only after approval", async () => {
    const executor = createSessionToolExecutor({
      guidedService: createGuidedGenerationToolService({ now: () => new Date("2026-05-03T05:02:00.000Z"), createStateId: () => "guided-state-1" }),
      createConfirmationId: () => "confirm-guided-plan-1",
    });
    await executor.execute(input({ input: { bookId: "book-1", sessionId: "session-1", goal: "写下一章", target: "chapter-candidate" } }));

    const pending = await executor.execute(input({
      toolName: "guided.exit",
      permissionMode: "edit",
      input: { bookId: "book-1", sessionId: "session-1", guidedStateId: "guided-state-1", plan: plan() },
    }));
    const approved = await executor.execute(input({
      toolName: "guided.exit",
      permissionMode: "edit",
      confirmationDecision: { confirmationId: "confirm-guided-plan-1", decision: "approved", decidedAt: "2026-05-03T05:03:00.000Z", sessionId: "session-1" },
      input: { bookId: "book-1", sessionId: "session-1", guidedStateId: "guided-state-1", plan: plan() },
    }));

    expect(pending).toMatchObject({
      ok: true,
      renderer: "guided.plan",
      data: { status: "pending-confirmation" },
      confirmation: { id: "confirm-guided-plan-1", toolName: "guided.exit", risk: "confirmed-write" },
    });
    expect(approved).toMatchObject({
      ok: true,
      renderer: "guided.plan",
      summary: "引导式生成计划已批准，进入执行阶段。",
      guided: { stateId: "guided-state-1", status: "executing", plan: expect.objectContaining({ title: "第二章候选稿计划" }) },
      artifact: { id: "guided:guided-state-1:plan", kind: "guided-plan", openInCanvas: true },
      data: {
        status: "executing",
        allowedNextTools: ["questionnaire.submit_response", "candidate.create_chapter", "writing.update_current_focus"],
      },
    });
  });

  it("restores guided state from persisted metadata and records rejection without executing writes", async () => {
    const service = createGuidedGenerationToolService({ now: () => new Date("2026-05-03T05:04:00.000Z"), createStateId: () => "guided-state-1" });
    const executor = createSessionToolExecutor({ guidedService: service });
    const entered = await executor.execute(input());
    const restoredService = createGuidedGenerationToolService({
      now: () => new Date("2026-05-03T05:05:00.000Z"),
      initialStates: [entered.guided!.state!],
    });
    const restoredExecutor = createSessionToolExecutor({ guidedService: restoredService });

    const rejected = await restoredExecutor.execute(input({
      toolName: "guided.exit",
      permissionMode: "edit",
      confirmationDecision: { confirmationId: "confirm-guided-plan-1", decision: "rejected", reason: "先改风险", decidedAt: "2026-05-03T05:05:00.000Z", sessionId: "session-1" },
      input: { bookId: "book-1", sessionId: "session-1", guidedStateId: "guided-state-1", plan: plan() },
    }));

    expect(rejected).toMatchObject({
      ok: true,
      renderer: "guided.plan",
      summary: "引导式生成计划已拒绝，回到规划状态：先改风险。",
      guided: { stateId: "guided-state-1", status: "rejected", plan: expect.objectContaining({ title: "第二章候选稿计划" }) },
      data: { status: "rejected", rejectionReason: "先改风险" },
    });
  });
});
