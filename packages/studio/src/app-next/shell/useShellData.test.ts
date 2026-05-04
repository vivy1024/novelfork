import { describe, expect, it, vi } from "vitest";

import { normalizeCapability } from "../backend-contract";
import { loadShellData } from "./useShellData";

function ok<T>(data: T) {
  return {
    ok: true as const,
    data,
    raw: data,
    httpStatus: 200,
    capability: normalizeCapability({ id: "test", status: "current" }),
  };
}

describe("loadShellData", () => {
  it("loads shell sidebar data through backend contract domain clients", async () => {
    const resources = {
      listBooks: vi.fn(async () => ok({
        books: [{
          id: "book-1",
          title: "灵潮纪元",
          status: "drafting" as const,
          platform: "qidian",
          genre: "xuanhuan",
          targetChapters: 100,
          chapters: 1,
          chapterCount: 1,
          lastChapterNumber: 1,
          totalWords: 3000,
          approvedChapters: 0,
          pendingReview: 0,
          pendingReviewChapters: 0,
          failedReview: 0,
          failedChapters: 0,
          updatedAt: "2026-05-04T00:00:00.000Z",
        }],
      })),
    };
    const sessions = {
      listActiveSessions: vi.fn(async () =>
        ok([
          {
            id: "session-1",
            title: "主叙述者",
            agentId: "writer",
            kind: "standalone" as const,
            sessionMode: "chat" as const,
            status: "active" as const,
            createdAt: "2026-05-04T00:00:00.000Z",
            lastModified: "2026-05-04T00:00:00.000Z",
            messageCount: 0,
            sortOrder: 0,
            projectId: "book-1",
            sessionConfig: {
              providerId: "sub2api",
              modelId: "gpt-5.4",
              permissionMode: "edit" as const,
              reasoningEffort: "medium" as const,
            },
          },
        ]),
      ),
    };
    const providers = {
      getSummary: vi.fn(async () => ok({ providers: [], activeProviderId: null })),
      getStatus: vi.fn(async () => ok({ configured: false, providerId: null, modelId: null })),
    };

    const result = await loadShellData({ resources, sessions, providers });

    expect(resources.listBooks).toHaveBeenCalledOnce();
    expect(sessions.listActiveSessions).toHaveBeenCalledOnce();
    expect(providers.getSummary).toHaveBeenCalledOnce();
    expect(providers.getStatus).toHaveBeenCalledOnce();
    expect(result.error).toBeNull();
    expect(result.books[0]).toMatchObject({ id: "book-1", title: "灵潮纪元" });
    expect(result.sessions).toEqual([
      {
        id: "session-1",
        title: "主叙述者",
        status: "active",
        projectId: "book-1",
        projectName: "灵潮纪元",
        agentId: "writer",
        lastModified: "2026-05-04T00:00:00.000Z",
      },
    ]);
    expect(result.providerSummary).toEqual({ providers: [], activeProviderId: null });
    expect(result.providerStatus).toEqual({ configured: false, providerId: null, modelId: null });
  });
});
