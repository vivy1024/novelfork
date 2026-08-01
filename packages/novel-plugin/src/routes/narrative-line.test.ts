/**
 * 叙事线 proposal 审批闭环的 HTTP 契约。
 *
 * 这些用例锁住 H-2 的核心纪律：
 * - UI 调用的三个端点真的存在（此前它们全是 404，作者点「添加节点」毫无反应）；
 * - propose 只算预览，不写文件；apply 才落盘；
 * - 删除走 removeNodeIds，且删除派生节点会被告警而不是静默无效；
 * - 批准和驳回都进审批台账。
 */

import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { createNarrativeLineRouter } from "./narrative-line.js";

let bookRoot: string;
const BOOK_ID = "book-narrative-line";

function app() {
  return createNarrativeLineRouter({ resolveBookRoot: () => bookRoot });
}

function base(): string {
  return `http://localhost/api/books/${BOOK_ID}/narrative-line`;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return app().request(`${base()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readStore(): Promise<{
  nodes: Array<{ id: string }>;
  edges: Array<{ id: string }>;
  appliedMutations: Array<Record<string, unknown>>;
}> {
  const raw = await readFile(join(bookRoot, "story", "narrative_line.json"), "utf8");
  return JSON.parse(raw);
}

beforeEach(async () => {
  bookRoot = await mkdtemp(join(tmpdir(), "novelfork-narrative-line-"));
  await mkdir(join(bookRoot, "chapters"), { recursive: true });
  await writeFile(
    join(bookRoot, "chapters", "index.json"),
    JSON.stringify([{ number: 1, title: "开篇", status: "accepted", wordCount: 100 }], null, 2),
    "utf8",
  );
});

describe("GET /api/books/:bookId/narrative-line", () => {
  it("returns a snapshot instead of the 404 the workbench used to hit", async () => {
    const response = await app().request(base());
    expect(response.status).toBe(200);
    const payload = await response.json() as { snapshot?: { bookId?: string; nodes?: unknown[] } };
    expect(payload.snapshot?.bookId).toBe(BOOK_ID);
    // 章节派生节点应该在快照里。
    expect(payload.snapshot?.nodes?.length).toBeGreaterThan(0);
  });
});

describe("POST /narrative-line/propose", () => {
  it("rejects an empty summary with an author-readable explanation", async () => {
    const response = await postJson("/propose", { summary: "  " });
    expect(response.status).toBe(400);
    const payload = await response.json() as { error?: string; explanation?: string };
    expect(payload.error).toBe("invalid-input");
    expect(payload.explanation).toContain("summary");
  });

  it("previews an added node without writing the store", async () => {
    const response = await postJson("/propose", {
      summary: "添加节点：伏笔埋设",
      nodes: [{ id: "node-1", type: "foreshadow", title: "青铜铃异响" }],
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as { preview?: { nodes?: Array<{ id: string }> } };
    expect(payload.preview?.nodes?.[0]?.id).toBe("node-1");
    // propose 不落盘。
    await expect(readStore()).rejects.toThrow();
  });

  it("warns that deleting a derived chapter node cannot take effect", async () => {
    const response = await postJson("/propose", {
      summary: "删除节点：第 1 章",
      removeNodeIds: [`chapter:${BOOK_ID}:1`],
    });
    const payload = await response.json() as {
      preview?: { removeNodeIds?: string[]; warnings?: Array<{ severity: string; summary: string }> };
    };
    expect(payload.preview?.removeNodeIds).toEqual([`chapter:${BOOK_ID}:1`]);
    const warning = payload.preview?.warnings?.find((item) => item.severity === "warning");
    expect(warning?.summary).toContain("不会生效");
  });

  it("treats an inline _delete entry as a removal, not a new node", async () => {
    const response = await postJson("/propose", {
      summary: "删除节点：旧节点",
      nodes: [{ id: "legacy-node", _delete: true }],
    });
    const payload = await response.json() as { preview?: { nodes?: unknown[]; removeNodeIds?: string[] } };
    expect(payload.preview?.removeNodeIds).toEqual(["legacy-node"]);
    // 关键：不能把删除请求当成一个占位新节点写进来。
    expect(payload.preview?.nodes ?? []).toHaveLength(0);
  });
});

describe("POST /narrative-line/apply", () => {
  it("requires an explicit decision and a propose-produced preview", async () => {
    const noDecision = await postJson("/apply", { preview: { id: "p", summary: "s" } });
    expect(noDecision.status).toBe(400);
    expect((await noDecision.json() as { explanation?: string }).explanation).toContain("decision");

    const noPreview = await postJson("/apply", { decision: "approved", preview: { id: "p" } });
    expect(noPreview.status).toBe(400);
    expect((await noPreview.json() as { explanation?: string }).explanation).toContain("propose");
  });

  it("persists an approved node and records the approval", async () => {
    const preview = (await (await postJson("/propose", {
      summary: "添加节点：伏笔埋设",
      nodes: [{ id: "node-1", type: "foreshadow", title: "青铜铃异响" }],
    })).json() as { preview: unknown }).preview;

    const response = await postJson("/apply", { preview, decision: "approved", sessionId: "workbench" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ applied: true });

    const store = await readStore();
    expect(store.nodes.map((node) => node.id)).toContain("node-1");
    expect(store.appliedMutations).toHaveLength(1);
    expect(store.appliedMutations[0]).toMatchObject({ decision: "approved", summary: "添加节点：伏笔埋设" });
  });

  it("removes an author node and drops edges left dangling by it", async () => {
    const addPreview = (await (await postJson("/propose", {
      summary: "添加两个节点与一条边",
      nodes: [
        { id: "node-a", type: "event", title: "起因" },
        { id: "node-b", type: "event", title: "结果" },
      ],
      edges: [{ id: "edge-ab", fromNodeId: "node-a", toNodeId: "node-b", type: "causes" }],
    })).json() as { preview: unknown }).preview;
    await postJson("/apply", { preview: addPreview, decision: "approved" });

    const removePreview = (await (await postJson("/propose", {
      summary: "删除节点：起因",
      removeNodeIds: ["node-a"],
    })).json() as { preview: unknown }).preview;
    await postJson("/apply", { preview: removePreview, decision: "approved" });

    const store = await readStore();
    expect(store.nodes.map((node) => node.id)).not.toContain("node-a");
    expect(store.nodes.map((node) => node.id)).toContain("node-b");
    // 悬空的作者边必须一起清掉。
    expect(store.edges.map((edge) => edge.id)).not.toContain("edge-ab");
  });

  it("records a rejection without mutating nodes", async () => {
    const preview = (await (await postJson("/propose", {
      summary: "添加节点：待否决",
      nodes: [{ id: "node-rejected", type: "event", title: "不该落盘" }],
    })).json() as { preview: unknown }).preview;

    const response = await postJson("/apply", { preview, decision: "rejected", reason: "与主线冲突" });
    expect(await response.json()).toMatchObject({ applied: false, reason: "rejected" });

    const store = await readStore();
    expect(store.nodes.map((node) => node.id)).not.toContain("node-rejected");
    // 驳回也要留痕。
    expect(store.appliedMutations[0]).toMatchObject({ decision: "rejected", reason: "与主线冲突" });
  });
});

describe("GET /narrative-line/approvals", () => {
  it("returns the approval ledger newest-first and validates limit", async () => {
    for (const title of ["第一次", "第二次"]) {
      const preview = (await (await postJson("/propose", {
        summary: `添加节点：${title}`,
        nodes: [{ id: `node-${title}`, type: "event", title }],
      })).json() as { preview: unknown }).preview;
      await postJson("/apply", { preview, decision: "approved" });
    }

    const response = await app().request(`${base()}/approvals`);
    const payload = await response.json() as { approvals: Array<{ summary: string }> };
    expect(payload.approvals).toHaveLength(2);
    expect(payload.approvals[0]?.summary).toBe("添加节点：第二次");

    const bad = await app().request(`${base()}/approvals?limit=0`);
    expect(bad.status).toBe(400);
    expect((await bad.json() as { explanation?: string }).explanation).toContain("limit");
  });
});
