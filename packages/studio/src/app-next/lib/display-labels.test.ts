import { describe, expect, it } from "vitest";

import {
  internalViewLabel,
  modelTestStatusLabel,
  platformAccountStatusLabel,
  providerApiModeLabel,
  providerCompatibilityLabel,
  runtimePolicySourceLabel,
  workflowStatusLabel,
} from "./display-labels";

describe("display labels", () => {
  it("renders provider and model runtime enums as Chinese user-facing labels", () => {
    expect(providerApiModeLabel("completions")).toBe("聊天补全模式");
    expect(providerApiModeLabel("responses")).toBe("响应接口模式");
    expect(providerApiModeLabel("codex")).toBe("Codex 模式");
    expect(providerCompatibilityLabel("openai-compatible")).toBe("OpenAI 兼容");
    expect(providerCompatibilityLabel("anthropic-compatible")).toBe("Anthropic 兼容");
    expect(modelTestStatusLabel("untested")).toBe("未测试");
    expect(modelTestStatusLabel("unsupported")).toBe("不支持");
  });

  it("renders workflow, platform account and internal view names without leaking raw fields", () => {
    expect(platformAccountStatusLabel("expired")).toBe("已过期");
    expect(workflowStatusLabel("running")).toBe("运行中");
    expect(runtimePolicySourceLabel("runtimeControls.defaultPermissionMode")).toBe("默认权限模式");
    expect(internalViewLabel("BibleCategoryView")).toBe("经纬分类视图");
    expect(internalViewLabel("OutlineEditor")).toBe("大纲编辑器");
    expect(internalViewLabel("PublishReportViewer")).toBe("发布报告");
  });
});
