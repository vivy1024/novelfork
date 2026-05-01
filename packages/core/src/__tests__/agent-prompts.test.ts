import { describe, expect, it } from "vitest";
import { AGENT_SYSTEM_PROMPTS, getAgentSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "../pipeline/agent-prompts.js";

describe("agent-prompts", () => {
  it("defines prompts for all 5 agent roles", () => {
    expect(Object.keys(AGENT_SYSTEM_PROMPTS)).toContain("writer");
    expect(Object.keys(AGENT_SYSTEM_PROMPTS)).toContain("planner");
    expect(Object.keys(AGENT_SYSTEM_PROMPTS)).toContain("auditor");
    expect(Object.keys(AGENT_SYSTEM_PROMPTS)).toContain("architect");
    expect(Object.keys(AGENT_SYSTEM_PROMPTS)).toContain("explorer");
  });

  it("all prompts are non-empty strings", () => {
    for (const [key, prompt] of Object.entries(AGENT_SYSTEM_PROMPTS)) {
      expect(prompt, `${key} prompt should be non-empty`).toBeTruthy();
      expect(typeof prompt, `${key} prompt should be a string`).toBe("string");
    }
  });

  it("writer prompt contains domain knowledge keywords", () => {
    const p = AGENT_SYSTEM_PROMPTS.writer;
    expect(p).toContain("候选区");
    expect(p).toContain("非破坏性");
  });

  it("planner prompt contains planning guidance", () => {
    const p = AGENT_SYSTEM_PROMPTS.planner;
    expect(p).toContain("大纲");
    expect(p).toContain("伏笔");
  });

  it("auditor prompt contains audit keywords", () => {
    const p = AGENT_SYSTEM_PROMPTS.auditor;
    expect(p).toContain("连续性");
    expect(p).toContain("AI 痕迹");
  });

  it("explorer prompt is read-only", () => {
    const p = AGENT_SYSTEM_PROMPTS.explorer;
    expect(p).toContain("只读");
    expect(p).toContain("不能调用");
  });

  it("returns default prompt for empty agentId", () => {
    expect(getAgentSystemPrompt()).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(getAgentSystemPrompt("")).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("matches agentId by prefix", () => {
    expect(getAgentSystemPrompt("writer")).toBe(AGENT_SYSTEM_PROMPTS.writer);
    expect(getAgentSystemPrompt("planner-v2")).toBe(AGENT_SYSTEM_PROMPTS.planner);
    expect(getAgentSystemPrompt("explorer-session-1")).toBe(AGENT_SYSTEM_PROMPTS.explorer);
  });

  it("falls back to default for unknown agentId", () => {
    expect(getAgentSystemPrompt("unknown-agent")).toBe(DEFAULT_SYSTEM_PROMPT);
  });
});
