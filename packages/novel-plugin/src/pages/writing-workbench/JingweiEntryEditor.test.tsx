import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JingweiEntryEditor } from "./JingweiEntryEditor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("JingweiEntryEditor canonical history", () => {
  it("uses jingwei_revision API only and ignores legacy revisionHistory JSON", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/revisions")) {
        return new Response(JSON.stringify({ revisions: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ entries: [{ id: "entry-1", title: "条目", relatedEntryIds: [] }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{
          id: "entry-1",
          title: "条目",
          contentMd: "正文",
          revisionHistory: [{ timestamp: "2026-08-01T00:00:00.000Z", source: "user", changedFields: ["contentMd"] }],
        }}
        onSave={vi.fn()}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /历史/ }));

    expect(await screen.findByText("暂无修改记录")).toBeTruthy();
    expect(screen.queryByText(/修改了.*contentMd/)).toBeNull();
  });

  it("does not refetch history when parent rerenders with equivalent relation arrays", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/revisions")) {
        return new Response(JSON.stringify({ revisions: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ entries: [{ id: "entry-1", title: "条目", relatedEntryIds: ["entry-2"] }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSave = vi.fn();
    const { rerender } = render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "entry-1", title: "条目", contentMd: "正文", relatedEntryIds: ["entry-2"] }}
        relatedEntries={[{ id: "entry-2", title: "关联条目" }]}
        onSave={onSave}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    rerender(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "entry-1", title: "条目", contentMd: "正文", relatedEntryIds: ["entry-2"] }}
        relatedEntries={[{ id: "entry-2", title: "关联条目" }]}
        onSave={onSave}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a real history loading error instead of pretending the list is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/revisions")) return new Response("error", { status: 500 });
      return new Response(JSON.stringify({ entries: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "entry-1", title: "条目", contentMd: "正文" }}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /历史/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("历史加载失败（500）");
  });
});
