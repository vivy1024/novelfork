import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-api", () => ({ fetchJson: fetchJsonMock }));

import {
  filterLearningDocs,
  groupLearningDocs,
  learningClient,
  toStudioActionHref,
  type LearningDocSummary,
} from "./client";

const docs: LearningDocSummary[] = [
  {
    id: "overview",
    category: "start",
    title: "一页理解 NarraFork",
    summary: "核心概念",
    tags: ["intro", "workflow"],
    actions: [],
  },
  {
    id: "routines",
    category: "automation",
    title: "套路",
    summary: "可复用自动化流程",
    tags: ["automation"],
    actions: [],
  },
];

describe("learningClient", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset().mockResolvedValue({});
  });

  it("uses the Runtime learning index, detail, and search paths with encoded parameters", async () => {
    await learningClient.getIndex("zh-CN");
    await learningClient.getDoc("doc/with space", "zh-CN");
    await learningClient.searchDocs("plan mode", "zh-CN");

    expect(fetchJsonMock.mock.calls.map(([path]) => path)).toEqual([
      "/learning?lang=zh-CN",
      "/learning/doc%2Fwith%20space?lang=zh-CN",
      "/learning/search?q=plan%20mode&lang=zh-CN",
    ]);
  });
});

describe("learning data transformations", () => {
  it("matches the original summary-field search semantics", () => {
    expect(filterLearningDocs(docs, "WORKFLOW").map((doc) => doc.id)).toEqual(["overview"]);
    expect(filterLearningDocs(docs, "可复用").map((doc) => doc.id)).toEqual(["routines"]);
    expect(filterLearningDocs(docs, "  ")).toBe(docs);
  });

  it("keeps Runtime category order and preserves unknown categories", () => {
    expect(groupLearningDocs(
      [
        { id: "start", label: "从这里开始", description: "入门" },
        { id: "empty", label: "空分类", description: "" },
      ],
      [...docs, { ...docs[0], id: "other", category: "extension", title: "扩展" }],
    )).toEqual([
      {
        category: { id: "start", label: "从这里开始", description: "入门" },
        docs: [docs[0]],
      },
      {
        category: { id: "automation", label: "automation", description: "" },
        docs: [docs[1]],
      },
      {
        category: { id: "extension", label: "extension", description: "" },
        docs: [expect.objectContaining({ id: "other" })],
      },
    ]);
  });

  it("translates canonical Runtime actions into the StudioNext product shell", () => {
    expect(toStudioActionHref("/settings/models")).toBe("/next/settings/models");
    expect(toStudioActionHref("/routines/tool-permissions")).toBe("/next/routines");
    expect(toStudioActionHref("/narrators/archived")).toBe("/next/sessions");
    expect(toStudioActionHref("/search")).toBe("/next/search");
    expect(toStudioActionHref("https://example.com/docs")).toBe("https://example.com/docs");
  });
});
