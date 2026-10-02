import { describe, expect, test } from "vitest";

import {
  FANQIE_XUANHUAN_SERIAL_RECIPE,
  ZHIHU_SHORT_STORY_RECIPE,
} from "./novel-workflows.js";
import { buildWorkflowRunBrief } from "./run-brief.js";
import { createRunState, transition } from "./run-state-machine.js";
import { linearRecipeToGraph } from "./workflow-graph.js";
import { planWorkflowTeam, WORKFLOW_WORKER_TITLE_PREFIX } from "./workflow-team.js";

describe("planWorkflowTeam", () => {
  test("番茄连载配方：writer 与 continuity-audit 各一个工人，承接对应工序", () => {
    const plan = planWorkflowTeam(FANQIE_XUANHUAN_SERIAL_RECIPE);
    const recipe = FANQIE_XUANHUAN_SERIAL_RECIPE;
    expect(plan.recipeId).toBe(recipe.id);
    const byRole = Object.fromEntries(plan.members.map((m) => [m.roleKey, m]));
    // writer 角色承接规划与写作两道 subagent 工序
    expect(byRole.writer?.stepIds.length).toBeGreaterThanOrEqual(1);
    expect(byRole["novel-continuity-auditor"]?.stepIds.length).toBeGreaterThanOrEqual(1);
    for (const member of plan.members) {
      expect(member.title.startsWith(WORKFLOW_WORKER_TITLE_PREFIX)).toBe(true);
    }
  });

  test("非委派工序不产生工人；无委派配方返回空名单", () => {
    const plan = planWorkflowTeam(ZHIHU_SHORT_STORY_RECIPE);
    // 盐选配方有 subagent 工序（writer / novel-text-auditor）
    expect(plan.members.length).toBeGreaterThanOrEqual(1);
    // 没有任何 stepIds 为空的工人
    for (const member of plan.members) {
      expect(member.stepIds.length).toBeGreaterThan(0);
    }
  });

  test("同一角色多道工序复用一个工人；并行配置展开为多工人", () => {
    const recipe = linearRecipeToGraph({
      ...FANQIE_XUANHUAN_SERIAL_RECIPE,
      steps: [
        {
          id: "s1",
          kind: "writer-generate",
          label: "写作",
          enabled: true,
          executionMode: "subagent",
          agentId: "writer",
        },
        {
          id: "s2",
          kind: "writer-generate",
          label: "写作二",
          enabled: true,
          executionMode: "subagent",
          agentId: "writer",
        },
        {
          id: "s3",
          kind: "writer-generate",
          label: "多写手",
          enabled: true,
          executionMode: "subagent",
          agentId: "writer",
          parallelSubagents: [
            { name: "对白", model: "m1" },
            { name: "打斗" },
          ],
        },
        {
          id: "s4",
          kind: "context-load",
          label: "读资料",
          enabled: true,
          executionMode: "autonomous",
        },
      ],
    });
    const plan = planWorkflowTeam(recipe);
    const byRole = Object.fromEntries(plan.members.map((m) => [m.roleKey, m]));
    // s1+s2 同角 writer 合并
    expect(byRole.writer?.stepIds).toEqual(["s1", "s2"]);
    // s3 并行展开为两个工人，不再单列 writer·s3
    expect(byRole["writer/对白"]?.stepIds).toEqual(["s3"]);
    expect(byRole["writer/对白"]?.model).toBe("m1");
    expect(byRole["writer/打斗"]?.stepIds).toEqual(["s3"]);
    expect(byRole["writer/对白"]?.title).toBe(`${WORKFLOW_WORKER_TITLE_PREFIX}writer·对白`);
    // autonomous 工序不进名单
    expect(plan.members.every((m) => !m.stepIds.includes("s4"))).toBe(true);
    // agentId 缺省回退 writer
    const fallback = linearRecipeToGraph({
      ...FANQIE_XUANHUAN_SERIAL_RECIPE,
      steps: [
        {
          id: "s9",
          kind: "writer-generate",
          label: "无角色写作",
          enabled: true,
          executionMode: "subagent",
        },
      ],
    });
    const fallbackPlan = planWorkflowTeam(fallback);
    expect(fallbackPlan.members.map((m) => m.roleKey)).toEqual(["writer"]);
  });
});

describe("委派工序简报", () => {
  test("含团队编排协议与 task 回退指引", () => {
    const recipe = FANQIE_XUANHUAN_SERIAL_RECIPE;
    const created = createRunState(recipe);
    if (!created.ok) throw new Error(created.explanation.what);
    let state = created.state;
    for (const stepId of ["step-context", "step-blueprint"]) {
      const advanced = transition(recipe, state, { type: "submit", stepId });
      if (!advanced.ok) throw new Error(`${stepId}: ${advanced.explanation.what}`);
      state = advanced.state;
    }
    const brief = buildWorkflowRunBrief({
      id: "team-run",
      bookId: "team-book",
      chapterNumber: 1,
      narratorId: "leader",
      recipeId: recipe.id,
      recipe,
      state,
      createdAt: 0,
      updatedAt: 0,
    });
    expect(brief).not.toBeNull();
    // 团队协议：插件线名前缀、收编→派发→回收三步、工人标题前缀
    expect(brief).toContain("plugin__com_whisent_narrator-team__");
    expect(brief).toContain("team_setup");
    expect(brief).toContain("team_dispatch");
    expect(brief).toContain(WORKFLOW_WORKER_TITLE_PREFIX);
    // 无团队工具时的 legacy 回退
    expect(brief).toContain("task(subagent_type=writer)");
    // 权威写入不旁路：工人不得直写
    expect(brief).toContain("工人不得直写权威源");
  });
});
