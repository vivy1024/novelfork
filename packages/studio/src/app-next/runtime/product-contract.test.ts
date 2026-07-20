import { describe, expect, it, vi } from "vitest";

import {
  buildBookScopedNarratorPath,
  createRuntimeProductClient,
  mapRuntimeBootstrap,
} from "./product-contract";

const bootstrap = {
  contractVersion: "phase-0",
  features: {
    runtimeNarratorParity: false,
    learningCenter: false,
    runtimeAdminAdvanced: false,
    knowledgeBase: false,
    scheduledTasks: false,
    groupChat: false,
    globalSearch: false,
    singleRuntimeEntry: false,
  },
  books: [
    { id: "book 1", title: "长夜", capabilities: { read: true, create: true } },
  ],
  narrators: [
    {
      id: "narrator 1",
      bookId: "book 1",
      title: "作者助手",
      capabilities: { read: true, send: true, interrupt: true },
    },
  ],
  model: { setupRequired: false, label: "Runtime model" },
  capabilities: {
    books: { read: true, create: true },
    narrators: { read: true, create: false },
    workspace: { read: true, create: true, update: true },
  },
};

const pendingOperation = {
  id: "operation-1",
  bookId: "book 1",
  state: "runtime-bound",
  narratorId: "narrator 1",
};

