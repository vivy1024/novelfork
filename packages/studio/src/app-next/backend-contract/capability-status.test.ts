import { describe, expect, it } from "vitest";

import { getCapabilityUiDecision, isCapabilityInteractive } from "./capability-status";

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

  it("maps unsupported and planned to disabled UI with visible explanation", () => {
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
    expect(isCapabilityInteractive("unsupported")).toBe(false);
  });

  it("maps process-memory to enabled UI with recovery note", () => {
    const decision = getCapabilityUiDecision("process-memory");

    expect(decision.enabled).toBe(true);
    expect(decision.recoveryNoteVisible).toBe(true);
    expect(decision.recoveryNote).toContain("进程内存");
  });
});
