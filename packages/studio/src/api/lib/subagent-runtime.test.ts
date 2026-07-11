import { describe, expect, it, vi } from "vitest";

import { runSubagent, runSubagentStream, type SubagentConfig, type SubagentGenerateResult, type SubagentResult } from "./subagent-runtime";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function waitForAssertion(assertion: () => void, options: { timeout?: number } = {}): Promise<void> {
  const timeout = options.timeout ?? 1_000;
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeout) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  throw lastError ?? new Error(`Assertion did not pass within ${timeout}ms`);
}

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
      tools: ["chapter.read", "pipeline.write"],
      maxSteps: 3,
    };

    const result = await runSubagent({
      config,
      prompt: "写第三章章节结果",
      generate,
    });

    expect(result.ok).toBe(true);
    expect(result.content).toBe("子代理完成任务。");
    expect(result.transcript.length).toBeGreaterThan(0);
    expect(result.transcript[0]).toMatchObject({ type: "generate", agentId: "writer-agent" });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: "你是一个小说写作代理。",
      modelId: "claude-sonnet-4",
      providerId: "anthropic",
    }));
  });

  it("executes tools within the subagent loop and records transcript", async () => {
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
    // Verify sidechain transcript
    expect(result.transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "generate", agentId: "reader-agent" }),
      expect.objectContaining({ type: "tool_call", agentId: "reader-agent", toolName: "chapter.read" }),
      expect.objectContaining({ type: "tool_result", agentId: "reader-agent", toolName: "chapter.read" }),
      expect.objectContaining({ type: "generate", agentId: "reader-agent" }),
      expect.objectContaining({ type: "message", agentId: "reader-agent" }),
    ]));
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

  it("respects abort signal (对标 Claude abortController)", async () => {
    const controller = new AbortController();
    const generate = vi.fn().mockImplementation(async () => {
      controller.abort(); // Abort after first generate
      return { success: true, type: "tool_use", toolUses: [{ id: "t1", name: "Read", input: {} }] };
    });

    const config: SubagentConfig = { id: "abort-agent", name: "Abort", systemPrompt: "", modelId: "m", providerId: "p", tools: ["Read"], maxSteps: 10 };

    const result = await runSubagent({ config, prompt: "test", generate, signal: controller.signal });

    expect(result.ok).toBe(false);
    expect(result.stopReason).toBe("aborted");
  });

  it("Task7: subagent generate should receive the parent abort signal and stay blocked behind the pending promise", async () => {
    const controller = new AbortController();
    const pendingGenerate = deferred<SubagentGenerateResult>();
    let generateSignal: AbortSignal | undefined;

    const generate = vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
      generateSignal = signal;
      return pendingGenerate.promise;
    });

    const config: SubagentConfig = {
      id: "task7-subagent-abort",
      name: "Abort",
      systemPrompt: "你是一个子代理。",
      modelId: "m",
      providerId: "p",
      tools: [],
      maxSteps: 3,
    };

    const resultPromise = runSubagent({
      config,
      prompt: "等待子代理生成",
      generate,
      signal: controller.signal,
    });

    await waitForAssertion(() => expect(generate).toHaveBeenCalledTimes(1));
    controller.abort();
    pendingGenerate.resolve({
      success: true,
      type: "message",
      content: "晚到的完成",
      metadata: { modelId: "m", providerId: "p" },
    });

    const result = await resultPromise;

    expect(generateSignal).toBe(controller.signal);
    expect(result).toMatchObject({ ok: false, stopReason: "aborted" });
  });

  it("streams events via AsyncGenerator (对标 Claude runAgent generator)", async () => {
    const generate = vi.fn().mockResolvedValue({
      success: true,
      type: "message",
      content: "done",
    });

    const config: SubagentConfig = { id: "stream-agent", name: "Stream", systemPrompt: "", modelId: "m", providerId: "p", tools: [], maxSteps: 3 };
    const events = [];

    const generator = runSubagentStream({ config, prompt: "hi", generate });
    let result: IteratorResult<unknown, SubagentResult>;
    do {
      result = await generator.next();
      if (!result.done) events.push(result.value);
    } while (!result.done);

    expect(events).toHaveLength(2); // generate + message
    expect(events[0]).toMatchObject({ type: "generate" });
    expect(events[1]).toMatchObject({ type: "message", content: "done" });
    expect(result.value.ok).toBe(true);
  });
});
