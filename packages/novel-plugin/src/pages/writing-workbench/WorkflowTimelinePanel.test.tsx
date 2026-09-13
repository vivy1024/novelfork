import { describe, expect, it } from "vitest";
import { buildWorkflowExecutionMessage } from "./WorkflowTimelinePanel";

const mockBackendRecipes = [
  {
    id: "backend-suspense-flow",
    name: "后端反转悬疑流",
    commandId: "/novel:suspense",
    description: "从后端 story/workflow_recipes.json 加载的真实数据",
    genre: "suspense",
    steps: [
      {
        id: "step-1",
        kind: "context-load" as const,
        label: "拉取悬疑大纲",
        enabled: true,
        executionMode: "tool-only" as const,
        tools: ["cockpit.snapshot", "lore.read"],
      },
      {
        id: "step-2",
        kind: "writer-generate" as const,
        label: "起草高压反转",
        enabled: true,
        executionMode: "subagent" as const,
        agentId: "writer",
        modelOverride: "deepseek-v4-pro",
        tools: ["pipeline.write"],
        customPrompt: "注意伏笔反转",
        requiresApproval: true,
      },
    ],
    resultStrategy: "formal-chapter" as const,
    requireFinalApproval: true,
    maxRetries: 1,
  },
];

describe("WorkflowTimelinePanel (Pure unit test without testing-library)", () => {
  it("buildWorkflowExecutionMessage 完整包含阶段配置、代理、工具与门禁说明", () => {
    const msg = buildWorkflowExecutionMessage(mockBackendRecipes[0], 4);
    expect(msg).toContain("【创作工作流执行请求】");
    expect(msg).toContain("后端反转悬疑流");
    expect(msg).toContain("第 4 章");
    expect(msg).toContain("拉取悬疑大纲");
    expect(msg).toContain("起草高压反转");
    expect(msg).toContain("deepseek-v4-pro");
    expect(msg).toContain("注意伏笔反转");
    expect(msg).toContain("推荐工具(提示要求非强制隔离): pipeline.write");
    expect(msg).toContain("开启人工审核门禁（HITL）");
  });
});
