import { describe, expect, it } from "vitest";

import { AGENT_ROLES, getAgentRole } from "./agent-roles";

describe("agent roles", () => {
  it("defines all built-in novel agent roles", () => {
    const roleKeys = Object.keys(AGENT_ROLES).filter(k => k !== "default").sort();
    expect(roleKeys).toEqual([
      "architect",
      "auditor",
      "chapter-hooks",
      "explorer",
      "hooks",
      "outline",
      "planner",
      "writer",
    ]);
  });

  it("writer role uses pipeline.generate_chapter as the full-chapter path", () => {
    const writer = AGENT_ROLES.writer;
    expect(writer.workflow).toContain("pipeline.generate_chapter");
    expect(writer.workflow).toContain("写下一章 / 生成下一章 的主链路是 pipeline.generate_chapter");
    expect(writer.outputSpec).toContain("candidate.create_chapter 是底层候选稿保存工具");
  });

  it("getAgentRole does exact match", () => {
    expect(getAgentRole("writer").id).toBe("writer");
    expect(getAgentRole("planner").id).toBe("planner");
    expect(getAgentRole("chapter-hooks").id).toBe("chapter-hooks");
  });

  it("getAgentRole does substring match (longest key wins)", () => {
    expect(getAgentRole("my-writer-agent").id).toBe("writer");
    expect(getAgentRole("novel-planner-v2").id).toBe("planner");
  });

  it("getAgentRole falls back to default for unknown ids", () => {
    expect(getAgentRole("unknown-agent").id).toBe("default");
    expect(getAgentRole(undefined).id).toBe("default");
    expect(getAgentRole("").id).toBe("default");
  });

  it("every role has identity and id fields", () => {
    for (const [key, role] of Object.entries(AGENT_ROLES)) {
      expect(role.id).toBe(key);
      expect(role.identity.length).toBeGreaterThan(10);
    }
  });
});
