import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WriteViewPanel } from "./WriteViewPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 一份可写状态的 write.preflight 返回体，让面板过掉门禁进入正常渲染。 */
const READY_PREFLIGHT = {
  ok: true,
  chapterNumber: 32,
  resolvedDirective: "让林舟通过守门人试炼，并暴露旧伤。",
  blockers: [],
  warningItems: [],
  recentChapters: [{ number: 31, summary: "青云峰大战" }],
};

const CURRENT_EVENT = {
  id: "event-current",
  eventType: "hook_planted",
  entity: "青云剑残片",
  risk: "high",
  confidence: 0.9,
  chapterNumber: 32,
  evidence: "守门人盯着他腰间那截断剑。",
};

const EARLIER_EVENT = {
  id: "event-earlier",
  eventType: "state_changed",
  entity: "林舟",
  risk: "low",
  confidence: 0.6,
  chapterNumber: 30,
  evidence: "左臂仍未痊愈。",
};

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

/** 只有 pending events 走 fetch；preflight 走注入的 callTool。 */
function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function renderPanel(overrides: Partial<Parameters<typeof WriteViewPanel>[0]> = {}) {
  return render(
    <WriteViewPanel
      bookId="book-1"
      callTool={async () => READY_PREFLIGHT}
      {...overrides}
    />,
  );
}