function response(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Runtime product contract", () => {
  it("maps bootstrap records and fails closed for omitted mutation capabilities", () => {
    const mapped = mapRuntimeBootstrap({
      books: [{ id: "book", title: "书", capabilities: { read: true } }],
      narrators: [],
      model: {},
      capabilities: {
        books: { read: true },
        narrators: { read: true },
        workspace: { read: true },
      },
    });

    expect(mapped.model.setupRequired).toBe(true);
    expect(mapped.capabilities.narrators.create).toBeUndefined();
    expect(mapped.books[0]?.capabilities.read).toBe(true);
    expect(mapped.books[0]?.capabilities.update).toBeUndefined();

    const omittedReads = mapRuntimeBootstrap({
      books: [{ id: "book-no-read", title: "未授权" }],
      narrators: [
        {
          id: "narrator-no-read",
          bookId: "book-no-read",
          title: "未授权叙述者",
        },
      ],
      model: {},
      capabilities: { books: {}, narrators: {}, workspace: {} },
    });
    expect(omittedReads.books[0]?.capabilities.read).toBe(false);
    expect(omittedReads.narrators[0]?.capabilities.read).toBe(false);
    expect(omittedReads.capabilities).toEqual({
      books: { read: false },
      narrators: { read: false },
      workspace: { read: false },
    });
  });

  it("only calls bootstrap and book-scoped narrator/workspace paths", async () => {
    const paths: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      paths.push(path);
      if (path === "/api/novelfork/bootstrap") return response(bootstrap);
      if (path === "/api/novelfork/books") return response(pendingOperation);
      if (path === "/api/novelfork/books/book%201/status")
        return response(pendingOperation);
      if (path === "/api/novelfork/books/book%201/retry")
        return response({ ...pendingOperation, state: "ready" });
      if (path === "/api/novelfork/books/legacy%2Fbook/claim")
        return response({
          ...pendingOperation,
          bookId: "legacy/book",
          state: "ready",
        });
      if (path === "/api/novelfork/books/book%201/repair")
        return response({ ...pendingOperation, state: "ready" });
      if (path.endsWith("/narrators") && !path.includes("narrator%201"))
        return response({ narrators: bootstrap.narrators });
      if (path.endsWith("/workspace"))
        return response({
          book: bootstrap.books[0],
          resources: [],
          capabilities: { read: true, create: true, update: true },
        });
      if (path.endsWith("/workspace/chapters"))
        return response({
          resource: {
            id: "chapter:1",
            kind: "chapter",
            title: "第 1 章",
            content: "",
            capabilities: { read: true, update: true },
          },
        });
      if (path.endsWith("/workspace/resources/chapter%3A1"))
        return response({
          resource: {
            id: "chapter:1",
            kind: "chapter",
            title: "第 1 章",
            content: "正文",
            capabilities: { read: true, update: true },
          },
        });
      return response({});
    });
    const client = createRuntimeProductClient({
      fetch: { token: "runtime-token", fetchImpl },
    });

    await client.getBootstrap();
    await client.createBook({ title: "长夜" }, "create-book-1");
    await client.getBookStatus("book 1");
    await client.retryBookProvision("book 1");
    await client.claimLegacyBook("legacy/book");
    await client.repairBookBinding("book 1");
    await client.deleteBook("book 1");
    await client.listNarrators("book 1");
    await client.getWorkspace("book 1");
    await client.createWorkspaceChapter("book 1", { title: "第 1 章" });
    await client.saveWorkspaceResource("book 1", "chapter:1", "正文");

    expect(paths).toEqual([
      "/api/novelfork/bootstrap",
      "/api/novelfork/books",
      "/api/novelfork/books/book%201/status",
      "/api/novelfork/books/book%201/retry",
      "/api/novelfork/books/legacy%2Fbook/claim",
      "/api/novelfork/books/book%201/repair",
      "/api/novelfork/books/book%201",
      "/api/books/book%201/narrators",
      "/api/books/book%201/workspace",
      "/api/books/book%201/workspace/chapters",
      "/api/books/book%201/workspace/resources/chapter%3A1",
    ]);
    expect(paths.some((path) => /^\/api\/narrators\//.test(path))).toBe(false);
    expect(
      paths.some(
        (path) =>
          path.startsWith("/api/sessions") ||
          path.startsWith("/api/providers") ||
          path.startsWith("/api/settings") ||
          path.startsWith("/api/onboarding"),
      ),
    ).toBe(false);
    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("authorization"),
    ).toBe("Bearer runtime-token");
    expect(
      new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("Idempotency-Key"),
    ).toBe("create-book-1");
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ title: "长夜" }),
    );
    expect(fetchImpl.mock.calls[6]?.[1]?.method).toBe("DELETE");
    expect(fetchImpl.mock.calls[9]?.[1]?.body).toBe(
      JSON.stringify({ title: "第 1 章" }),
    );
    expect(fetchImpl.mock.calls[10]?.[1]?.body).toBe(
      JSON.stringify({ content: "正文" }),
    );
  });

  it("uses only encoded book-scoped product paths and never sends projectId", async () => {
    const fetchImpl = vi.fn(async () => response({ routines: [] }));
    const client = createRuntimeProductClient({ fetch: { fetchImpl } });
    const bookId = "book /中文?";
    const skillInput = {
      name: "新 skill",
      description: "作品技能",
      content: "正文",
      projectId: "forbidden",
    };
    const skillUpdate = {
      name: "重命名/skill",
      description: "更新",
      content: "新正文",
      projectId: "forbidden",
    };
    const hookInput = {
      event: "PreToolUse" as const,
      type: "command" as const,
      command: "bun test",
      matcher: "Bash / 写作",
      projectId: "forbidden",
    };
    const hookUpdate = {
      matcher: "Edit?",
      enabled: false,
      projectId: "forbidden",
    };

    await client.listBookRoutines(bookId);
    await client.toggleBookRoutine(bookId, "routine /?", "disable");
    await client.listBookSkills(bookId);
    await client.getBookSkill(bookId, "skill /?");
    await client.createBookSkill(bookId, skillInput);
    await client.updateBookSkill(bookId, "skill /?", skillUpdate);
    await client.deleteBookSkill(bookId, "skill /?");
    await client.listBookHooks(bookId);
    await client.createBookHook(bookId, hookInput);
    await client.updateBookHook(bookId, "hook /?", hookUpdate);
    await client.deleteBookHook(bookId, "hook /?");

    const calls = fetchImpl.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    expect(calls.map(([path]) => path)).toEqual([
      "/api/books/book%20%2F%E4%B8%AD%E6%96%87%3F/routines",
      "/api/books/book%20%2F%E4%B8%AD%E6%96%87%3F/routines/routine%20%2F%3F",
      "/api/books/book%20%2F%E4%B8%AD%E6%96%87%3F/skills",
      "/api/books/book%20%2F%E4%B8%AD%E6%96%87%3F/skills/skill%20%2F%3F",
      "/api/books/book%20%2F%E4%B8%AD%E6%96%87%3F/skills",
      "/api/books/book%20%2F%E4%B8%AD%E6%96%87%3F/skills/skill%20%2F%3F",
      "/api/books/book%20%2F%E4%B8%AD%E6%96%87%3F/skills/skill%20%2F%3F",
      "/api/books/book%20%2F%E4%B8%AD%E6%96%87%3F/hooks",
      "/api/books/book%20%2F%E4%B8%AD%E6%96%87%3F/hooks",
      "/api/books/book%20%2F%E4%B8%AD%E6%96%87%3F/hooks/hook%20%2F%3F",
      "/api/books/book%20%2F%E4%B8%AD%E6%96%87%3F/hooks/hook%20%2F%3F",
    ]);
    expect(calls.map(([, init]) => init.method ?? "GET")).toEqual([
      "GET",
      "PUT",
      "GET",
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "GET",
      "POST",
      "PUT",
      "DELETE",
    ]);
    expect(JSON.parse(String(calls[1]?.[1].body))).toEqual({
      action: "disable",
    });
    expect(JSON.parse(String(calls[4]?.[1].body))).toEqual({
      name: "新 skill",
      description: "作品技能",
      content: "正文",
    });
    expect(JSON.parse(String(calls[5]?.[1].body))).toEqual({
      name: "重命名/skill",
      description: "更新",
      content: "新正文",
    });
    expect(JSON.parse(String(calls[8]?.[1].body))).toEqual({
      event: "PreToolUse",
      type: "command",
      command: "bun test",
      matcher: "Bash / 写作",
    });
    expect(JSON.parse(String(calls[9]?.[1].body))).toEqual({
      matcher: "Edit?",
      enabled: false,
    });

    const serializedRequests = calls
      .map(([path, init]) => `${path}\n${String(init.body ?? "")}`)
      .join("\n");
    expect(serializedRequests).not.toContain("projectId");
    expect(serializedRequests).not.toContain("/api/routines/project");
    expect(serializedRequests).not.toContain("/api/skills?projectId=");
    expect(serializedRequests).not.toContain("/api/hooks?projectId=");
  });

  it("encodes both book and narrator identifiers in the book-scoped path", () => {
    expect(
      buildBookScopedNarratorPath("book/a", "narrator?1", "messages"),
    ).toBe("/api/books/book%2Fa/narrators/narrator%3F1/messages");
  });

  it("creates a narrator through the encoded book-scoped product endpoint", async () => {
    const fetchImpl = vi.fn(async () =>
      response({
        id: "narrator-2",
        bookId: "book/1",
        title: "第二个会话",
        capabilities: { read: true, send: true },
      }),
    );
    const client = createRuntimeProductClient({ fetch: { fetchImpl } });

    const narrator = await client.createNarrator("book/1", { title: "  第二个会话  " });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/books/book%2F1/narrators",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "第二个会话" }),
      }),
    );
    expect(narrator).toMatchObject({ id: "narrator-2", bookId: "book/1", title: "第二个会话" });
  });

  it("fails closed for an unknown contract version and malformed workspace DTOs", async () => {
    const mapped = mapRuntimeBootstrap({
      ...bootstrap,
      contractVersion: "future",
      features: { runtimeNarratorParity: true },
    });
    expect(mapped.contractVersion).toBeNull();
    expect(
      Object.values(mapped.features).every((value) => value === false),
    ).toBe(true);

    const client = createRuntimeProductClient({
      fetch: {
        fetchImpl: vi.fn(async () =>
          response({
            book: bootstrap.books[0],
            resources: [{ id: "", kind: "chapter", title: "坏资源" }],
            capabilities: { read: true },
          }),
        ),
      },
    });
    await expect(client.getWorkspace("book 1")).resolves.toMatchObject({
      resources: [],
    });
  });

  it("keeps collection and entity capabilities separate", () => {
    const mapped = mapRuntimeBootstrap(bootstrap);
    expect(mapped.capabilities.narrators.send).toBeUndefined();
    expect(mapped.narrators[0]?.capabilities.send).toBe(true);
  });
});
