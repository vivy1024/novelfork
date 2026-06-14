import { describe, expect, it } from "vitest";

import { AGENT_ROLES, getAgentRole } from "./agent-roles";

describe("agent roles", () => {
  it("defines novelist and default roles", () => {
    const roleKeys = Object.keys(AGENT_ROLES).sort();
    expect(roleKeys).toEqual(["default", "novelist"]);
  });

  it("novelist role uses pipeline.write as the full-chapter path", () => {
    const novelist = AGENT_ROLES.novelist;
    expect(novelist.workflow).toContain("pipeline.write");
    expect(novelist.outputSpec).toContain("candidate.create_chapter");
  });

  it("getAgentRole returns novelist for legacy agent IDs", () => {
    expect(getAgentRole("writer").id).toBe("novelist");
    expect(getAgentRole("planner").id).toBe("novelist");
    expect(getAgentRole("auditor").id).toBe("novelist");
    expect(getAgentRole("architect").id).toBe("novelist");
    expect(getAgentRole("explorer").id).toBe("novelist");
    expect(getAgentRole("hooks").id).toBe("novelist");
    expect(getAgentRole("chapter-hooks").id).toBe("novelist");
    expect(getAgentRole("outline").id).toBe("novelist");
  });

  it("getAgentRole does exact match for novelist", () => {
    expect(getAgentRole("novelist").id).toBe("novelist");
    expect(getAgentRole("default").id).toBe("default");
  });

  it("getAgentRole falls back to novelist for unknown ids", () => {
    expect(getAgentRole("unknown-agent").id).toBe("novelist");
    expect(getAgentRole(undefined).id).toBe("novelist");
    expect(getAgentRole("").id).toBe("novelist");
  });

  it("every role has identity and id fields", () => {
    for (const [key, role] of Object.entries(AGENT_ROLES)) {
      expect(role.id).toBe(key);
      expect(role.identity.length).toBeGreaterThan(10);
    }
  });
});