describe("WriteViewPanel 本章提议", () => {
  beforeEach(() => {
    stubFetch(() => jsonResponse({ events: [CURRENT_EVENT, EARLIER_EVENT] }));
  });

  it("读取书籍作用域的待审队列", async () => {
    const spy = stubFetch(() => jsonResponse({ events: [] }));

    renderPanel();

    await waitFor(() => {
      expect(spy.mock.calls.map(([input]) => String(input))).toContain(
        "/api/books/book-1/narrative-memory/events/pending?limit=100",
      );
    });
  });

  it("展示本章提议的实体、章号、风险与正文依据", async () => {
    renderPanel();

    const section = await screen.findByTestId("write-proposals");
    expect(within(section).getByText(/本章提议/)).toBeTruthy();
    expect(within(section).getByText("青云剑残片")).toBeTruthy();
    expect(within(section).getByText(/第 32 章/)).toBeTruthy();
    expect(within(section).getByText("高风险")).toBeTruthy();
    expect(within(section).getByText("守门人盯着他腰间那截断剑。")).toBeTruthy();
  });

  it("说明提议不阻断写作，避免作者以为必须清空才能写", async () => {
    renderPanel();

    const section = await screen.findByTestId("write-proposals");
    expect(within(section).getByText(/不处理也不阻断写作/)).toBeTruthy();
  });

  it("把往前章节遗留的提议折叠，展开后才显示", async () => {
    renderPanel();

    const toggle = await screen.findByTestId("write-proposals-earlier-toggle");
    expect(toggle.textContent).toContain("另有 1 条前面章节遗留");
    expect(screen.queryByText("林舟")).toBeNull();

    fireEvent.click(toggle);

    expect(screen.getByText("林舟")).toBeTruthy();
    expect(screen.getByText("左臂仍未痊愈。")).toBeTruthy();
  });

  it("统计跨分组的高风险条数", async () => {
    stubFetch(() => jsonResponse({
      events: [CURRENT_EVENT, { ...EARLIER_EVENT, risk: "high" }],
    }));

    renderPanel();

    const section = await screen.findByTestId("write-proposals");
    expect(within(section).getByText("高风险 2")).toBeTruthy();
  });

  it("确认时带写作视图来源的理由，并刷新队列", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let listCount = 0;
    stubFetch((url, init) => {
      calls.push({ url, init });
      if (url.includes("/events/pending")) {
        listCount += 1;
        // 第二次列表请求代表审批后的刷新，此时该条已被处理。
        return jsonResponse({ events: listCount === 1 ? [CURRENT_EVENT] : [] });
      }
      return jsonResponse({ ok: true });
    });

    renderPanel();

    fireEvent.click(await screen.findByTestId("write-proposal-approve"));

    await waitFor(() => {
      expect(screen.queryByTestId("write-proposals")).toBeNull();
    });

    const approve = calls.find((call) => call.url.endsWith("/approve"));
    expect(approve?.url).toBe("/api/books/book-1/narrative-memory/events/event-current/approve");
    expect(approve?.init?.method).toBe("POST");
    expect(JSON.parse(String(approve?.init?.body))).toEqual({ reason: "写作视图确认本章提议" });
    expect(listCount).toBe(2);
  });

  it("驳回走同一条通道，理由标明是驳回", async () => {
    const calls: string[] = [];
    let body: unknown = null;
    stubFetch((url, init) => {
      calls.push(url);
      if (url.includes("/events/pending")) return jsonResponse({ events: [CURRENT_EVENT] });
      body = JSON.parse(String(init?.body));
      return jsonResponse({ ok: true });
    });

    renderPanel();

    fireEvent.click(await screen.findByTestId("write-proposal-reject"));

    await waitFor(() => {
      expect(calls.some((url) => url.endsWith("/reject"))).toBe(true);
    });
    expect(body).toEqual({ reason: "写作视图驳回本章提议" });
  });

  it("审批完重新预检，因为高风险待确认会影响写前状态", async () => {
    stubFetch((url) => url.includes("/events/pending")
      ? jsonResponse({ events: [CURRENT_EVENT] })
      : jsonResponse({ ok: true }));
    const callTool = vi.fn(async () => READY_PREFLIGHT);

    renderPanel({ callTool });

    await waitFor(() => expect(callTool).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByTestId("write-proposal-approve"));

    await waitFor(() => {
      expect(callTool.mock.calls.filter(([tool]) => tool === "write.preflight").length).toBe(2);
    });
  });

  it("审批失败时显示服务端说明，且不清空列表", async () => {
    stubFetch((url) => url.includes("/events/pending")
      ? jsonResponse({ events: [CURRENT_EVENT] })
      : jsonResponse({ summary: "该事件已被结算" }, { status: 409 }));

    renderPanel();

    fireEvent.click(await screen.findByTestId("write-proposal-approve"));

    await waitFor(() => {
      expect(screen.getByText("该事件已被结算")).toBeTruthy();
    });
    expect(screen.getByText("青云剑残片")).toBeTruthy();
  });

  it("队列拿不到时报错但不挡住开写按钮", async () => {
    stubFetch(() => jsonResponse({ error: "boom" }, { status: 500 }));

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("write-proposals")).toBeTruthy();
    });
    expect(screen.getByText("events 500")).toBeTruthy();
    expect(screen.getByTestId("write-chapter")).toBeTruthy();
  });

  it("没有提议时整块不渲染，不占写作面板空间", async () => {
    stubFetch(() => jsonResponse({ events: [] }));

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("write-view-panel")).toBeTruthy();
    });
    expect(screen.queryByTestId("write-proposals")).toBeNull();
  });

  it("刷新按钮同时重取写前状态与提议，写完一章后一次点击即可", async () => {
    let listCount = 0;
    stubFetch((url) => {
      if (url.includes("/events/pending")) {
        listCount += 1;
        // 第二次代表章节落盘后的刷新，此时结算已提出新事件。
        return jsonResponse({ events: listCount === 1 ? [] : [CURRENT_EVENT] });
      }
      return jsonResponse({ ok: true });
    });
    const callTool = vi.fn(async () => READY_PREFLIGHT);

    renderPanel({ callTool });

    await waitFor(() => expect(listCount).toBe(1));
    expect(screen.queryByTestId("write-proposals")).toBeNull();

    fireEvent.click(screen.getByTestId("write-refresh"));

    await waitFor(() => {
      expect(screen.getByTestId("write-proposals")).toBeTruthy();
    });
    expect(screen.getByText("青云剑残片")).toBeTruthy();
    expect(callTool.mock.calls.filter(([tool]) => tool === "write.preflight").length).toBe(2);
  });

  it("没有书时不请求队列", async () => {
    const spy = stubFetch(() => jsonResponse({ events: [] }));

    render(<WriteViewPanel />);

    expect(screen.getByText(/先打开一本书/)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });
});
