import { describe, expect, it } from "vitest";

import {
  CODEX_RUNTIME_CAPABILITY_STATUS_VALUES,
  getCodexRuntimeCapabilityStatuses,
  normalizeCodexSandboxMode,
} from "./codex-runtime-status";

describe("Codex runtime capability status model", () => {
  it("uses the approved current/partial/planned/reference-only/unsupported vocabulary", () => {
    expect(CODEX_RUNTIME_CAPABILITY_STATUS_VALUES).toEqual(["current", "partial", "planned", "reference-only", "unsupported"]);
  });

  it("keeps executable approval partial while sandbox/review/image stay out of current claims", () => {
    const statuses = getCodexRuntimeCapabilityStatuses();

    expect(statuses.find((status) => status.id === "codex.approvalPolicy")).toMatchObject({
      status: "partial",
      value: "permissionMode/toolPolicy",
      currentBehavior: expect.stringContaining("pending confirmation"),
    });
    expect(statuses.find((status) => status.id === "codex.sandboxMode")).toMatchObject({
      status: "planned",
      value: "planned",
      unsupportedReason: expect.stringContaining("OS sandbox"),
    });
    expect(statuses.find((status) => status.id === "codex.review")).toMatchObject({ status: "reference-only" });
    expect(statuses.find((status) => status.id === "codex.imageInput")).toMatchObject({ status: "reference-only" });
    expect(statuses.every((status) => !(status.id !== "codex.approvalPolicy" && status.status === "current"))).toBe(true);
  });

  it("downgrades unsupported Codex sandbox requests to planned instead of enabling them", () => {
    expect(normalizeCodexSandboxMode("danger-full-access")).toEqual({
      mode: "planned",
      status: "planned",
      reason: expect.stringContaining("not implemented"),
    });
  });
});
