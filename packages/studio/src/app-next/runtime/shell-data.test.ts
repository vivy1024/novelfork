import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeBootstrap, RuntimeEntityCapabilities } from "./product-contract";
import type { RuntimeNarratorRecord } from "./runtime-narrator-client";

const runtimeMocks = vi.hoisted(() => ({
  createRuntimeProductClient: vi.fn(),
  createRuntimeNarratorClient: vi.fn(),
}));

vi.mock("./product-contract", async (importOriginal) => ({
  ...await importOriginal<typeof import("./product-contract")>(),
  createRuntimeProductClient: runtimeMocks.createRuntimeProductClient,
}));

vi.mock("./runtime-narrator-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("./runtime-narrator-client")>(),
  createRuntimeNarratorClient: runtimeMocks.createRuntimeNarratorClient,
}));

import { loadRuntimeShellData, mapRuntimeBootstrapToShellData } from "./shell-data";

function bootstrap(overrides: Partial<RuntimeBootstrap> = {}): RuntimeBootstrap {
  return {
    books: [],
    narrators: [],
    model: { setupRequired: false, label: "Runtime 模型" },
    capabilities: {
      books: { read: true },
      narrators: { read: true },
      workspace: { read: true },
    },
    ...overrides,
  };
}

describe("Runtime shell-data adapter", () => {
  beforeEach(() => {
    runtimeMocks.createRuntimeProductClient.mockReset();
    runtimeMocks.createRuntimeNarratorClient.mockReset();
  });

  it("fails closed for books and narrators without explicit read capability", () => {
    const result = mapRuntimeBootstrapToShellData(bootstrap({
      books: [
        { id: "book-readable", title: "可读作品", capabilities: { read: true } },
        { id: "book-denied", title: "拒绝作品", capabilities: { read: false } },
        { id: "book-omitted", title: "缺少授权", capabilities: {} as RuntimeEntityCapabilities },
      ],
      narrators: [
        { id: "narrator-readable", bookId: "book-readable", title: "可读叙述者", capabilities: { read: true } },
        { id: "narrator-denied", bookId: "book-readable", title: "拒绝叙述者", capabilities: { read: false } },
        { id: "narrator-omitted", bookId: "book-readable", title: "缺少授权", capabilities: {} as RuntimeEntityCapabilities },
      ],
    }));

    expect(result.books).toEqual([{ id: "book-readable", title: "可读作品" }]);
    expect(result.sessions).toEqual([{
      id: "narrator-readable",
      title: "可读叙述者",
      status: "active",
      projectId: "book-readable",
      projectName: "可读作品",
      lastModified: undefined,
    }]);
  });

  it("associates readable narrators with readable books and normalizes session status", () => {
    const result = mapRuntimeBootstrapToShellData(bootstrap({
      books: [{ id: "book-1", title: "灵潮纪元", capabilities: { read: true } }],
      narrators: [
        {
          id: "narrator-active",
          bookId: "book-1",
          title: "主叙述者",
          status: "working",
          updatedAt: "2026-05-04T00:00:00.000Z",
          capabilities: { read: true },
        },
        {
          id: "narrator-archived",
          bookId: "book-1",
          title: "归档叙述者",
          status: "archived",
          capabilities: { read: true },
        },
      ],
    }));

    expect(result.sessions).toEqual([
      {
        id: "narrator-active",
        title: "主叙述者",
        status: "active",
        projectId: "book-1",
        projectName: "灵潮纪元",
        lastModified: "2026-05-04T00:00:00.000Z",
        working: true,
      },
      {
        id: "narrator-archived",
        title: "归档叙述者",
        status: "archived",
        projectId: "book-1",
        projectName: "灵潮纪元",
        lastModified: undefined,
      },
    ]);
  });

  it("merges standalone narrators with recent pin, working, and unread state", () => {
    const standalone: RuntimeNarratorRecord = {
      id: "standalone-1",
      chapterId: null,
      type: "primary",
      variant: "primary",
      title: "世界观规划室",
      model: "sub2api:gpt-5.6",
      reasoningEffort: "high",
      permissionMode: "default",
      planMode: false,
      cwd: null,
      status: "working",
      substatus: ["reasoning"],
      traits: ["standalone"],
      messageCount: 3,
      createdAt: "2026-05-04T00:00:00.000Z",
      updatedAt: "2026-05-05T00:00:00.000Z",
      lastMessageAt: "2026-05-05T00:00:00.000Z",
      errorMessage: null,
      pinned: true,
      lastVisitedAt: 1,
      working: true,
      unread: true,
      binding: { kind: "standalone" },
    };

    const result = mapRuntimeBootstrapToShellData(bootstrap(), [standalone]);

    expect(result.sessions).toEqual([{
      id: "standalone-1",
      title: "世界观规划室",
      status: "active",
      lastModified: "2026-05-05T00:00:00.000Z",
      pinned: true,
      working: true,
      unread: true,
    }]);
  });

  it("maps Runtime model readiness to a displayable provider status", () => {
    expect(mapRuntimeBootstrapToShellData(bootstrap({
      model: { setupRequired: false, label: "Claude Sonnet" },
    })).providerStatus).toEqual({
      hasUsableModel: true,
      label: "Claude Sonnet",
    });

    expect(mapRuntimeBootstrapToShellData(bootstrap({
      model: { setupRequired: true },
    })).providerStatus).toEqual({
      hasUsableModel: false,
      label: "需要配置模型",
    });
  });

  it("uses the default Runtime product and narrator clients when none are supplied", async () => {
    const getBootstrap = vi.fn(async () => bootstrap());
    const listNarrators = vi.fn(async () => []);
    runtimeMocks.createRuntimeProductClient.mockReturnValue({ getBootstrap });
    runtimeMocks.createRuntimeNarratorClient.mockReturnValue({ listNarrators });

    const result = await loadRuntimeShellData();

    expect(runtimeMocks.createRuntimeProductClient).toHaveBeenCalledOnce();
    expect(runtimeMocks.createRuntimeNarratorClient).toHaveBeenCalledOnce();
    expect(getBootstrap).toHaveBeenCalledOnce();
    expect(listNarrators).toHaveBeenCalledWith({ status: "active", sort: "recent", activeNarratorId: undefined });
    expect(result.error).toBeNull();
  });

  it("rethrows the original bootstrap error", async () => {
    const error = new Error("Runtime bootstrap unavailable");
    const client = { getBootstrap: vi.fn(async () => { throw error; }) };

    await expect(loadRuntimeShellData(client, { listNarrators: vi.fn(async () => []) })).rejects.toBe(error);
    expect(client.getBootstrap).toHaveBeenCalledOnce();
  });
});
