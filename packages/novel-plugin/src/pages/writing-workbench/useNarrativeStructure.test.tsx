import { StrictMode, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNarrativeStructure } from "./useNarrativeStructure";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetchHonoringAbort() {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response(JSON.stringify({ ok: true, bookId: "book-1", entities: [{ id: "e1", canonicalName: "陆沉" }] }), { status: 200 })), 20);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    });
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("useNarrativeStructure", () => {
  it("StrictMode 下首次挂载被清理，复用同一请求的第二次挂载仍拿到数据", async () => {
    const fetchMock = stubFetchHonoringAbort();
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useNarrativeStructure("book-1"), { wrapper });

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("两个面板共用请求，先挂载的卸载后另一个不受影响", async () => {
    stubFetchHonoringAbort();
    const first = renderHook(() => useNarrativeStructure("book-2"));
    const second = renderHook(() => useNarrativeStructure("book-2"));
    first.unmount();

    await waitFor(() => expect(second.result.current.state.status).toBe("ready"));
  });
});
