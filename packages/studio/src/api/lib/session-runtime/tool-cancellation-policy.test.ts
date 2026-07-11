import { describe, expect, it } from "vitest";

import {
  assertToolCancellationDeclarations,
  capabilityFor,
  timeoutMsFor,
} from "./tool-cancellation-policy.js";

describe("tool cancellation policy", () => {
  it("maps the key tool matrix to the intended capability", () => {
    expect(capabilityFor("Bash")).toBe("process-killable");
    expect(capabilityFor("Read")).toBe("cooperative");
    expect(capabilityFor("Grep")).toBe("cooperative");
    expect(capabilityFor("Glob")).toBe("cooperative");
    expect(capabilityFor("WebFetch")).toBe("cooperative");
    expect(capabilityFor("WebSearch")).toBe("cooperative");
    expect(capabilityFor("Await")).toBe("cooperative");
    expect(capabilityFor("Write")).toBe("non-cancellable");
    expect(capabilityFor("Edit")).toBe("non-cancellable");
    expect(capabilityFor("pipeline.write")).toBe("non-cancellable");
    expect(capabilityFor("hooks.manage", { action: "write" })).toBe("non-cancellable");
    expect(capabilityFor("hooks.manage", { action: "list" })).toBe("cooperative");
    expect(capabilityFor("hooks.manage", { action: "check_due" })).toBe("cooperative");
    expect(capabilityFor("hooks.manage", { action: "unknown" })).toBe("non-cancellable");
  });

  it("defaults unknown tools and unsafe actions to non-cancellable", () => {
    expect(capabilityFor("future.tool")).toBe("non-cancellable");
    expect(capabilityFor("future.tool", { action: "read" })).toBe("non-cancellable");
    expect(capabilityFor("Read", { action: "overwrite" })).toBe("non-cancellable");
    expect(capabilityFor("Write", { action: "list" })).toBe("non-cancellable");
  });

  it("returns deadlines without making non-cancellable work falsely stoppable", () => {
    expect(timeoutMsFor("Bash", { timeoutMs: 10_000 })).toBe(10_000);
    expect(timeoutMsFor("Await", { timeout: 9_000 })).toBe(9_000);
    expect(timeoutMsFor("Read")).toBe(120_000);
    expect(timeoutMsFor("hooks.manage", { action: "list" })).toBe(120_000);
    expect(timeoutMsFor("hooks.manage", { action: "write" })).toBe(120_000);
    expect(timeoutMsFor("Write")).toBe(120_000);
    expect(timeoutMsFor("future.tool", { timeoutMs: 10_000 })).toBe(120_000);
  });

  it("keeps action-sensitive hook defaults safe for unknown actions", () => {
    expect(timeoutMsFor("hooks.manage", { action: "unknown" })).toBe(120_000);
    expect(timeoutMsFor("future.tool")).toBe(120_000);
  });

  it("rejects newly registered tools that have not declared a cancellation capability", () => {
    expect(() => assertToolCancellationDeclarations([{ name: "future.tool" }])).toThrow(
      "工具取消能力未声明：future.tool",
    );
    expect(() => assertToolCancellationDeclarations([{ name: "Read" }, { name: "mcp__demo__call" }])).not.toThrow();
  });
});
