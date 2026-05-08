import { describe, expect, it, vi } from "vitest";

import { runSubagent, type SubagentConfig, type SubagentResult } from "./subagent-runtime";

describe("subagent runtime", () => {
  it("executes a subagent with independent system prompt and model", async () => {
    const generate = vi.fn().mockResolvedValue({
      success: true,
      type: "message",
      content: "子代理完成任务。",
      metadata: { modelId: "sub-model", providerId: "sub-provider" },
    });

    const config: SubagentConfig = {
      id: "writer-agent",
      name: "Writer",
      systemPrompt: "你是一个小说写作代理。",
      modelId: "claude-sonnet-4",
      providerId: "anthropic",
      tools: ["chapter.read", "candidate.create_chapter"],
      maxSteps: 3,
    };

    const result = await runSubagent({
      config,
      prompt: "写第三章候选稿",
      generate,
    });

    expect(result.ok).toBe(true);
    expect(result.content).toBe("子代理完成任务。");
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: "你是一个小说写作代理。",
      modelId: "claude-sonnet-4",
      providerId: "anthropic",
    }));
  });

  it("executes tools within the subagent loop", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        type: "tool_use",
        toolUses: [{ id: "tool-1", name: "chapter.read", input: { chapterId: "ch-3" } }],
        metadata: { modelId: "m", providerId: "p" },
      })
      .mockResolvedValueOnce({
        success: true,
        type: "message",
        content: "已读取第三章。",
        metadata: { modelId: "m", providerId: "p" },
      });

    const executeTool = vi.fn().mockResolvedValue({ ok: true, summary: "章节内容已读取。", data: { content: "第三章正文" } });

    const config: SubagentConfig = {
      id: "reader-agent",
      name: "Reader",
      systemPrompt: "读取章节。",
      modelId: "m",
      providerId: "p",
      tools: ["chapter.read"],
      maxSteps: 5,
    };

    const result = await runSubagent({ config, prompt: "读取第三章", generate, executeTool });

    expect(result.ok).toBe(true);
    expect(result.content).toBe("已读取第三章。");
    expect(executeTool).toHaveBeenCalledWith("chapter.read", { chapterId: "ch-3" });
    expect(result.toolResults).toHaveLength(1);
  });

  it("stops at maxSteps and returns partial result", async () => {
    const generate = vi.fn().mockResolvedValue({
      success: true,
      type: "tool_use",
      toolUses: [{ id: "tool-loop", name: "chapter.read", input: {} }],
      metadata: { modelId: "m", providerId: "p" },
    });
    const executeTool = vi.fn().mockResolvedValue({ ok: true, summary: "读取。" });

    const config: SubagentConfig = { id: "loop-agent", name: "Loop", systemPrompt: "", modelId: "m", providerId: "p", tools: ["chapter.read"], maxSteps: 2 };

    const result = await runSubagent({ config, prompt: "loop", generate, executeTool });

    expect(result.ok).toBe(false);
    expect(result.stopReason).toBe("max_steps");
    expect(executeTool).toHaveBeenCalledTimes(2);
  });
});
