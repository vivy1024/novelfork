import { describe, expect, it } from "vitest";

import {
  TOOL_ACCESS_GOVERNANCE_EXPLANATIONS,
  describeToolAccessReason,
} from "./tool-access-reasons";

describe("tool-access-reasons", () => {
  it("maps reason keys to stable Chinese labels", () => {
    expect(describeToolAccessReason("mcp-strategy-prompt")).toBe("MCP 策略要求确认");
    expect(describeToolAccessReason("blocklist-deny")).toBe("命中阻止列表");
    expect(describeToolAccessReason("unknown", "原始原因")).toBe("原始原因");
  });

  it("exposes governance explanation presets", () => {
    expect(TOOL_ACCESS_GOVERNANCE_EXPLANATIONS).toContain("命中允许列表 → 直接允许");
    expect(TOOL_ACCESS_GOVERNANCE_EXPLANATIONS).toContain("MCP 策略 ask → 需确认");
  });
});
