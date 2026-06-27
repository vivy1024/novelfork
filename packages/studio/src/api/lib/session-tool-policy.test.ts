import { describe, expect, it } from "vitest";

import type { CanvasContext, SessionToolDefinition } from "../../shared/agent-native-workspace";
import { filterSessionToolsForProvider, resolveSessionToolPolicy } from "./session-tool-policy";

const readTool: SessionToolDefinition = {
  name: "cockpit.get_snapshot",
  description: "读取快照",
  inputSchema: { type: "object", additionalProperties: false },
  risk: "read",
  renderer: "cockpit.snapshot",
  enabledForModes: ["ask", "edit", "allow", "read", "plan"],
  visibility: "author",
};

const draftWriteTool: SessionToolDefinition = {
  name: "pipeline.revise",
  description: "修订章节",
  inputSchema: { type: "object", additionalProperties: false },
  risk: "draft-write",
  renderer: "pipeline.chapter",
  enabledForModes: ["ask", "edit", "allow"],
  visibility: "author",
};

const confirmedWriteTool: SessionToolDefinition = {
  name: "guided.exit",
  description: "提交计划",
  inputSchema: { type: "object", additionalProperties: false },
  risk: "confirmed-write",
  renderer: "guided.plan",
  enabledForModes: ["ask", "edit", "allow"],
  visibility: "author",
};

const dirtyCanvas: CanvasContext = {
  activeTabId: "chapter:book-1:2",
  activeResource: { kind: "chapter", id: "chapter:book-1:2", bookId: "book-1" },
  dirty: true,
};

describe("session tool policy resolver", () => {
  it("returns one resolution shape for policy deny, policy ask, permission mode, dirty guard and checkpoint requirements", () => {
    expect(resolveSessionToolPolicy({
      toolName: draftWriteTool.name,
      risk: draftWriteTool.risk,
      permissionMode: "allow",
      toolPolicy: { deny: ["pipeline.*"] },
    })).toMatchObject({
      visibleToModel: false,
      requiresConfirmation: false,
      denied: true,
      risk: "draft-write",
      reason: "policy-denied",
      checkpointRequired: false,
      source: "sessionConfig.toolPolicy.deny",
      pattern: "pipeline.*",
    });

    expect(resolveSessionToolPolicy({
      toolName: draftWriteTool.name,
      risk: draftWriteTool.risk,
      permissionMode: "edit",
      toolPolicy: { ask: ["pipeline.revise"] },
    })).toMatchObject({
      visibleToModel: true,
      requiresConfirmation: true,
      denied: false,
      risk: "draft-write",
      reason: "policy-ask",
      checkpointRequired: false,
      source: "sessionConfig.toolPolicy.ask",
    });

    expect(resolveSessionToolPolicy({
      toolName: draftWriteTool.name,
      risk: draftWriteTool.risk,
      permissionMode: "read",
    })).toMatchObject({
      visibleToModel: false,
      requiresConfirmation: false,
      denied: true,
      risk: "draft-write",
      reason: "permission-denied",
      checkpointRequired: false,
    });

    expect(resolveSessionToolPolicy({
      toolName: draftWriteTool.name,
      risk: draftWriteTool.risk,
      permissionMode: "edit",
      canvasContext: dirtyCanvas,
    })).toMatchObject({
      visibleToModel: false,
      requiresConfirmation: false,
      denied: true,
      risk: "draft-write",
      reason: "dirty-resource-blocked",
      checkpointRequired: false,
    });

    expect(resolveSessionToolPolicy({
      toolName: confirmedWriteTool.name,
      risk: confirmedWriteTool.risk,
      permissionMode: "edit",
    })).toMatchObject({
      visibleToModel: true,
      requiresConfirmation: true,
      denied: false,
      risk: "confirmed-write",
      reason: "risk-confirmation",
      checkpointRequired: true,
    });
  });

  it("uses the same resolver for provider-visible schemas instead of only applying toolPolicy deny", () => {
    const tools = [readTool, draftWriteTool, confirmedWriteTool];

    expect(filterSessionToolsForProvider(tools, undefined, { permissionMode: "read" })).toEqual({
      tools: [readTool],
      deniedTools: ["pipeline.revise", "guided.exit"],
      resolutions: [
        expect.objectContaining({ toolName: "cockpit.get_snapshot", visibleToModel: true, reason: "allowed" }),
        expect.objectContaining({ toolName: "pipeline.revise", visibleToModel: false, reason: "permission-denied" }),
        expect.objectContaining({ toolName: "guided.exit", visibleToModel: false, reason: "permission-denied" }),
      ],
    });

    expect(filterSessionToolsForProvider(tools, undefined, { permissionMode: "edit", canvasContext: dirtyCanvas })).toEqual({
      tools: [readTool],
      deniedTools: ["pipeline.revise", "guided.exit"],
      resolutions: [
        expect.objectContaining({ toolName: "cockpit.get_snapshot", visibleToModel: true, reason: "allowed" }),
        expect.objectContaining({ toolName: "pipeline.revise", visibleToModel: false, reason: "dirty-resource-blocked" }),
        expect.objectContaining({ toolName: "guided.exit", visibleToModel: false, reason: "dirty-resource-blocked" }),
      ],
    });
  });
});
