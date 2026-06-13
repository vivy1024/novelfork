import { describe, expect, it } from "vitest";
import type { AgentTurnItem } from "../agent-turn-runtime.js";
import { microCompact } from "./micro-compact.js";

/* ---------- helpers ---------- */

function userMsg(content: string): AgentTurnItem {
  return { type: "message", role: "user", content };
}

function assistantMsg(content: string): AgentTurnItem {
  return { type: "message", role: "assistant", content };
}

function toolCall(id: string, name: string): AgentTurnItem {
  return { type: "tool_call", id, name, input: {} };
}

function toolResult(
  toolCallId: string,
  name: string,
  content: string,
  metadata?: Record<string, unknown>,
): AgentTurnItem {
  return { type: "tool_result", toolCallId, name, content, ...(metadata ? { metadata } : {}) };
}

/* ---------- tests ---------- */
/* 注：默认 keepRecentResults 已从 3 改为 5（写作场景上下文依赖更重），
   折叠格式包含 (N字符) 后缀，摘要长度上限 80。 */

describe("microCompact", () => {
  it("保留最近 5 条工具结果不折叠", () => {
    const msgs: AgentTurnItem[] = [
      toolResult("1", "cockpit.get_snapshot", "snapshot-1"),
      toolResult("2", "narrative.outline", "outline-2"),
      toolResult("3", "guided.step", "step-3"),
      toolResult("4", "candidate.rank", "rank-4"),
      toolResult("5", "pgi.generate_questions", "questions-5"),
      toolResult("6", "narrative.outline", "outline-6"),
    ];

    const result = microCompact(msgs);

    // 第 1 条被折叠
    expect(result[0]!.type).toBe("tool_result");
    expect((result[0] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toMatch(
      /^\[旧工具结果已折叠:/,
    );

    // 后 5 条保留原始内容
    expect((result[1] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toBe("outline-2");
    expect((result[2] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toBe("step-3");
    expect((result[3] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toBe("rank-4");
    expect((result[4] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toBe("questions-5");
    expect((result[5] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toBe("outline-6");
  });

  it("折叠旧的工具结果，内容替换为占位符（含字符数）", () => {
    const msgs: AgentTurnItem[] = [
      toolResult("1", "cockpit.get_snapshot", "这是一段很长的快照内容，包含了大量的上下文信息和状态数据"),
      toolResult("2", "narrative.outline", "大纲内容"),
      toolResult("3", "guided.step", "步骤内容"),
      toolResult("4", "candidate.rank", "排名内容"),
      toolResult("5", "pgi.generate_questions", "问题内容"),
      toolResult("6", "narrative.outline", "大纲内容6"),
    ];

    const result = microCompact(msgs);
    const folded = result[0] as Extract<AgentTurnItem, { type: "tool_result" }>;

    expect(folded.content).toMatch(/^\[旧工具结果已折叠: cockpit\.get_snapshot — /);
    expect(folded.content).toMatch(/\(\d+字符\)\]$/);
    expect(folded.toolCallId).toBe("1");
    expect(folded.name).toBe("cockpit.get_snapshot");
  });

  it("不折叠用户消息和助手消息", () => {
    const msgs: AgentTurnItem[] = [
      userMsg("你好"),
      assistantMsg("你好！"),
      toolResult("1", "cockpit.get_snapshot", "snapshot"),
      toolResult("2", "narrative.outline", "outline"),
      toolResult("3", "guided.step", "step"),
      toolResult("4", "candidate.rank", "rank"),
      toolResult("5", "pgi.generate_questions", "questions"),
      toolResult("6", "narrative.outline", "outline6"),
    ];

    const result = microCompact(msgs);

    expect((result[0] as Extract<AgentTurnItem, { type: "message" }>).content).toBe("你好");
    expect((result[1] as Extract<AgentTurnItem, { type: "message" }>).content).toBe("你好！");
    // 第一条 tool_result 被折叠
    expect((result[2] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toMatch(
      /^\[旧工具结果已折叠:/,
    );
  });

  it("不折叠 tool_call（只折叠 tool_result）", () => {
    const msgs: AgentTurnItem[] = [
      toolCall("1", "cockpit.get_snapshot"),
      toolResult("1", "cockpit.get_snapshot", "snapshot-1"),
      toolCall("2", "narrative.outline"),
      toolResult("2", "narrative.outline", "outline-2"),
      toolCall("3", "guided.step"),
      toolResult("3", "guided.step", "step-3"),
      toolCall("4", "candidate.rank"),
      toolResult("4", "candidate.rank", "rank-4"),
      toolCall("5", "pgi.generate_questions"),
      toolResult("5", "pgi.generate_questions", "questions-5"),
      toolCall("6", "narrative.outline"),
      toolResult("6", "narrative.outline", "outline-6"),
    ];

    const result = microCompact(msgs);

    // 所有 tool_call 保持原样
    for (const item of result) {
      if (item.type === "tool_call") {
        expect(item.input).toEqual({});
      }
    }

    // 第一条 tool_result 被折叠
    expect((result[1] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toMatch(
      /^\[旧工具结果已折叠:/,
    );
    // 最后 5 条 tool_result 保留
    expect((result[3] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toBe("outline-2");
    expect((result[11] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toBe("outline-6");
  });

  it("空消息数组返回空数组", () => {
    expect(microCompact([])).toEqual([]);
  });

  it("少于 keepRecentResults 条时全部保留", () => {
    const msgs: AgentTurnItem[] = [
      toolResult("1", "cockpit.get_snapshot", "snapshot"),
      toolResult("2", "narrative.outline", "outline"),
    ];

    const result = microCompact(msgs);

    expect((result[0] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toBe("snapshot");
    expect((result[1] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toBe("outline");
  });

  it("自定义 keepRecentResults", () => {
    const msgs: AgentTurnItem[] = [
      toolResult("1", "cockpit.get_snapshot", "snapshot-1"),
      toolResult("2", "narrative.outline", "outline-2"),
      toolResult("3", "guided.step", "step-3"),
      toolResult("4", "candidate.rank", "rank-4"),
      toolResult("5", "pgi.generate_questions", "questions-5"),
    ];

    const result = microCompact(msgs, { keepRecentResults: 1 });

    // 前 4 条被折叠
    for (let i = 0; i < 4; i++) {
      expect((result[i] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toMatch(
        /^\[旧工具结果已折叠:/,
      );
    }
    // 最后 1 条保留
    expect((result[4] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toBe("questions-5");
  });

  it("不折叠不在可折叠列表中的工具", () => {
    const msgs: AgentTurnItem[] = [
      toolResult("1", "some.unknown.tool", "other-content"),
      toolResult("2", "cockpit.get_snapshot", "snapshot-1"),
      toolResult("3", "narrative.outline", "outline-2"),
      toolResult("4", "guided.step", "step-3"),
      toolResult("5", "candidate.rank", "rank-4"),
      toolResult("6", "pgi.generate_questions", "questions-5"),
      toolResult("7", "narrative.outline", "outline-7"),
    ];

    const result = microCompact(msgs, { keepRecentResults: 5 });

    // 不可折叠的工具始终保留
    expect((result[0] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toBe("other-content");
    // 可折叠的第一条被折叠（6 条可折叠，保留 5 条）
    expect((result[1] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toMatch(
      /^\[旧工具结果已折叠:/,
    );
  });

  it("不折叠 Agent 工具结果（subagent 结论需完整保留）", () => {
    const msgs: AgentTurnItem[] = [
      toolResult("1", "Agent", "subagent 返回的详细研究结论".repeat(20)),
      toolResult("2", "cockpit.get_snapshot", "snapshot-1"),
      toolResult("3", "narrative.outline", "outline-2"),
      toolResult("4", "guided.step", "step-3"),
      toolResult("5", "candidate.rank", "rank-4"),
      toolResult("6", "pgi.generate_questions", "questions-5"),
    ];

    const result = microCompact(msgs, { keepRecentResults: 5 });

    // Agent 结果即使在最旧位置也不折叠
    expect((result[0] as Extract<AgentTurnItem, { type: "tool_result" }>).content).not.toMatch(
      /^\[旧工具结果已折叠:/,
    );
  });

  it("不修改原消息数组", () => {
    const original: AgentTurnItem[] = [
      toolResult("1", "cockpit.get_snapshot", "snapshot-1"),
      toolResult("2", "narrative.outline", "outline-2"),
      toolResult("3", "guided.step", "step-3"),
      toolResult("4", "candidate.rank", "rank-4"),
      toolResult("5", "pgi.generate_questions", "questions-5"),
      toolResult("6", "narrative.outline", "outline-6"),
    ];
    const originalContent = (original[0] as Extract<AgentTurnItem, { type: "tool_result" }>).content;

    microCompact(original);

    expect((original[0] as Extract<AgentTurnItem, { type: "tool_result" }>).content).toBe(originalContent);
  });

  it("保留 metadata 字段", () => {
    const msgs: AgentTurnItem[] = [
      toolResult("1", "cockpit.get_snapshot", "snapshot-1", { key: "value" }),
      toolResult("2", "narrative.outline", "outline-2"),
      toolResult("3", "guided.step", "step-3"),
      toolResult("4", "candidate.rank", "rank-4"),
      toolResult("5", "pgi.generate_questions", "questions-5"),
      toolResult("6", "narrative.outline", "outline-6"),
    ];

    const result = microCompact(msgs);
    const folded = result[0] as Extract<AgentTurnItem, { type: "tool_result" }>;

    expect(folded.metadata).toEqual({ key: "value" });
  });

  it("超长内容截断为 80 字符加省略号", () => {
    const longContent = "这是一段非常".repeat(40); // 远超 80 字符
    const msgs: AgentTurnItem[] = [
      toolResult("1", "cockpit.get_snapshot", longContent),
      toolResult("2", "narrative.outline", "outline-2"),
      toolResult("3", "guided.step", "step-3"),
      toolResult("4", "candidate.rank", "rank-4"),
      toolResult("5", "pgi.generate_questions", "questions-5"),
      toolResult("6", "narrative.outline", "outline-6"),
    ];

    const result = microCompact(msgs);
    const folded = result[0] as Extract<AgentTurnItem, { type: "tool_result" }>;

    // 占位符中的摘要应该被截断
    expect(folded.content).toContain("...");
    // 整个占位符格式正确（含字符数后缀）
    expect(folded.content).toMatch(/^\[旧工具结果已折叠: cockpit\.get_snapshot — .+\.\.\. \(\d+字符\)\]$/);
  });
});
