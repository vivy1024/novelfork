import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mapBookFileEntryToNode, useBookFileTree } from "./use-book-file-tree";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useBookFileTree", () => {
  it("classifies chapters/NNNN_*.md as chapters and other files as plain files", () => {
    const root = mapBookFileEntryToNode({
      name: "story",
      path: "story",
      type: "directory",
      children: [
        { name: "world-model.md", path: "story/world-model.md", type: "file" },
        { name: "notes.txt", path: "story/notes.txt", type: "file" },
        { name: "map.png", path: "story/map.png", type: "file" },
        { name: "0001_开端.md", path: "chapters/0001_开端.md", type: "file" },
      ],
    }, "book-1");

    const storyFile = root.children?.[0];
    const textFile = root.children?.[1];
    const imageFile = root.children?.[2];
    const chapter = root.children?.[3];

    expect(chapter?.kind).toBe("chapter");
    expect(chapter?.metadata?.isChapter).toBe(true);
    expect(chapter?.metadata?.isFile).toBe(true);

    expect(storyFile?.kind).toBe("file");
    expect(storyFile?.metadata?.isChapter).toBeUndefined();
    expect(storyFile?.capabilities.edit).toBe(true);

    expect(textFile?.kind).toBe("file");
    expect(textFile?.capabilities.open).toBe(true);

    expect(imageFile?.kind).toBe("file");
    expect(imageFile?.capabilities.open).toBe(true);
    expect(imageFile?.capabilities.edit).toBe(false);
  });

  it("renders a stale cached tree immediately and replaces it after background refresh", async () => {
    const refreshResponse = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        tree: [{ name: "cached.md", path: "cached.md", type: "file" }],
        cache: { hit: true, stale: true, refreshing: true, generatedAt: "2026-08-09T00:00:00.000Z" },
      }))
      .mockImplementationOnce(() => refreshResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useBookFileTree("book-1", true));

    await waitFor(() => expect(result.current.nodes[0]?.title).toBe("cached.md"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("refresh=1");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("refresh=1");

    await act(async () => {
      refreshResponse.resolve(jsonResponse({
        tree: [{ name: "fresh.md", path: "fresh.md", type: "file" }],
        cache: { hit: true, stale: false, refreshing: false, generatedAt: "2026-08-09T00:01:00.000Z" },
      }));
      await refreshResponse.promise;
    });

    await waitFor(() => expect(result.current.nodes[0]?.title).toBe("fresh.md"));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("keeps the previous tree visible when a forced refresh fails", async () => {
    const refreshResponse = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        tree: [{ name: "stable.md", path: "stable.md", type: "file" }],
        cache: { hit: false, stale: false, refreshing: false, generatedAt: "2026-08-09T00:00:00.000Z" },
      }))
      .mockImplementationOnce(() => refreshResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useBookFileTree("book-1", true));
    await waitFor(() => expect(result.current.nodes[0]?.title).toBe("stable.md"));

    act(() => result.current.refresh());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("refresh=1");
    expect(result.current.nodes[0]?.title).toBe("stable.md");

    await act(async () => {
      refreshResponse.reject(new Error("扫描失败"));
      await refreshResponse.promise.catch(() => undefined);
    });

    await waitFor(() => expect(result.current.error).toBe("扫描失败"));
    expect(result.current.nodes[0]?.title).toBe("stable.md");
    expect(result.current.loading).toBe(false);
  });

  it("does not let a slower previous book response overwrite the current book", async () => {
    const firstBookResponse = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("book-1")) return firstBookResponse.promise;
      return Promise.resolve(jsonResponse({
        tree: [{ name: "book-2.md", path: "book-2.md", type: "file" }],
        cache: { hit: false, stale: false, refreshing: false, generatedAt: "2026-08-09T00:00:00.000Z" },
      }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(
      ({ bookId }) => useBookFileTree(bookId, true),
      { initialProps: { bookId: "book-1" } },
    );
    rerender({ bookId: "book-2" });
    await waitFor(() => expect(result.current.nodes[0]?.title).toBe("book-2.md"));

    await act(async () => {
      firstBookResponse.resolve(jsonResponse({
        tree: [{ name: "book-1-late.md", path: "book-1-late.md", type: "file" }],
        cache: { hit: false, stale: false, refreshing: false, generatedAt: "2026-08-09T00:00:00.000Z" },
      }));
      await firstBookResponse.promise;
    });

    expect(result.current.nodes[0]?.title).toBe("book-2.md");
  });
});
