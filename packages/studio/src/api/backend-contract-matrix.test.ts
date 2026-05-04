import { describe, expect, it } from "vitest";

import { BACKEND_CONTRACT_CAPABILITIES, findBackendContractCapability } from "./backend-contract-matrix";

describe("backend contract capability matrix", () => {
  it("covers MVP startup, session, workbench, writing and provider capabilities with real sources", () => {
    const required = [
      "books.list",
      "sessions.active",
      "providers.status",
      "providers.models",
      "sessions.chat.state",
      "sessions.chat.websocket",
      "sessions.tools.confirm",
      "chapters.detail",
      "candidates.accept",
      "drafts.crud",
      "narrative.line.snapshot",
      "session-native.write-next",
      "writing-modes.apply",
      "providers.model.test",
    ];

    for (const id of required) {
      const capability = findBackendContractCapability(id);
      expect(capability, id).toBeTruthy();
      expect(capability?.status, id).toBe("current");
      expect(capability?.source.kind, id).toMatch(/route|websocket|session-tool/);
      expect(capability?.source.file, id).toMatch(/^packages\/studio\/src\//);
      expect(capability?.frontendRule, id).not.toMatch(/mock|fake|noop/i);
    }
  });

  it("records transparent non-current semantics instead of pretending everything is stable", () => {
    expect(findBackendContractCapability("books.create-status")).toMatchObject({ status: "process-memory" });
    expect(findBackendContractCapability("ai.complete.chunked-buffer")).toMatchObject({ status: "chunked-buffer" });
    expect(findBackendContractCapability("writing-modes.preview")).toMatchObject({ status: "prompt-preview" });
  });

  it("keeps ids unique so frontend clients can depend on stable capability keys", () => {
    const ids = BACKEND_CONTRACT_CAPABILITIES.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
