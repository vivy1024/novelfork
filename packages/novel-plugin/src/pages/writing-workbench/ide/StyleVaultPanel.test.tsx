import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchJson = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  invalidateApiPaths: vi.fn(),
  useApi: (path: string | null) => {
    if (path?.endsWith("/style/vault")) {
      return {
        data: {
          chapters: [
            { chapterNumber: 1, title: "雨夜", hasAiDraft: true, share: { aiChars: 60, authorChars: 40, totalChars: 100, authorRatio: 0.4 } },
            { chapterNumber: 2, title: "手写", hasAiDraft: false },
          ],
          overallAuthorRatio: 0.4,
        },
        loading: false,
        error: null,
      };
    }
    if (path?.endsWith("/style/vault/chapters/1")) {
      return {
        data: { revisionPairs: [{ aiText: "“末班车还来吗？”她问。", authorText: "“车还来吗？”她问。", similarity: 0.43 }] },
        loading: false,
        error: null,
      };
    }
    return { data: null, loading: false, error: null };
  },
}));

import { StyleVaultPanel } from "./StyleVaultPanel";

afterEach(() => { cleanup(); fetchJson.mockReset(); });

describe("StyleVaultPanel", () => {
  it("显示全书与每章作者改动占比，只列有 AI 原稿的章", () => {
    render(<StyleVaultPanel bookId="book-1" />);
    expect(screen.getByText("全书作者改动 40%")).toBeTruthy();
    expect(screen.getByText(/第 1 章 · 雨夜/)).toBeTruthy();
    expect(screen.queryByText(/第 2 章 · 手写/)).toBeNull();
  });

  it("勾选改稿段后带预设版本号采纳，并选定场景类型", async () => {
    fetchJson.mockImplementation(async (path: string) => (path.endsWith("/style/preset") ? { revision: "rev-1" } : { ok: true }));
    render(<StyleVaultPanel bookId="book-1" />);
    fireEvent.click(screen.getByText(/第 1 章 · 雨夜/));

    const adopt = screen.getByRole("button", { name: /采纳为范文/ });
    expect((adopt as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("选中第 1 章改稿段 1"));
    fireEvent.change(screen.getByLabelText("第 1 章改稿段 1 的场景类型"), { target: { value: "dialogue" } });
    fireEvent.click(adopt);

    expect(await screen.findByText(/已把 1 段改稿采纳为本书范文/)).toBeTruthy();
    const call = fetchJson.mock.calls.find(([path]) => String(path).endsWith("/style/vault/adopt"))!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      expectedRevision: "rev-1",
      samples: [{ chapterNumber: 1, authorText: "“车还来吗？”她问。", aiText: "“末班车还来吗？”她问。", sceneType: "dialogue" }],
    });
  });
});
