import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EntityDetailDrawer } from "./EntityDetailDrawer";

/**
 * 实体详情抽屉。
 *
 * 这个抽屉的存在理由是「打通经纬与叙事记忆孤岛 + 让作者能就地补/改状态」。
 * 测试盯住四件事：
 * 1. 真的打了 /facts/by-entity 并按实体名取当前状态；
 * 2. 纠正 / 作废 / 新增三个操作走 fact 编辑端点（PUT /correct、DELETE、POST /facts）；
 * 3. 设定 tab 打 /jingwei/search 并给跳转；
 * 4. 加载 / 空 / 错误三态不留白。
 *
 * 本包没开 vitest globals，必须手动 cleanup。
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FACT = {
  id: "fact-1",
  subject: "张三",
  predicate: "境界",
  object: "金丹",
  category: "state",
  sourceType: "event",
  confidence: 0.9,
  validFromChapter: 73,
};

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

type FetchCall = { url: string; method: string; body: Record<string, unknown> };

/** 装一个只认识实体抽屉相关端点的假后端。 */
function stubBackend(options: {
  readonly byEntity: () => Response;
  readonly jingweiSearch?: () => Response;
  readonly mutation?: () => Response;
  readonly history?: () => Response;
}): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
    });
    if (url.includes("/facts/by-entity")) return options.byEntity();
    if (url.includes("/jingwei/search")) return options.jingweiSearch?.() ?? jsonResponse({ results: [] });
    if (url.includes("/history")) return options.history?.() ?? jsonResponse({ items: [] });
    return options.mutation?.() ?? jsonResponse({ summary: "ok" });
  }));
  return calls;
}

