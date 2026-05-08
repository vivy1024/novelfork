import { describe, expect, it } from "vitest";

import {
  createCommandEnabledRegistry,
  type CommandEnabledRegistry,
} from "./command-enabled-registry";

describe("command enabled registry", () => {
  it("allows execution of enabled commands", () => {
    const registry = createCommandEnabledRegistry({ disabled: [] });

    expect(registry.isEnabled("/help")).toBe(true);
    expect(registry.isEnabled("/compact")).toBe(true);
    expect(registry.isEnabled("/novel:write-next")).toBe(true);
  });

  it("blocks execution of disabled commands", () => {
    const registry = createCommandEnabledRegistry({ disabled: ["/compact", "/novel:write-next"] });

    expect(registry.isEnabled("/help")).toBe(true);
    expect(registry.isEnabled("/compact")).toBe(false);
    expect(registry.isEnabled("/novel:write-next")).toBe(false);
  });

  it("returns disabled reason for blocked commands", () => {
    const registry = createCommandEnabledRegistry({ disabled: ["/compact"] });

    const result = registry.checkExecution("/compact");
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("command_disabled");
    expect(result.message).toContain("/compact");
  });

  it("allows re-enabling commands at runtime", () => {
    const registry = createCommandEnabledRegistry({ disabled: ["/compact"] });

    expect(registry.isEnabled("/compact")).toBe(false);
    registry.enable("/compact");
    expect(registry.isEnabled("/compact")).toBe(true);
  });

  it("allows disabling commands at runtime", () => {
    const registry = createCommandEnabledRegistry({ disabled: [] });

    expect(registry.isEnabled("/compact")).toBe(true);
    registry.disable("/compact");
    expect(registry.isEnabled("/compact")).toBe(false);
  });
});
