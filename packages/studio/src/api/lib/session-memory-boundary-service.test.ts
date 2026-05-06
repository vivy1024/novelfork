import { describe, expect, it, vi } from "vitest";

import {
  createSessionMemoryBoundaryService,
  type SessionMemoryCandidate,
  type SessionMemoryWriter,
} from "./session-memory-boundary-service";

function candidate(overrides: Partial<SessionMemoryCandidate> = {}): SessionMemoryCandidate {
  return {
    sessionId: "session-1",
    content: "以后请默认用第三人称有限视角写正文。",
    source: { kind: "message", messageId: "m1", seq: 1 },
    createdBy: "user",
    ...overrides,
  };
}

describe("session-memory-boundary-service", () => {
  it("writes explicit user preferences to user memory with an audit envelope", async () => {
    const writer: SessionMemoryWriter = vi.fn(async () => ({ ok: true as const, memoryId: "mem-user-1" }));
    const service = createSessionMemoryBoundaryService({ writer, now: () => 1_779_206_400_000 });

    const result = await service.commitMemory(candidate({
      classification: "user-preference",
      confirmation: { mode: "explicit", confirmedBy: "author" },
      tags: ["voice"],
    }));

    expect(result).toMatchObject({ ok: true, action: "written", memoryId: "mem-user-1", scope: "user" });
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({
      scope: "user",
      content: "以后请默认用第三人称有限视角写正文。",
      tags: ["conversation-memory", "user-preference", "voice"],
      audit: expect.objectContaining({
        sessionId: "session-1",
        classification: "user-preference",
        source: { kind: "message", messageId: "m1", seq: 1 },
        confirmation: { mode: "explicit", confirmedBy: "author" },
        createdBy: "user",
        createdAt: 1_779_206_400_000,
      }),
    }));
  });

  it("writes project facts only when they carry a traceable project source", async () => {
    const writer: SessionMemoryWriter = vi.fn(async () => ({ ok: true as const, memoryId: "mem-project-1" }));
    const service = createSessionMemoryBoundaryService({ writer, now: () => 1_779_206_400_000 });

    const missingSource = await service.commitMemory(candidate({
      classification: "project-fact",
      content: "青岚宗位于东海灵脉断层。",
      projectId: "book-1",
      source: { kind: "message", messageId: "m2", seq: 2 },
      confirmation: { mode: "explicit", confirmedBy: "author" },
    }));
    expect(missingSource).toMatchObject({ ok: false, status: 400, code: "project_source_required" });
    expect(writer).not.toHaveBeenCalled();

    const written = await service.commitMemory(candidate({
      classification: "project-fact",
      content: "青岚宗位于东海灵脉断层。",
      projectId: "book-1",
      source: { kind: "project-resource", projectId: "book-1", path: "truth/world.md", ref: "sha256:abc" },
      confirmation: { mode: "explicit", confirmedBy: "author" },
    }));

    expect(written).toMatchObject({ ok: true, action: "written", memoryId: "mem-project-1", scope: "project" });
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({
      scope: "project",
      projectId: "book-1",
      tags: ["conversation-memory", "project-fact"],
      audit: expect.objectContaining({
        classification: "project-fact",
        source: { kind: "project-resource", projectId: "book-1", path: "truth/world.md", ref: "sha256:abc" },
      }),
    }));
  });

  it("does not automatically write temporary story drafts to long-term memory", async () => {
    const writer: SessionMemoryWriter = vi.fn(async () => ({ ok: true as const, memoryId: "should-not-write" }));
    const service = createSessionMemoryBoundaryService({ writer, now: () => 1_779_206_400_000 });

    const result = await service.commitMemory(candidate({
      classification: "temporary-story-draft",
      content: "临时试写：主角在雨夜突然觉醒隐藏血脉。",
      projectId: "book-1",
      source: { kind: "message", messageId: "draft-1", seq: 3 },
      confirmation: { mode: "implicit-stable" },
    }));

    expect(result).toMatchObject({
      ok: true,
      action: "skipped",
      reason: "temporary_story_draft_not_long_term",
      audit: expect.objectContaining({ classification: "temporary-story-draft", sessionId: "session-1" }),
    });
    expect(writer).not.toHaveBeenCalled();
  });

  it("keeps failures recoverable and never reports fake memory success", async () => {
    const writer: SessionMemoryWriter = vi.fn(async () => ({ ok: false as const, code: "provider_down", error: "memory provider unavailable" }));
    const service = createSessionMemoryBoundaryService({ writer, now: () => 1_779_206_400_000 });

    const result = await service.commitMemory(candidate({
      classification: "user-preference",
      confirmation: { mode: "explicit", confirmedBy: "author" },
    }));

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: "memory_write_failed",
      error: "memory provider unavailable",
      recoverable: true,
      audit: expect.objectContaining({ classification: "user-preference", sessionId: "session-1" }),
    });
  });

  it("exposes a readonly status when no memory writer is configured", async () => {
    const service = createSessionMemoryBoundaryService({ writer: null, now: () => 1_779_206_400_000 });

    expect(await service.getStatus("session-1")).toMatchObject({
      ok: true,
      status: "readonly",
      writable: false,
      categories: ["user-preference", "project-fact", "temporary-story-draft"],
      reason: "memory_writer_not_configured",
    });
    await expect(service.commitMemory(candidate({ classification: "user-preference", confirmation: { mode: "explicit", confirmedBy: "author" } }))).resolves.toMatchObject({
      ok: false,
      status: 503,
      code: "memory_writer_not_configured",
    });
  });
});
