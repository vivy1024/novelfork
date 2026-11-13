import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DissectLibraryPanel, nextDissectSelection } from "./DissectLibraryPanel";
afterEach(cleanup);
const path = "story/dissect-library/小说/参考书/报告/开篇分析.md";
function client() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/tree")) return { tree: { path: "story/dissect-library", title: "拆书库", kind: "directory", children: [{ path: "story/dissect-library/小说", title: "小说", kind: "directory", children: [{ path, title: "开篇分析", kind: "document", wordCount: 100 }] }] }, referenceFiles: [{ path: "参考.txt", title: "参考.txt", bytes: 100 }] };
    if (url.includes("/doc?") || init?.method === "PUT") return { path, content: "# 开篇分析\n真实证据" };
    return { selectedRange: { from: 11, to: 20 }, generatedDocuments: 14, modelRefined: false };
  });
}
it("展开目录、读取编辑保存与向叙述者发送报告摘要", async () => {
  const fetchJson = client(); const discuss = vi.fn(); const dirty = vi.fn();
  render(<DissectLibraryPanel bookId="book" fetchJson={fetchJson} onSendToNarrator={discuss} onDirtyChange={dirty} />);
  fireEvent.click(await screen.findByRole("button", { name: "开篇分析" }));
  await screen.findByText("真实证据");
  fireEvent.click(screen.getByRole("button", { name: "和叙述者讨论此篇" })); expect(discuss).toHaveBeenCalledWith(expect.stringContaining("真实证据"));
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.change(screen.getByRole("textbox", { name: "拆书报告正文" }), { target: { value: "# 作者修改" } });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith(expect.stringContaining("/doc"), expect.objectContaining({ method: "PUT", body: JSON.stringify({ path, content: "# 作者修改" }) })));
});
it("快捷选章、模板与分章拆真实提交到本书 API", async () => {
  const fetchJson = client(); render(<DissectLibraryPanel bookId="book" fetchJson={fetchJson} />);
  fireEvent.click(screen.getByRole("button", { name: "+ 拆新书" }));
  fireEvent.change(screen.getByLabelText("参考书名"), { target: { value: "参考书" } });
  await screen.findByRole("option", { name: "参考.txt" });
  fireEvent.change(screen.getByLabelText("本书内的参考原文"), { target: { value: "参考.txt" } });
  fireEvent.click(screen.getByRole("button", { name: "前 10 章" })); fireEvent.click(screen.getByRole("button", { name: "向后增选 10 章" }));
  expect((screen.getByLabelText("起始章") as HTMLInputElement).value).toBe("11"); expect((screen.getByLabelText("结束章") as HTMLInputElement).value).toBe("20");
  fireEvent.click(screen.getByRole("button", { name: "分章拆" }));
  fireEvent.click(screen.getByRole("button", { name: "建立完整扫描库" }));
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith(expect.stringContaining("/build"), expect.objectContaining({ body: expect.stringContaining('"from":11,"to":20') })));
  const call = fetchJson.mock.calls.find(([, init]) => init?.method === "POST"); expect(JSON.parse(call?.[1]?.body as string)).toMatchObject({ filePath: "参考.txt", dissectMode: "per-chapter", useModel: false });
});
it("向后增选使用已选终点", () => { expect(nextDissectSelection({ preset: "first5" })).toEqual({ preset: "range", from: 6, to: 15 }); });
