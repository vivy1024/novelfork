import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchJson } from "@/hooks/use-api";
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

vi.mock("@/hooks/use-api", () => ({
  fetchJson: vi.fn(),
}));

const mockedFetchJson = vi.mocked(fetchJson);

const rawEntry = {
  id: "entry/one",
  collectionId: "collection-1",
  title: "世界规则",
  slug: "world-rules",
  currentRevisionId: "revision-1",
  tagsJson: ["世界观"],
  keywordsJson: ["灵力"],
  metadataJson: { source: "manual" },
  currentContent: "# 世界规则",
  status: "active",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z",
} as const;

describe("knowledge-client Runtime contract", () => {
  beforeEach(() => {
    mockedFetchJson.mockReset();
  });

  it("uses the authenticated /api/knowledge collection, list, search and detail paths", async () => {
    mockedFetchJson
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...rawEntry, currentContent: undefined }])
      .mockResolvedValueOnce(rawEntry);

    await listKnowledgeCollections();
    const summaries = await listKnowledgeEntries({ collectionId: "collection/one", query: "世界 规则" });
    const detail = await getKnowledgeEntry("entry/one");

    expect(mockedFetchJson).toHaveBeenNthCalledWith(1, "/api/knowledge/collections");
    expect(mockedFetchJson).toHaveBeenNthCalledWith(
      2,
      "/api/knowledge/entries?collectionId=collection%2Fone&q=%E4%B8%96%E7%95%8C+%E8%A7%84%E5%88%99",
    );
    expect(mockedFetchJson).toHaveBeenNthCalledWith(3, "/api/knowledge/entries/entry%2Fone");
    expect(summaries[0]?.tags).toEqual(["世界观"]);
    expect(detail).toMatchObject({
      title: "世界规则",
      currentContent: "# 世界规则",
      tags: ["世界观"],
      keywords: ["灵力"],
      metadata: { source: "manual" },
    });
  });

  it("writes collections, entries, metadata, revisions and deletion through the real methods", async () => {
    mockedFetchJson
      .mockResolvedValueOnce({
        id: "collection-1",
        name: "设定集",
        slug: "lore",
        description: null,
        projectId: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      })
      .mockResolvedValueOnce(rawEntry)
      .mockResolvedValueOnce(rawEntry)
      .mockResolvedValueOnce({ entryId: "entry/one", revisionId: "revision-2", version: 2 })
      .mockResolvedValueOnce({ ok: true });

    await createKnowledgeCollection({ name: "设定集", description: "世界设定" });
    await createKnowledgeEntry({
      collectionId: "collection-1",
      title: "世界规则",
      content: "初稿",
      format: "markdown",
    });
    await updateKnowledgeEntry("entry/one", {
      title: "世界规则（修订）",
      tags: ["世界观"],
      status: "active",
    });
    await addKnowledgeRevision("entry/one", {
      content: "第二稿",
      format: "markdown",
      changeNote: "补充规则",
    });
    await deleteKnowledgeEntry("entry/one");

    expect(mockedFetchJson).toHaveBeenNthCalledWith(
      1,
      "/api/knowledge/collections",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(mockedFetchJson.mock.calls[0]?.[1]?.body))).toEqual({
      name: "设定集",
      description: "世界设定",
    });

    expect(mockedFetchJson).toHaveBeenNthCalledWith(
      2,
      "/api/knowledge/entries",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(mockedFetchJson.mock.calls[1]?.[1]?.body))).toMatchObject({
      collectionId: "collection-1",
      title: "世界规则",
      content: "初稿",
      format: "markdown",
    });

    expect(mockedFetchJson).toHaveBeenNthCalledWith(
      3,
      "/api/knowledge/entries/entry%2Fone",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(mockedFetchJson).toHaveBeenNthCalledWith(
      4,
      "/api/knowledge/entries/entry%2Fone/revisions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockedFetchJson).toHaveBeenNthCalledWith(
      5,
      "/api/knowledge/entries/entry%2Fone",
      { method: "DELETE" },
    );
  });
});
