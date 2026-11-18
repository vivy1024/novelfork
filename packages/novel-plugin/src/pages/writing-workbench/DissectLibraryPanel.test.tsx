import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DissectLibraryPanel, nextDissectSelection } from "./DissectLibraryPanel";

afterEach(cleanup);

const docPath = "story/dissect-library/小说/参考书/报告/开篇分析.md";

function client() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/tree")) {
      return {
        tree: {
          path: "story/dissect-library",
          title: "拆书库",
          kind: "directory",
          children: [
            {
              path: "story/dissect-library/小说",
              title: "小说",
              kind: "directory",
              children: [
                {
                  path: "story/dissect-library/小说/参考书",
                  title: "参考书",
                  kind: "directory",
                  meta: {
                    bookTitle: "参考书",
                    category: "仙侠",
                    sourceFile: "参考.txt",
                    totalChapters: 20,
                    analyzedRanges: [{ from: 1, to: 10 }],
                    updatedAt: "2026-01-01T00:00:00.000Z",
                  },
                  children: [
                    {
                      path: "story/dissect-library/小说/参考书/报告",
                      title: "报告",
                      kind: "directory",
                      children: [{ path: docPath, title: "开篇分析", kind: "document", wordCount: 100, updatedAt: "" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        referenceFiles: [{ path: "参考.txt", title: "参考.txt", bytes: 100 }],
      };
    }
    if (url.includes("/workspace")) {
      return {
        slug: "参考书",
        meta: {
          bookTitle: "参考书",
          category: "仙侠",
          sourceFile: "参考.txt",
          totalChapters: 20,
          analyzedRanges: [{ from: 1, to: 10 }],
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        hasStoredSource: true,
        chapters: [
          {
            number: 1,
            title: "初入青云",
            words: 2200,
            dialogueRatio: 0.32,
            tension: 74,
            conflictDensity: 4.5,
            hookCount: 1,
            rhythmScore: 80,
            avgSentenceLength: 16,
            head: "林墨推开山门。",
            tail: "长老眼中闪过异色。",
            hooks: ["长老眼中闪过异色。"],
            refined: false,
          },
        ],
      };
    }
    if (url.includes("/chapters/1")) {
      return {
        slug: "参考书",
        chapterNumber: 1,
        title: "初入青云",
        sourceText: "林墨推开山门。\n长老眼中闪过异色。",
        analysisPath: "story/dissect-library/小说/参考书/逐章拆解/第1章.md",
        analysisContent: "# 第 1 章 · 初入青云\n扫描证据。",
        metrics: {
          words: 2200,
          dialogueRatio: 0.32,
          tension: 74,
          rhythmScore: 80,
          avgSentenceLength: 16,
          hooks: ["长老眼中闪过异色。"],
        },
      };
    }
    if (url.endsWith("/preview")) {
      return {
        encoding: "utf-8",
        totalChapters: 2,
        totalWords: 4500,
        warnings: [],
        chapters: [
          { number: 1, title: "第一章", words: 2200, head: "开端", tail: "结尾", empty: false },
          { number: 2, title: "第二章", words: 2300, head: "续写", tail: "钩子", empty: false },
        ],
      };
    }
    if (url.includes("/doc?") || init?.method === "PUT") return { path: docPath, content: "# 开篇分析\n真实证据" };
    return { slug: "参考书", selectedRange: { from: 11, to: 20 }, generatedDocuments: 14, modelRefined: false };
  });
}

it("展示拆书看板、读取编辑报告与进入逐章双栏对照精读", async () => {
  const fetchJson = client();
  const discuss = vi.fn();
  const dirty = vi.fn();
  render(<DissectLibraryPanel bookId="book" fetchJson={fetchJson} onSendToNarrator={discuss} onDirtyChange={dirty} />);

  // 自动进入第一本书总览看板，点击「对照精读」进入左右双栏
  fireEvent.click(await screen.findByRole("button", { name: "对照精读" }));
  await screen.findByText("林墨推开山门。");
  expect(screen.getByText(/扫描证据/)).toBeTruthy();

  // 打开左侧报告并编辑保存、发送叙述者
  fireEvent.click(screen.getAllByRole("button", { name: "开篇分析" })[0]!);
  await screen.findByText("真实证据");
  fireEvent.click(screen.getByRole("button", { name: "和叙述者讨论此篇" }));
  expect(discuss).toHaveBeenCalledWith(expect.stringContaining("真实证据"));

  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.change(screen.getByRole("textbox", { name: "拆书报告正文" }), { target: { value: "# 作者修改" } });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() =>
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/doc"),
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ path: docPath, content: "# 作者修改" }) }),
    ),
  );
});

it("支持本书参考文件预览分章与上传本地文件建库", async () => {
  const fetchJson = client();
  render(<DissectLibraryPanel bookId="book" fetchJson={fetchJson} />);
  fireEvent.click(screen.getByRole("button", { name: /导入参考书/ }));

  // 切换到本书目录文件并预览分章
  fireEvent.click(screen.getByRole("button", { name: "本书目录文件" }));
  fireEvent.change(screen.getByLabelText("参考书名"), { target: { value: "参考书" } });
  await screen.findByRole("option", { name: /参考\.txt/ });
  fireEvent.change(screen.getByLabelText("选择当前作品目录下的参考原文"), { target: { value: "参考.txt" } });
  fireEvent.click(screen.getByRole("button", { name: "预览分章" }));
  await screen.findByText(/共切出 2 章/);

  fireEvent.click(screen.getByRole("button", { name: "前 10 章" }));
  fireEvent.click(screen.getByRole("button", { name: "向后增选 10 章" }));
  expect((screen.getByLabelText("起始章") as HTMLInputElement).value).toBe("11");
  expect((screen.getByLabelText("结束章") as HTMLInputElement).value).toBe("20");
  fireEvent.click(screen.getByRole("button", { name: "合并整批" }));
  fireEvent.click(screen.getByRole("button", { name: "建立完整拆书工作台" }));

  await waitFor(() =>
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/build"),
      expect.objectContaining({ body: expect.stringContaining('"from":11,"to":20') }),
    ),
  );
  const call = fetchJson.mock.calls.find(([u, init]) => String(u).endsWith("/build") && init?.method === "POST");
  expect(JSON.parse(call?.[1]?.body as string)).toMatchObject({ filePath: "参考.txt", dissectMode: "merged", useModel: false });
});

it("支持通过本地文件选择器上传 multipart 建库", async () => {
  const fetchJson = client();
  render(<DissectLibraryPanel bookId="book" fetchJson={fetchJson} />);
  fireEvent.click(screen.getByRole("button", { name: /导入参考书/ }));

  const input = screen.getByLabelText("选择本地小说文件") as HTMLInputElement;
  const file = new File(["第一章\n风起青萍。"], "神作.txt", { type: "text/plain" });
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText(/已选：神作\.txt/);
  fireEvent.click(screen.getByRole("button", { name: "建立完整拆书工作台" }));

  await waitFor(() =>
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/build"),
      expect.objectContaining({ method: "POST" }),
    ),
  );
  const uploadCall = fetchJson.mock.calls.find(([u, init]) => String(u).endsWith("/build") && init?.body instanceof FormData);
  expect(uploadCall).toBeTruthy();
});

it("向后增选使用已选终点", () => {
  expect(nextDissectSelection({ preset: "first5" })).toEqual({ preset: "range", from: 6, to: 15 });
});