describe("EntityDetailDrawer", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads facts by entity and shows the matching group", async () => {
    stubBackend({
      byEntity: () => jsonResponse({
        groups: [
          { entity: "李四", facts: [] },
          { entity: "张三", facts: [FACT] },
        ],
      }),
    });

    render(<EntityDetailDrawer bookId="book-1" entity="张三" onClose={() => {}} />);

    await screen.findByText("金丹");
    expect(screen.getAllByText("张三").length).toBeGreaterThan(0);
    expect(screen.getByTestId("entity-fact-row").textContent).toContain("境界");
    // 只取张三那一组，不显示李四的空组。
    expect(screen.queryByText("李四")).toBeNull();
  });

  it("shows a positive empty state when the entity has no facts", async () => {
    stubBackend({
      byEntity: () => jsonResponse({ groups: [] }),
    });

    render(<EntityDetailDrawer bookId="book-1" entity="张三" onClose={() => {}} />);

    await screen.findByText(/还没有记忆状态/u);
  });

  it("surfaces a retryable error when facts fail to load", async () => {
    const calls = stubBackend({
      byEntity: () => jsonResponse({ error: "storage-unavailable" }, { status: 500 }),
    });

    render(<EntityDetailDrawer bookId="book-1" entity="张三" onClose={() => {}} />);

    await screen.findByTestId("entity-drawer-error");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => {
      expect(calls.filter((call) => call.url.includes("/facts/by-entity")).length).toBe(2);
    });
  });

  it("corrects a fact with editable subject/predicate/category/object fields", async () => {
    const calls = stubBackend({
      byEntity: () => jsonResponse({ groups: [{ entity: "张三", facts: [FACT] }] }),
      mutation: () => jsonResponse({ summary: "已纠正" }),
    });

    render(<EntityDetailDrawer bookId="book-1" entity="张三" onClose={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "纠正" }));
    // 表单预填旧值，作者可改主体/谓词/宾语/类别。
    fireEvent.change(screen.getByPlaceholderText(/角色|主体/u), { target: { value: "王五" } });
    fireEvent.change(screen.getByPlaceholderText(/境界|谓词/u), { target: { value: "修为" } });
    fireEvent.click(screen.getByRole("button", { name: "保存纠正" }));

    await waitFor(() => {
      expect(calls.some((call) => call.method === "PUT")).toBe(true);
    });
    const correction = calls.find((call) => call.method === "PUT")!;
    expect(correction.url).toBe("/api/books/book-1/narrative-memory/facts/fact-1/correct");
    expect(correction.body.subject).toBe("王五");
    expect(correction.body.predicate).toBe("修为");
    expect(correction.body.object).toBe("金丹");
  });

  it("retires a fact in place", async () => {
    const calls = stubBackend({
      byEntity: () => jsonResponse({ groups: [{ entity: "张三", facts: [FACT] }] }),
      mutation: () => jsonResponse({ summary: "已作废" }),
    });

    render(<EntityDetailDrawer bookId="book-1" entity="张三" onClose={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: /作废/u }));

    await waitFor(() => {
      expect(calls.some((call) => call.method === "DELETE")).toBe(true);
    });
    const retire = calls.find((call) => call.method === "DELETE")!;
    expect(retire.url).toBe("/api/books/book-1/narrative-memory/facts/fact-1");
  });

  it("creates a new fact with the current entity pre-filled", async () => {
    const calls = stubBackend({
      byEntity: () => jsonResponse({ groups: [] }),
      mutation: () => jsonResponse({ summary: "已写入" }),
    });

    render(<EntityDetailDrawer bookId="book-1" entity="张三" onClose={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: /新增状态/u }));
    // subject 预填当前实体。
    const subjectInput = screen.getByPlaceholderText(/角色|主体/u);
    expect((subjectInput as HTMLInputElement).value).toBe("张三");

    fireEvent.change(screen.getByPlaceholderText(/境界|谓词/u), { target: { value: "属于" } });
    fireEvent.change(screen.getByPlaceholderText(/元婴|宾语/u), { target: { value: "青云宗" } });
    fireEvent.change(screen.getByPlaceholderText(/state|类别/u), { target: { value: "faction" } });
    fireEvent.click(screen.getByRole("button", { name: "写入状态" }));

    await waitFor(() => {
      expect(calls.some((call) => call.method === "POST" && call.url.includes("/facts"))).toBe(true);
    });
    const create = calls.find((call) => call.method === "POST" && call.url.includes("/facts"))!;
    expect(create.body.subject).toBe("张三");
    expect(create.body.predicate).toBe("属于");
    expect(create.body.object).toBe("青云宗");
  });

  it("queries jingwei entries by entity name on the lore tab", async () => {
    const calls = stubBackend({
      byEntity: () => jsonResponse({ groups: [] }),
      jingweiSearch: () => jsonResponse({
        results: [{ id: "entry-zhangsan", title: "张三", category: "character", layer: "canon", status: "confirmed" }],
      }),
    });

    render(<EntityDetailDrawer bookId="book-1" entity="张三" onClose={() => {}} />);

    const loreTab = await screen.findByRole("tab", { name: "设定" });
    fireEvent.mouseDown(loreTab);
    await waitFor(() => expect(calls.some((call) => call.url.includes("/jingwei/search?q="))).toBe(true));
    await screen.findByTestId("jingwei-entry-hit");
  });

  it("wires the jingwei open handler and reports when the entry is not loaded", async () => {
    stubBackend({
      byEntity: () => jsonResponse({ groups: [] }),
      jingweiSearch: () => jsonResponse({
        results: [{ id: "entry-zhangsan", title: "张三" }],
      }),
    });
    const onOpenJingweiEntry = vi.fn().mockReturnValue(false);

    render(<EntityDetailDrawer bookId="book-1" entity="张三" onClose={() => {}} onOpenJingweiEntry={onOpenJingweiEntry} />);

    fireEvent.mouseDown(await screen.findByRole("tab", { name: "设定" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开编辑" }));
    expect(onOpenJingweiEntry).toHaveBeenCalledWith("entry-zhangsan");
    expect(screen.getByText(/经纬条目不存在或尚未载入/u)).toBeTruthy();
  });

  it("closes via the sheet onOpenChange when false", async () => {
    stubBackend({ byEntity: () => jsonResponse({ groups: [] }) });
    const onClose = vi.fn();

    render(<EntityDetailDrawer bookId="book-1" entity="张三" onClose={onClose} />);
    await screen.findByText(/还没有记忆状态/u);

    // 点关闭按钮触发 Sheet 的 onOpenChange(false)。
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
