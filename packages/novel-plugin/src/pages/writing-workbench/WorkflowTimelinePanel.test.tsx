import { describe, expect, it } from "vitest";
import { buildWorkflowKickoffMessage } from "./WorkflowTimelinePanel";

describe("WorkflowTimelinePanel 开工提示", () => {
  it("只是一句触发：点明章号与方案，指向 workflow 工具，不复述工序", () => {
    const message = buildWorkflowKickoffMessage("后端反转悬疑流", 4);
    expect(message).toContain("第 4 章");
    expect(message).toContain("后端反转悬疑流");
    expect(message).toContain("workflow_get_current_step");
    expect(message).toContain("workflow_submit_step_output");
    // 工序简报由产品在系统层注入并随工序更新；用户消息里不再塞整份方案。
    expect(message).not.toContain("【创作工作流执行请求】");
    expect(message).not.toContain("推荐工具");
    expect(message.length).toBeLessThan(160);
  });
});
