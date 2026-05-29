import { describe, expect, it } from "vitest";

import { AGENT_SYSTEM_PROMPTS, getAgentSystemPrompt } from "./agent-prompts";

describe("novel agent prompts", () => {
  it("defines all built-in novel prompt roles", () => {
    expect(Object.keys(AGENT_SYSTEM_PROMPTS).sort()).toEqual([
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

  it("uses pipeline.generate_chapter as the writer full-chapter path", () => {
    const prompt = AGENT_SYSTEM_PROMPTS.writer;
    expect(prompt).toContain("pipeline.generate_chapter");
    expect(prompt).toContain("写下一章 / 生成下一章 的主链路是 pipeline.generate_chapter");
    expect(prompt).toContain("candidate.create_chapter 是底层候选稿保存工具");
    expect(prompt).not.toContain("把同一份正文放入 candidate.create_chapter");
  });

  it("matches all visible session agent ids to concrete prompts", () => {
    for (const agentId of ["writer", "planner", "auditor", "architect", "explorer", "hooks", "chapter-hooks", "outline"]) {
      expect(getAgentSystemPrompt(agentId).startsWith(AGENT_SYSTEM_PROMPTS[agentId])).toBe(true);
    }
  });
});
