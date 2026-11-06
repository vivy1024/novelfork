/**
 * 写-审-改回路（P1）：正文不经作者确认不能成为可落盘版本；审校不通过沿打回线自动返修，
 * 至多 MAX_AUDIT_AUTO_RETURNS 轮，用完后交作者决定并带警告。
 */
import { describe, expect, it } from "vitest";

import {
  FANQIE_XUANHUAN_SERIAL_RECIPE,
  NOVEL_BUILTIN_WORKFLOWS,
  type NovelWorkflowRecipe,
} from "./novel-workflows";
import {
  createRunState,
  MAX_AUDIT_AUTO_RETURNS,
  transition,
  type WorkflowRunAction,
  type WorkflowRunState,
} from "./run-state-machine";
import { checkWorkflowGraph, linearRecipeToGraph } from "./workflow-graph";
import { buildWorkflowRunBrief } from "./run-brief";

const failNote = { what: "审校未通过", why: "冲突没有升级", action: "按意见修改" };

function run(recipe: NovelWorkflowRecipe) {
  const created = createRunState(recipe);
  if (!created.ok) throw new Error(created.explanation.what);
  let state: WorkflowRunState = created.state;
  const events: string[] = [];
  return {
    get state() {
      return state;
    },
    events,
    status: (stepId: string) => state.steps.find((step) => step.stepId === stepId)!.status,
    step: (stepId: string) => state.steps.find((step) => step.stepId === stepId)!,
    apply(action: WorkflowRunAction) {
      const result = transition(recipe, state, action);
      if (!result.ok) throw new Error(`${result.code}: ${result.explanation.what}`);
      state = result.state;
      events.push(...result.events.map((event) => event.type));
    },
  };
}

function advanceToDraft(r: ReturnType<typeof run>) {
  r.apply({ type: "submit", stepId: "step-context" });
  r.apply({ type: "submit", stepId: "step-blueprint" });
  expect(r.status("step-draft")).toBe("running");
}

describe("内置方案：写-审-改打回线", () => {
  it("三个内置方案都从审校连回写正文的工序，且结构合法", () => {
    for (const recipe of NOVEL_BUILTIN_WORKFLOWS) {
      const reject = recipe.edges.filter((edge) => edge.kind === "reject");
      expect(reject, recipe.id).toHaveLength(1);
      expect(reject[0]!.target, recipe.id).toBe("step-draft");
      expect(checkWorkflowGraph(recipe), recipe.id).toEqual([]);
    }
  });
});

