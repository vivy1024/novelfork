import { describe, expect, it } from "vitest";

import { getCapabilityUiDecision, isCapabilityInteractive, normalizeCapability } from "./capability-status";

describe("capability status UI decision", () => {
  it("maps current capabilities to enabled interactive UI", () => {
    expect(getCapabilityUiDecision("current")).toMatchObject({
      enabled: true,
      disabled: false,
      readonly: false,
      previewOnly: false,
      errorVisible: true,
      recoveryNoteVisible: false,
    });
    expect(isCapabilityInteractive("current")).toBe(true);
  });

  it("maps prompt-preview to preview-only UI without direct formal write", () => {
    const decision = getCapabilityUiDecision("prompt-preview");

    expect(decision.enabled).toBe(true);
    expect(decision.previewOnly).toBe(true);
    expect(decision.allowsFormalWrite).toBe(false);
    expect(decision.allowedActions).toEqual(["preview", "copy", "convert-to-candidate", "convert-to-draft", "explicit-apply"]);
  });

  it("maps unsupported, planned and deprecated to disabled UI with visible explanation", () => {
    expect(getCapabilityUiDecision("unsupported")).toMatchObject({
      enabled: false,
      disabled: true,
      readonly: true,
      errorVisible: true,
      allowsFetch: false,
      allowsFormalWrite: false,
    });
    expect(getCapabilityUiDecision("planned")).toMatchObject({
      enabled: false,
      disabled: true,
      readonly: true,
      errorVisible: false,
      allowsFetch: false,
    });
    expect(getCapabilityUiDecision("deprecated")).toMatchObject({
      enabled: false,
      disabled: true,
      readonly: true,
      errorVisible: true,
      recoveryNoteVisible: true,
      allowsFetch: false,
      allowsFormalWrite: false,
    });
    expect(isCapabilityInteractive("unsupported")).toBe(false);
    expect(isCapabilityInteractive("deprecated")).toBe(false);
  });

  it("keeps visible disabled reasons for unsupported, planned and deprecated capabilities", () => {
    expect(getCapabilityUiDecision("unsupported")).toMatchObject({
      disabled: true,
      disabledReason: "当前后端或模型适配器不支持该能力。",
      errorVisible: true,
    });
    expect(getCapabilityUiDecision("planned")).toMatchObject({
      disabled: true,
      disabledReason: "该能力仍处于规划状态，当前不可调用。",
      errorVisible: false,
    });
    expect(getCapabilityUiDecision("deprecated")).toMatchObject({
      disabled: true,
      disabledReason: "该能力已标记为 deprecated，新前端不可新增依赖。",
      errorVisible: true,
    });
    expect(normalizeCapability({ id: "future.tool", status: "planned" }).ui.disabledReason).toContain("规划");
    expect(normalizeCapability({ id: "legacy.agent", status: "deprecated" }).ui.recoveryNote).toContain("legacy/deprecated");
  });

  it("maps process-memory to enabled UI with recovery note", () => {
    const decision = getCapabilityUiDecision("process-memory");

    expect(decision.enabled).toBe(true);
    expect(decision.recoveryNoteVisible).toBe(true);
    expect(decision.recoveryNote).toContain("进程内存");
  });
});
