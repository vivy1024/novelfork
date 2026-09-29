import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchCanvas } from "./WorkbenchCanvas";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

vi.mock("./resource-viewers", () => ({
  ResourceViewer: ({ styleProfileSummary }: { styleProfileSummary?: string }) => <output aria-label="划词文风">{styleProfileSummary ?? "无指南"}</output>,
}));
vi.mock("./ChapterContextRail", () => ({ ChapterContextRail: () => null }));

const chapter: WorkbenchResourceNode = { id: "chapter:1", kind: "chapter", title: "第一章", content: "正文",
  metadata: { isChapter: true, chapterNumber: 1 },
  capabilities: { open: true, edit: true, readonly: false, unsupported: false, delete: false, apply: false } };
const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("文风预设接入划词写作", () => {
  it("新预设使用指南，保存事件只刷新当前书，空指南不回退到数字指令", async () => {
    let guideText = "克制叙述，通过选择刻画人物";
    const styleRequests = vi.fn(() => reply({ source: "preset", guideText, profile: { avgSentenceLength: 18 } }));
    vi.stubGlobal("fetch", vi.fn(async (path: string) => String(path).endsWith("/style/profile") ? styleRequests() : reply({})));
    render(<WorkbenchCanvas node={chapter} bookId="book-a" onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("划词文风").textContent).toBe(guideText));
    expect(screen.getByLabelText("划词文风").textContent).not.toContain("18");
    await act(async () => { window.dispatchEvent(new CustomEvent("novelfork:style-preset-updated", { detail: { bookId: "book-b" } })); });
    expect(styleRequests).toHaveBeenCalledTimes(1);
    guideText = "";
    await act(async () => { window.dispatchEvent(new CustomEvent("novelfork:style-preset-updated", { detail: { bookId: "book-a" } })); });
    await waitFor(() => expect(screen.getByLabelText("划词文风").textContent).toBe("无指南"));
    expect(styleRequests).toHaveBeenCalledTimes(2);
  });

  it("切书后旧请求的迟到响应不能覆盖当前书指南", async () => {
    let finishOld!: (response: Response) => void;
    const old = new Promise<Response>((resolve) => { finishOld = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (String(path) === "/api/books/book-a/style/profile") return old;
      if (String(path) === "/api/books/book-b/style/profile") return reply({ source: "preset", guideText: "乙书的写法" });
      return reply({});
    }));
    const rendered = render(<WorkbenchCanvas node={chapter} bookId="book-a" onSave={vi.fn()} />);
    rendered.rerender(<WorkbenchCanvas node={chapter} bookId="book-b" onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("划词文风").textContent).toBe("乙书的写法"));
    await act(async () => { finishOld(reply({ source: "preset", guideText: "甲书的旧写法" })); });
    expect(screen.getByLabelText("划词文风").textContent).toBe("乙书的写法");
  });
});