describe("审校不通过的自动打回", () => {
  it("不通过 → 打回写正文（带意见）→ 至多 2 轮 → 第 3 次不通过转作者确认并带警告", () => {
    const r = run(FANQIE_XUANHUAN_SERIAL_RECIPE);
    advanceToDraft(r);
    for (let round = 1; round <= MAX_AUDIT_AUTO_RETURNS; round++) {
      r.apply({ type: "submit", stepId: "step-draft" });
      expect(r.status("step-adversarial-audit")).toBe("running");
      r.apply({ type: "submit", stepId: "step-adversarial-audit", audit: { passed: false, note: failNote } });
      // 回到写正文，审校重置，意见进入写正文的简报
      expect(r.status("step-draft")).toBe("running");
      expect(r.step("step-draft").note).toEqual(failNote);
      expect(r.status("step-adversarial-audit")).toBe("pending");
      expect(r.step("step-adversarial-audit").autoReturns).toBe(round);
      // 落盘工序始终没有开始：确认之前不会提交到权威源
      expect(r.status("step-settlement")).toBe("pending");
    }
    r.apply({ type: "submit", stepId: "step-draft" });
    r.apply({ type: "submit", stepId: "step-adversarial-audit", audit: { passed: false, note: failNote } });
    expect(r.state.status).toBe("awaiting_approval");
    expect(r.status("step-adversarial-audit")).toBe("awaiting_approval");
    expect(r.step("step-adversarial-audit").note?.what).toContain(`自动打回 ${MAX_AUDIT_AUTO_RETURNS} 轮`);
    expect(r.status("step-settlement")).toBe("pending");
    expect(r.events.filter((type) => type === "step_auto_returned")).toHaveLength(MAX_AUDIT_AUTO_RETURNS);
    // 作者放行后才进入落盘
    r.apply({ type: "approve", stepId: "step-adversarial-audit" });
    expect(r.status("step-settlement")).toBe("running");
  });

  it("审校通过：不打回，等作者确认", () => {
    const r = run(FANQIE_XUANHUAN_SERIAL_RECIPE);
    advanceToDraft(r);
    r.apply({ type: "submit", stepId: "step-draft" });
    r.apply({ type: "submit", stepId: "step-adversarial-audit", audit: { passed: true, note: failNote } });
    expect(r.status("step-adversarial-audit")).toBe("awaiting_approval");
    expect(r.step("step-adversarial-audit").note).toBeUndefined();
  });

  it("没有打回线的审校不通过：直接交作者并说明没法自动返修", () => {
    const recipe = linearRecipeToGraph({
      id: "no-reject",
      name: "无打回线",
      commandId: "/novel:no-reject",
      description: "",
      steps: [
        { id: "draft", kind: "writer-generate", label: "写正文", enabled: true },
        { id: "audit", kind: "audit", label: "审校", enabled: true, requiresApproval: true },
      ],
      resultStrategy: "formal-chapter",
      requireFinalApproval: false,
      maxRetries: 0,
    });
    const r = run(recipe);
    r.apply({ type: "submit", stepId: "draft" });
    r.apply({ type: "submit", stepId: "audit", audit: { passed: false, note: failNote } });
    expect(r.status("audit")).toBe("awaiting_approval");
    expect(r.step("audit").note?.why).toContain("没有为这道审校配置打回线");
  });
});

describe("领导者简报", () => {
  it("写正文工序首选委派 nf-writer，落盘工序按引用落盘不贴正文", () => {
    const r = run(FANQIE_XUANHUAN_SERIAL_RECIPE);
    advanceToDraft(r);
    const record = (state: WorkflowRunState) => ({
      id: "run-1", bookId: "book-1", chapterNumber: 1, narratorId: "leader", recipeId: FANQIE_XUANHUAN_SERIAL_RECIPE.id,
      recipe: FANQIE_XUANHUAN_SERIAL_RECIPE, state, createdAt: 0, updatedAt: 0,
    });
    const draftBrief = buildWorkflowRunBrief(record(r.state))!;
    expect(draftBrief).toContain('Agent(subagent_type="nf-writer")');
    expect(draftBrief).toContain("候选 id");
    r.apply({ type: "submit", stepId: "step-draft" });
    r.apply({ type: "submit", stepId: "step-adversarial-audit", audit: { passed: true, note: failNote } });
    r.apply({ type: "approve", stepId: "step-adversarial-audit" });
    const settleBrief = buildWorkflowRunBrief(record(r.state))!;
    expect(settleBrief).toContain("fromWorkflowRun=true");
  });
});

describe("正文必须经作者确认", () => {
  it("写正文之后没有需要确认的审校 / 门禁时，写正文这一步自己要求确认", () => {
    const recipe = linearRecipeToGraph({
      id: "draft-only",
      name: "只写不审",
      commandId: "/novel:draft-only",
      description: "",
      steps: [
        { id: "draft", kind: "writer-generate", label: "写正文", enabled: true },
        { id: "save", kind: "post-settlement", label: "落盘", enabled: true, tools: ["pipeline.write"] },
      ],
      resultStrategy: "formal-chapter",
      requireFinalApproval: false,
      maxRetries: 0,
    });
    const r = run(recipe);
    expect(r.step("draft").requiresApproval).toBe(true);
    r.apply({ type: "submit", stepId: "draft" });
    expect(r.status("draft")).toBe("awaiting_approval");
    expect(r.status("save")).toBe("pending");
  });

  it("下游有需要确认的审校时，写正文本身不再多一道确认（在审校处一并确认）", () => {
    const r = run(FANQIE_XUANHUAN_SERIAL_RECIPE);
    expect(r.step("step-draft").requiresApproval).toBe(false);
    expect(r.step("step-adversarial-audit").requiresApproval).toBe(true);
  });
});
