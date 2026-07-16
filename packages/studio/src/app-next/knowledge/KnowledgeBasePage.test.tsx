import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addKnowledgeRevision,
  createKnowledgeCollection,
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  getKnowledgeEntry,
  listKnowledgeCollections,
  listKnowledgeEntries,
  updateKnowledgeEntry,
} from "../runtime-admin/knowledge";
import { KnowledgeBasePage } from "./KnowledgeBasePage";

vi.mock("../runtime-admin/knowledge", () => ({
  addKnowledgeRevision: vi.fn(),
  createKnowledgeCollection: vi.fn(),
  createKnowledgeEntry: vi.fn(),
  deleteKnowledgeEntry: vi.fn(),
  getKnowledgeEntry: vi.fn(),
  listKnowledgeCollections: vi.fn(),
  listKnowledgeEntries: vi.fn(),
  updateKnowledgeEntry: vi.fn(),
}));

const collection = {
  id: "collection-1",
  name: "设定集",
  slug: "lore",
  description: "世界设定",
  projectId: null,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z",
} as const;

const summary = {
  id: "entry-1",
  collectionId: "collection-1",
  title: "灵力体系",
  slug: "power-system",
  currentRevisionId: "revision-1",
  tags: ["世界观"],
  status: "active",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z",
} as const;

const detail = {
  ...summary,
  currentContent: "灵力分为九阶。",
  keywords: ["灵力", "九阶"],
  metadata: { source: "author" },
} as const;

const mockedListCollections = vi.mocked(listKnowledgeCollections);
const mockedListEntries = vi.mocked(listKnowledgeEntries);
const mockedGetEntry = vi.mocked(getKnowledgeEntry);

beforeEach(() => {
  vi.mocked(addKnowledgeRevision).mockReset();
  vi.mocked(createKnowledgeCollection).mockReset();
  vi.mocked(createKnowledgeEntry).mockReset();
  vi.mocked(deleteKnowledgeEntry).mockReset();
  vi.mocked(updateKnowledgeEntry).mockReset();
  mockedListCollections.mockReset();
  mockedListEntries.mockReset();
  mockedGetEntry.mockReset();

  mockedListCollections.mockResolvedValue([collection]);
  mockedListEntries.mockResolvedValue([summary]);
  mockedGetEntry.mockResolvedValue(detail);
});

afterEach(() => cleanup());

describe("KnowledgeBasePage", () => {
  it("loads collections and entries, applies Runtime filters, and fetches entry content on demand", async () => {
    render(<KnowledgeBasePage />);

    expect(await screen.findByRole("button", { name: "灵力体系" })).toBeTruthy();
    expect(mockedListCollections).toHaveBeenCalled();
    expect(mockedListEntries).toHaveBeenCalledWith({ collectionId: undefined, query: undefined });

    fireEvent.click(screen.getByRole("button", { name: "设定集" }));
    await waitFor(() => {
      expect(mockedListEntries).toHaveBeenCalledWith({ collectionId: "collection-1", query: undefined });
    });

    fireEvent.change(screen.getByRole("textbox", { name: "搜索知识条目" }), {
      target: { value: "九阶" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => {
      expect(mockedListEntries).toHaveBeenCalledWith({ collectionId: "collection-1", query: "九阶" });
    });

    fireEvent.click(screen.getByRole("button", { name: "灵力体系" }));
    expect(await screen.findByText("灵力分为九阶。")).toBeTruthy();
    expect(mockedGetEntry).toHaveBeenCalledWith("entry-1");
  });

  it("shows a truthful retryable failure state when Runtime knowledge loading fails", async () => {
    mockedListCollections
      .mockRejectedValueOnce(new Error("503 Runtime unavailable"))
      .mockResolvedValueOnce([collection]);
    mockedListEntries.mockResolvedValue([summary]);

    render(<KnowledgeBasePage />);

    expect(await screen.findByText("503 Runtime unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(mockedListCollections).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByRole("button", { name: "灵力体系" })).toBeTruthy();
  });
});
