import { describe, it, expect } from "vitest";
import type { NarratorSessionChatMessage } from "./session-types";
import {
  upgradeMessage,
  downgradeItem,
  extractTextContent,
  extractToolCalls,
  extractReasoningContent,
  hasToolBlocks,
  type ConversationItem,
} from "./conversation-blocks";

describe("conversation-blocks", () => {
  describe("upgradeMessage", () => {
    it("converts a plain text message", () => {
      const message: NarratorSessionChatMessage = {
        id: "msg-1",
        role: "assistant",
        content: "Hello world",
        timestamp: 1000,
        seq: 1,
      };
      const item = upgradeMessage(message);
      expect(item.id).toBe("msg-1");
      expect(item.role).toBe("assistant");
      expect(item.blocks).toHaveLength(1);
      expect(item.blocks[0]).toEqual({ type: "text", content: "Hello world" });
    });

    it("converts a message with reasoning_content", () => {
      const message: NarratorSessionChatMessage = {
        id: "msg-2",
        role: "assistant",
        content: "Final answer",
        reasoning_content: "Let me think...",
        timestamp: 2000,
      };
      const item = upgradeMessage(message);
      expect(item.blocks).toHaveLength(2);
      expect(item.blocks[0]).toEqual({ type: "reasoning", content: "Let me think..." });
      expect(item.blocks[1]).toEqual({ type: "text", content: "Final answer" });
    });

    it("converts a message with tool calls (result)", () => {
      const message: NarratorSessionChatMessage = {
        id: "msg-3",
        role: "assistant",
        content: "Tool result summary",
        timestamp: 3000,
        toolCalls: [{
          id: "tc-1",
          toolName: "Glob",
          status: "success",
          summary: "Found 5 files",
          input: { pattern: "**/*.ts" },
          output: "file1.ts\nfile2.ts",
          duration: 120,
        }],
      };
      const item = upgradeMessage(message);
      // toolCalls present → content not rendered as text block
      expect(item.blocks).toHaveLength(1);
      expect(item.blocks[0]!.type).toBe("tool_result");
      const toolResult = item.blocks[0] as { type: "tool_result"; toolName: string; status: string };
      expect(toolResult.toolName).toBe("Glob");
      expect(toolResult.status).toBe("success");
    });

    it("converts a message with pending tool call", () => {
      const message: NarratorSessionChatMessage = {
        id: "msg-4",
        role: "assistant",
        content: "",
        timestamp: 4000,
        toolCalls: [{
          id: "tc-2",
          toolName: "Read",
          input: { file_path: "/src/index.ts" },
        }],
      };
      const item = upgradeMessage(message);
      expect(item.blocks).toHaveLength(1);
      expect(item.blocks[0]!.type).toBe("tool_use");
    });
  });

  describe("downgradeItem", () => {
    it("round-trips a plain text message", () => {
      const original: NarratorSessionChatMessage = {
        id: "msg-1",
        role: "assistant",
        content: "Hello world",
        timestamp: 1000,
        seq: 1,
      };
      const item = upgradeMessage(original);
      const downgraded = downgradeItem(item);
      expect(downgraded.id).toBe(original.id);
      expect(downgraded.role).toBe(original.role);
      expect(downgraded.content).toBe(original.content);
      expect(downgraded.timestamp).toBe(original.timestamp);
      expect(downgraded.seq).toBe(original.seq);
    });

    it("round-trips a message with reasoning", () => {
      const original: NarratorSessionChatMessage = {
        id: "msg-2",
        role: "assistant",
        content: "Answer",
        reasoning_content: "Thinking...",
        timestamp: 2000,
      };
      const item = upgradeMessage(original);
      const downgraded = downgradeItem(item);
      expect(downgraded.content).toBe("Answer");
      expect(downgraded.reasoning_content).toBe("Thinking...");
    });

    it("round-trips a message with tool result", () => {
      const original: NarratorSessionChatMessage = {
        id: "msg-3",
        role: "assistant",
        content: "summary",
        timestamp: 3000,
        toolCalls: [{
          id: "tc-1",
          toolName: "Glob",
          status: "success",
          summary: "Found files",
          input: { pattern: "*.ts" },
          output: "a.ts",
          duration: 50,
        }],
      };
      const item = upgradeMessage(original);
      const downgraded = downgradeItem(item);
      expect(downgraded.toolCalls).toHaveLength(1);
      expect(downgraded.toolCalls![0]!.toolName).toBe("Glob");
      expect(downgraded.toolCalls![0]!.status).toBe("success");
      expect(downgraded.toolCalls![0]!.input).toEqual({ pattern: "*.ts" });
    });
  });

  describe("extractors", () => {
    it("extractTextContent returns text blocks joined", () => {
      const item: ConversationItem = {
        id: "x",
        role: "assistant",
        blocks: [
          { type: "reasoning", content: "think" },
          { type: "text", content: "Hello" },
          { type: "text", content: "World" },
        ],
        timestamp: 0,
      };
      expect(extractTextContent(item)).toBe("Hello\nWorld");
    });

    it("extractToolCalls returns tool blocks", () => {
      const item: ConversationItem = {
        id: "x",
        role: "assistant",
        blocks: [
          { type: "text", content: "hi" },
          { type: "tool_use", id: "t1", toolName: "Glob", input: {} },
          { type: "tool_result", id: "t2", toolName: "Read", status: "success" },
        ],
        timestamp: 0,
      };
      expect(extractToolCalls(item)).toHaveLength(2);
    });

    it("extractReasoningContent returns reasoning", () => {
      const item: ConversationItem = {
        id: "x",
        role: "assistant",
        blocks: [
          { type: "reasoning", content: "step 1" },
          { type: "thinking", content: "step 2" },
          { type: "text", content: "answer" },
        ],
        timestamp: 0,
      };
      expect(extractReasoningContent(item)).toBe("step 1\nstep 2");
    });

    it("hasToolBlocks detects tool blocks", () => {
      const withTool: ConversationItem = {
        id: "x", role: "assistant", blocks: [{ type: "tool_use", id: "t", toolName: "X", input: {} }], timestamp: 0,
      };
      const withoutTool: ConversationItem = {
        id: "y", role: "assistant", blocks: [{ type: "text", content: "hi" }], timestamp: 0,
      };
      expect(hasToolBlocks(withTool)).toBe(true);
      expect(hasToolBlocks(withoutTool)).toBe(false);
    });
  });
});
