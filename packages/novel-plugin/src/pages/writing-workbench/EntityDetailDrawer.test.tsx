import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  readonly relations?: () => Response;
  readonly knowledge?: () => Response;
}): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
    });
    if (url.includes("/entity-graph/relations")) return options.relations?.() ?? jsonResponse({ ok: true, status: "ok", counterparts: [] });
    if (url.includes("/narrative-memory/knowledge")) return options.knowledge?.() ?? jsonResponse({ ok: true, status: "ok", state: [], knows: [], unaware: [] });
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

    fireEvent.click(await screen.findByRole("button", { name: /手动补一条/u }));
    // subject 预填当前实体。
    const subjectInput = screen.getByPlaceholderText(/角色|主体/u);
    expect((subjectInput as HTMLInputElement).value).toBe("张三");

    fireEvent.change(screen.getByPlaceholderText(/境界|谓词/u), { target: { value: "属于" } });
    fireEvent.change(screen.getByPlaceholderText(/元婴|宾语/u), { target: { value: "青云宗" } });
    // 类别是下拉：界面显示中文，存的仍是记忆通道名。
    fireEvent.change(screen.getByLabelText("类别"), { target: { value: "relationship" } });
    fireEvent.click(screen.getByRole("button", { name: "写入状态" }));

    await waitFor(() => {
      expect(calls.some((call) => call.method === "POST" && call.url.includes("/facts"))).toBe(true);
    });
    const create = calls.find((call) => call.method === "POST" && call.url.includes("/facts"))!;
    expect(create.body.subject).toBe("张三");
    expect(create.body.predicate).toBe("属于");
    expect(create.body.object).toBe("青云宗");
    expect(create.body.category).toBe("relationship");
  });

  it("资料卡只说作者的话：分类、层级、来源都是中文，不露内部代号和副标题套话", async () => {
    stubBackend({
      byEntity: () => jsonResponse({
        groups: [{
          entity: "张三",
          facts: [
            { ...FACT, id: "fact-manual", category: "character_state", sourceType: "manual", confidence: 1 },
            { ...FACT, id: "fact-settle", predicate: "位置", object: "青云宗", category: "location", sourceType: "event", confidence: 0.9 },
            { ...FACT, id: "fact-import", predicate: "身份", object: "外门弟子", category: "state", sourceType: "import", confidence: 0.8 },
          ],
        }],
      }),
      jingweiSearch: () => jsonResponse({
        results: [{ id: "entry-zhangsan", title: "张三", category: "characters", layer: "dynamic" }],
      }),
    });

    render(<EntityDetailDrawer bookId="book-1" entity="张三" onClose={() => {}} />);

    await screen.findByText("青云宗");
    expect((await screen.findByTestId("entity-hero-category")).textContent).toBe("角色");
    expect(screen.getByTestId("entity-hero-layer").textContent).toBe("随剧情变化");
    const meta = screen.getAllByTestId("entity-fact-meta").map((node) => node.textContent ?? "").join(" | ");
    expect(meta).toContain("角色状态");
    expect(meta).toContain("作者手填");
    expect(meta).toContain("章后结算");
    expect(meta).toContain("导入");
    const body = document.body.textContent ?? "";
    for (const raw of ["characters", "dynamic", "manual", "character_state", "置信", "酒馆式", "当前动态时态", "新增状态"]) {
      expect(body).not.toContain(raw);
    }
    // 置信度都不低：不提示「不太确定」，也不显示百分比。
    expect(screen.queryByTestId("entity-fact-low-confidence")).toBeNull();
    expect(body).not.toMatch(/\d+%/u);
  });

  it("置信度偏低时才提示「不太确定」", async () => {
    stubBackend({
      byEntity: () => jsonResponse({
        groups: [{ entity: "张三", facts: [{ ...FACT, confidence: 0.4 }] }],
      }),
    });

    render(<EntityDetailDrawer bookId="book-1" entity="张三" onClose={() => {}} />);

    expect((await screen.findByTestId("entity-fact-low-confidence")).textContent).toBe("不太确定");
    expect(document.body.textContent).not.toContain("40%");
  });

  it("设定页的条目徽标同样显示中文分类与层级（兼容旧分类名）", async () => {
    stubBackend({
      byEntity: () => jsonResponse({ groups: [] }),
      jingweiSearch: () => jsonResponse({
        results: [{ id: "entry-zhangsan", title: "张三", category: "character", layer: "canon" }],
      }),
    });

    render(<EntityDetailDrawer bookId="book-1" entity="张三" onClose={() => {}} />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "设定" }));
    const hit = await screen.findByTestId("jingwei-entry-hit");
    expect(hit.textContent).toContain("角色");
    expect(hit.textContent).toContain("固定设定");
    expect(hit.textContent).not.toContain("canon");
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
    expect(screen.getByText(/这条设定不存在，或还没载入/u)).toBeTruthy();
  });

  it("关系页按经纬条目 id 读实体索引里的关系，不按名字匹配", async () => {
    const calls = stubBackend({
      byEntity: () => jsonResponse({ groups: [] }),
      relations: () => jsonResponse({
        ok: true,
        status: "ok",
        entity: { id: "ent:book-1:entry-zhangsan", name: "张三" },
        counterparts: [{
          entity: { id: "ent:book-1:entry-lisi", name: "李四", entryId: "entry-lisi" },
          current: [{ relationId: "r1", subjectId: "ent:book-1:entry-zhangsan", objectId: "ent:book-1:entry-lisi", predicate: "结盟", validFrom: 5, validTo: null, active: true, evidence: "从今往后同进退", polarity: { label: "紧密" } }],
          history: [{ relationId: "r1", subjectId: "ent:book-1:entry-zhangsan", objectId: "ent:book-1:entry-lisi", predicate: "结盟", validFrom: 5, validTo: null, active: true, evidence: "从今往后同进退", polarity: { label: "紧密" } }],
          trend: { kind: "insufficient", label: "数据不足", explanation: "共 1 条关系记录。" },
          sharedEvents: 1,
        }],
      }),
    });

    render(<EntityDetailDrawer bookId="book-1" entity="张三" entryId="entry-zhangsan" onClose={() => {}} />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "关系" }));
    const card = await screen.findByTestId("entity-relation-counterpart");
    expect(card.textContent).toContain("李四");
    expect(card.textContent).toContain("结盟");
    expect(card.textContent).toContain("数据不足");
    const call = calls.find((item) => item.url.includes("/entity-graph/relations"))!;
    expect(call.url).toContain("entryId=entry-zhangsan");
    fireEvent.click(card.querySelector("button")!);
    expect((await screen.findByText(/从今往后同进退/u)).textContent).toContain("依据");
  });

  it("只有名字时按经纬标题精确找条目；找不到就说明原因", async () => {
    const calls = stubBackend({
      byEntity: () => jsonResponse({ groups: [] }),
      jingweiSearch: () => jsonResponse({ results: [{ id: "entry-zhangsan", title: "张三（主角）" }] }),
    });
    const first = render(<EntityDetailDrawer bookId="book-1" entity="张三" onClose={() => {}} />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "关系" }));
    await waitFor(() => expect(calls.some((item) => item.url.includes("/entity-graph/relations?entryId=entry-zhangsan"))).toBe(true));
    first.unmount();

    const misses = stubBackend({
      byEntity: () => jsonResponse({ groups: [] }),
      jingweiSearch: () => jsonResponse({ results: [{ id: "entry-zhangsanfeng", title: "张三丰" }] }),
    });
    render(<EntityDetailDrawer bookId="book-1" entity="张三" onClose={() => {}} />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "关系" }));
    const explanation = await screen.findByTestId("entity-relations-explanation");
    expect(explanation.textContent).toContain("经纬里没有标题或别名正好是「张三」的条目");
    expect(misses.some((item) => item.url.includes("/entity-graph/relations"))).toBe(false);
  });

  it("知情 tab 按经纬条目 id 读知情账，只读展示「知道 / 不知道 / 现状」", async () => {
    const calls = stubBackend({
      byEntity: () => jsonResponse({ groups: [] }),
      jingweiSearch: () => jsonResponse({ results: [{ id: "entry-zhangsan", title: "张三" }] }),
      knowledge: () => jsonResponse({
        ok: true,
        status: "ok",
        chapter: 5,
        entity: { id: "ent:book-1:entry-zhangsan", name: "张三", type: "character" },
        state: [{ fluent: "境界", value: "金丹", chapter: 3 }],
        knows: [{ factId: "f-1", subject: "张三", predicate: "境界", object: "金丹", category: "character_state", chapter: 3, evidence: null, confidence: 0.9 }],
        unaware: [{ factId: "f-2", subject: "方工", predicate: "身份", object: "内鬼", category: "world_fact", chapter: 4, evidence: null, confidence: 0.9 }],
      }),
    });

    render(<EntityDetailDrawer bookId="book-1" entity="张三" onClose={() => {}} currentChapter={5} />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "知情" }));

    await screen.findByTestId("knowledge-tab");
    const call = calls.find((item) => item.url.includes("/narrative-memory/knowledge"))!;
    expect(call.url).toContain("entryId=entry-zhangsan");
    expect(call.url).toContain("chapter=5");
    // 现状 + 他知道 + 他还不知道（写作禁忌）
    expect(screen.getByTestId("knowledge-state-list").textContent).toContain("金丹");
    expect(screen.getByTestId("knowledge-knows-list").textContent).toContain("张三 · 境界 → 金丹");
    expect(screen.getByTestId("knowledge-unaware-list").textContent).toContain("方工 · 身份 → 内鬼");
    // 只读：知情区块不提供纠正 / 作废 / 新增操作
    const tab = screen.getByTestId("knowledge-tab");
    expect(tab.querySelector("button[type='submit']")).toBeNull();
    expect(within(tab).queryByText("纠正")).toBeNull();
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
