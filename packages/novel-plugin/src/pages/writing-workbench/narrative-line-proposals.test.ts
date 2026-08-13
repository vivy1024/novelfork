/**
 * 叙事线 proposal 前端通道。
 *
 * 固定三件已经出过问题的事：
 * 1. 删除必须走 removeNodeIds —— 早先前端发 `{ id, _delete: true }`，服务端
 *    会把它当新增节点，作者点删除反而多出一个占位节点；
 * 2. 服务端 explanation 必须原样带到作者面前，不能按 code 自造文案；
 * 3. 存在阻断级告警时不静默应用（例如删除章节派生节点根本不会生效）。
 */

import { describe, expect, it } from "vitest";

import {
  fetchNarrativeLineApprovals,
  proposeNarrativeLineChange,
  submitNarrativeLineChange,
  type JsonFetch,
} from "./narrative-line-proposals";

const BOOK_ID = "book/1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Recorded {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

function recorder(handlers: Record<string, (body: Record<string, unknown>) => Response>): {
  readonly fetchImpl: JsonFetch;
  readonly calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const fetchImpl: JsonFetch = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ url, body });
    const pathname = url.split("?")[0] ?? url;
    const handler = Object.entries(handlers).find(([suffix]) => pathname.endsWith(suffix))?.[1];
    if (!handler) throw new Error(`unexpected request: ${url}`);
    return handler(body);
  };
  return { fetchImpl, calls };
}

describe("proposeNarrativeLineChange", () => {
  it("encodes the book id and always sends both add and remove collections", async () => {
    const { fetchImpl, calls } = recorder({
      "/propose": () => jsonResponse({ preview: { id: "p1", summary: "s" } }),
    });

    await proposeNarrativeLineChange(BOOK_ID, {
      summary: "删除节点：旧节点",
      removeNodeIds: ["node-a"],
    }, { fetchImpl });

    expect(calls[0]?.url).toBe("/api/books/book%2F1/narrative-line/propose");
    expect(calls[0]?.body).toMatchObject({
      summary: "删除节点：旧节点",
      removeNodeIds: ["node-a"],
      nodes: [],
      edges: [],
    });
    // 绝不能退回到内联 `_delete` 语义。
    expect(JSON.stringify(calls[0]?.body)).not.toContain("_delete");
  });

  it("surfaces the server explanation instead of a generic status message", async () => {
    const { fetchImpl } = recorder({
      "/propose": () => jsonResponse({
        error: "invalid-input",
        explanation: "summary 必须是非空字符串：它是作者在审批台账里识别这条提议的唯一说明。",
      }, 400),
    });

    await expect(proposeNarrativeLineChange(BOOK_ID, { summary: "" }, { fetchImpl }))
      .rejects.toThrow("审批台账");
  });
});

describe("submitNarrativeLineChange", () => {
  it("applies an approved change when the preview has no blocking warnings", async () => {
    const { fetchImpl, calls } = recorder({
      "/propose": () => jsonResponse({ preview: { id: "p1", summary: "添加节点", warnings: [] } }),
      "/apply": () => jsonResponse({ applied: true }),
    });

    const outcome = await submitNarrativeLineChange(BOOK_ID, {
      summary: "添加节点",
      nodes: [{ id: "node-1", title: "新节点" }],
    }, { fetchImpl });

    expect(outcome.applied).toBe(true);
    expect(outcome.notice).toBe("");
    expect(calls[1]?.body).toMatchObject({ decision: "approved" });
  });

  it("keeps an informational warning visible but still applies", async () => {
    const { fetchImpl } = recorder({
      "/propose": () => jsonResponse({
        preview: {
          id: "p1",
          summary: "添加边",
          warnings: [{ severity: "info", summary: "边引用的节点可能来自现有叙事线。" }],
        },
      }),
      "/apply": () => jsonResponse({ applied: true }),
    });

    const outcome = await submitNarrativeLineChange(BOOK_ID, { summary: "添加边" }, { fetchImpl });
    expect(outcome.applied).toBe(true);
    expect(outcome.notice).toContain("1 条提示");
  });

  it("does not silently apply when the preview reports a blocking warning", async () => {
    const { fetchImpl, calls } = recorder({
      "/propose": () => jsonResponse({
        preview: {
          id: "p1",
          summary: "删除节点：第 1 章",
          removeNodeIds: ["chapter:book/1:1"],
          warnings: [{
            severity: "warning",
            summary: "节点 chapter:book/1:1 不在作者叙事线覆盖层中：删除请求不会生效。",
          }],
        },
      }),
      "/apply": () => jsonResponse({ applied: false }),
    });

    const outcome = await submitNarrativeLineChange(BOOK_ID, {
      summary: "删除节点：第 1 章",
      removeNodeIds: ["chapter:book/1:1"],
    }, { fetchImpl });

    expect(outcome.applied).toBe(false);
    expect(outcome.message).toContain("不会生效");
    // 仍要留痕：作者看过这条提议并且它没有被应用。
    expect(calls[1]?.body).toMatchObject({ decision: "rejected" });
  });
});

describe("fetchNarrativeLineApprovals", () => {
  it("passes limit and offset through for append-style pagination", async () => {
    const { fetchImpl, calls } = recorder({
      "/approvals": () => jsonResponse({ approvals: [] }),
    });

    await fetchNarrativeLineApprovals(BOOK_ID, { limit: 50, offset: 50, fetchImpl });
    expect(calls[0]?.url).toBe("/api/books/book%2F1/narrative-line/approvals?limit=50&offset=50");

    await fetchNarrativeLineApprovals(BOOK_ID, { fetchImpl });
    expect(calls[1]?.url).toBe("/api/books/book%2F1/narrative-line/approvals");
  });

  it("returns the approvals array from the payload", async () => {
    const { fetchImpl } = recorder({
      "/approvals": () => jsonResponse({ approvals: [{ previewId: "p1", summary: "添加节点" }] }),
    });

    const approvals = await fetchNarrativeLineApprovals(BOOK_ID, { fetchImpl });
    expect(approvals).toEqual([{ previewId: "p1", summary: "添加节点" }]);
  });
});
