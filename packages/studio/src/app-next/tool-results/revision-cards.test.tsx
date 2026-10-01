import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChapterRevisionCard } from "./ChapterRevisionCard";
import { LoreProposalCard } from "./LoreProposalCard";

const revisionArtifact = {
  kind: "chapter-revision",
  id: "rev-1",
  bookId: "book-1",
  chapterNumber: 3,
  reason: "把冲突提前，让守擂失利落地",
  originalHash: "a".repeat(64),
  originalExists: true,
  originalPreview: "原来的第 3 章正文……",
  newPreview: "改后的第 3 章正文……",
  stats: { originalChars: 2400, newChars: 2600, unchangedParagraphs: 14, removedParagraphs: 2, addedParagraphs: 3 },
  newText: "改后的第 3 章正文……（全文）",
};

const loreArtifact = {
  kind: "lore-update",
  id: "lore-1",
  bookId: "book-1",
  entryId: "entry-1",
  entryTitle: "林舟",
  category: "characters",
  reason: "突破筑基",
  fieldsPatch: { cultivation: "筑基" },
  before: { cultivation: "练气" },
};

vi.mock("@/hooks/use-api", () => ({
  fetchJson: vi.fn(async () => ({ ok: true })),
}));

import { fetchJson } from "@/hooks/use-api";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("整章改动候选卡", () => {
  it("显示原因、差异统计与前后预览，「采用」把 originalHash 与新正文发给 apply 接口", async () => {
    render(
      <ChapterRevisionCard
        toolName="chapter.propose_revision"
        result={{ renderer: "chapter.revision", data: { artifact: revisionArtifact } }}
      />,
    );

    expect(screen.getByTestId("chapter-revision-reason").textContent).toContain("冲突提前");
    expect(screen.getByTestId("chapter-revision-stats").textContent).toContain("2400");
    expect(screen.getByTestId("chapter-revision-stats").textContent).toContain("删 2 段");
    expect(screen.getByTestId("chapter-revision-original").textContent).toContain("原来的第 3 章正文");
    expect(screen.getByTestId("chapter-revision-new").textContent).toContain("改后的第 3 章正文");

    fireEvent.click(screen.getByTestId("chapter-revision-apply"));
    await waitFor(() => expect(vi.mocked(fetchJson)).toHaveBeenCalledTimes(1));
    const [url, init] = vi.mocked(fetchJson).mock.calls[0]!;
    expect(url).toBe("/api/books/book-1/chapters/3/revision-apply");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      originalHash: "a".repeat(64),
      content: revisionArtifact.newText,
    });
    await waitFor(() => expect(screen.getByTestId("chapter-revision-applied")).toBeTruthy());
  });
});

describe("设定改动候选卡", () => {
  it("按字段显示改前/改后，「采用」走 PUT fieldsPatch 不重写条目", async () => {
    render(
      <LoreProposalCard
        toolName="lore.propose_update"
        result={{ renderer: "lore.update-proposal", data: { artifact: loreArtifact } }}
      />,
    );

    expect(screen.getByTestId("lore-update-reason").textContent).toContain("突破筑基");
    const fields = screen.getByTestId("lore-update-fields");
    expect(fields.textContent).toContain("cultivation");
    expect(fields.textContent).toContain("改前：练气");
    expect(fields.textContent).toContain("改后：筑基");

    fireEvent.click(screen.getByTestId("lore-update-apply"));
    await waitFor(() => expect(vi.mocked(fetchJson)).toHaveBeenCalledTimes(1));
    const [url, init] = vi.mocked(fetchJson).mock.calls[0]!;
    expect(url).toBe("/api/books/book-1/jingwei/entries/entry-1");
    expect((init as RequestInit).method).toBe("PUT");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ fieldsPatch: { cultivation: "筑基" } });
    await waitFor(() => expect(screen.getByTestId("lore-update-applied")).toBeTruthy());
  });
});
