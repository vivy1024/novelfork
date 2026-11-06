import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NarrativeConsistencyPanel } from "./NarrativeConsistencyPanel";

/**
 * 叙事体检面板。
 *
 * 这个面板存在的理由是「P4 检测器没有任何前端调用方」，所以测试要盯住三件事：
 * 1. 真的打了 GET /consistency，并把后端 explanation 三段式原样转述；
 * 2. 处置动作走 fact 编辑端点（纠正 PUT /correct、作废 DELETE /facts/:id）；
 * 3. 加载 / 空 / 错误三态都不留白，空态是「未检出纰漏」而不是空白。
 *
 * 本包没开 vitest globals，RTL 的自动 cleanup 不会注册，必须手动清理。
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const REALM_FINDING = {
  kind: "realm-drift",
  severity: "warning" as const,
  title: "设定与现状不一致：张三 的境界/职级",
  detail: "经纬设定为「金丹」，叙事记忆当前为「筑基」。",
  entity: "张三",
  jingweiValue: "金丹",
  memoryValue: "筑基",
  jingweiEntryId: "entry-zhangsan",
  factId: "fact-realm",
  memoryPredicate: "修为",
  memoryChapter: 95,
  explanation: {
    whatHappened: "经纬里张三的修为写着金丹，第 95 章结算出的叙事记忆写着筑基。",
    whyItMatters: "续写时写手读的是叙事记忆的现状，两边分岔会被读者当成崩设定。",
    suggestedAction: "确认哪一边是对的：正文没写过跌落就把这条记忆纠正为金丹。",
  },
};

const LOCATION_FINDING = {
  kind: "orphan-location",
  severity: "warning" as const,
  title: "当前位置指向已废弃地点：黑风寨",
  entity: "李四",
  memoryValue: "黑风寨",
  jingweiEntryId: "entry-heifengzhai",
  factId: "fact-loc",
  memoryPredicate: "位于",
  explanation: {
    whatHappened: "叙事记忆里李四仍位于黑风寨，但经纬里黑风寨已标记为废弃。",
    whyItMatters: "人物停在按设定已经不存在的地方，时间线会一起错下去。",
    suggestedAction: "核对正文后纠正位置，或去经纬改掉黑风寨的废弃状态。",
  },
};

const SCENE_FINDING = {
  kind: "scene-dead-acts",
  severity: "warning" as const,
  title: "甲 已死亡，第 3 章又在行动",
  entity: "甲",
  entityId: "ent:book-1:entry-jia",
  chapterNumber: 3,
  evidenceText: "甲一掌拍碎了石桌。",
  factId: "fact-death",
  memoryChapter: 2,
  memoryPredicate: "身亡",
  memoryValue: "死亡",
  ignoreKey: { kind: "scene-dead-acts", entityId: "ent:book-1:entry-jia", chapterNumber: 3, factId: "fact-death" },
  explanation: {
    whatHappened: "第 2 章记着甲已死亡；第 3 章甲却是动手的一方。",
    whyItMatters: "没有交代就让人重新出手，会被当成作者忘了前文。",
    suggestedAction: "核对第 3 章：若是回忆就写清楚，若真复活就补交代。",
  },
};

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

type FetchCall = { url: string; method: string; body: Record<string, unknown> };

/** 装一个只认识 /consistency 与 fact 编辑端点的假后端，并记录全部调用。 */
function stubBackend(options: {
  readonly consistency: () => Response;
  readonly mutation?: () => Response;
}): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
    });
    if (/\/narrative-memory\/consistency(\?|$)/u.test(url)) return options.consistency();
    return options.mutation?.() ?? jsonResponse({ summary: "ok" });
  }));
  return calls;
}

describe("NarrativeConsistencyPanel", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the consistency endpoint and quotes the backend explanation verbatim", async () => {
    const calls = stubBackend({
      consistency: () => jsonResponse({
        bookId: "book-1",
        findings: [REALM_FINDING],
        summary: "发现 1 处经纬设定与叙事记忆现状的分歧。",
      }),
    });

    render(<NarrativeConsistencyPanel bookId="book-1" />);

    await screen.findByText(REALM_FINDING.title);

    expect(calls[0]?.url).toBe("/api/books/book-1/narrative-memory/consistency");
    expect(calls[0]?.method).toBe("GET");

    for (const label of ["发生了什么", "为什么要看", "建议怎么做"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // 三段文案必须是后端原话，不是前端按 kind 编的。
    expect(screen.getByText(REALM_FINDING.explanation.whatHappened)).toBeTruthy();
    expect(screen.getByText(REALM_FINDING.explanation.whyItMatters)).toBeTruthy();
    expect(screen.getByText(REALM_FINDING.explanation.suggestedAction)).toBeTruthy();
    // 两边取值同时在场，作者不用点开就知道分歧是什么。
    expect(screen.getByText("设定：金丹")).toBeTruthy();
    expect(screen.getByText("现状：筑基")).toBeTruthy();
  });

  it("passes the current chapter as asOfChapter so the report matches what the author is writing", async () => {
    const calls = stubBackend({
      consistency: () => jsonResponse({ findings: [], summary: "未发现纰漏。" }),
    });

    render(<NarrativeConsistencyPanel bookId="book/1" currentChapter={95} />);

    await screen.findByTestId("narrative-consistency-empty");
    expect(calls[0]?.url).toBe("/api/books/book%2F1/narrative-memory/consistency?asOfChapter=95");
  });

  it("groups findings by kind", async () => {
    stubBackend({
      consistency: () => jsonResponse({ findings: [REALM_FINDING, LOCATION_FINDING], summary: "发现 2 处分歧。" }),
    });

    render(<NarrativeConsistencyPanel bookId="book-1" />);

    await screen.findByText(REALM_FINDING.title);
    const realmGroup = screen.getByTestId("consistency-group-realm-drift");
    const locationGroup = screen.getByTestId("consistency-group-orphan-location");
    expect(within(realmGroup).getByText(REALM_FINDING.title)).toBeTruthy();
    expect(within(locationGroup).getByText(LOCATION_FINDING.title)).toBeTruthy();
    expect(screen.getByText("境界倒退 / 职级不一致")).toBeTruthy();
    expect(screen.getByText("地点孤立")).toBeTruthy();
  });

  it("shows a positive empty state instead of a blank panel", async () => {
    stubBackend({
      consistency: () => jsonResponse({ findings: [], summary: "经纬设定与叙事记忆现状一致，未发现纰漏。" }),
    });

    render(<NarrativeConsistencyPanel bookId="book-1" />);

    const empty = await screen.findByTestId("narrative-consistency-empty");
    expect(within(empty).getByText("未检出纰漏")).toBeTruthy();
    expect(within(empty).getByText(/未发现纰漏/u)).toBeTruthy();
  });

  it("surfaces a retryable error state when the check fails", async () => {
    const calls = stubBackend({
      consistency: () => jsonResponse({ error: "storage-unavailable", summary: "读不到叙事记忆库。" }, { status: 500 }),
    });

    render(<NarrativeConsistencyPanel bookId="book-1" />);

    await screen.findByText("体检没跑起来");
    // 失败时不能静默显示「未检出纰漏」，否则作者以为书是干净的。
    expect(screen.queryByTestId("narrative-consistency-empty")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => {
      expect(calls.filter((call) => call.url.includes("/consistency")).length).toBe(2);
    });
  });

  it("corrects the memory fact toward the jingwei value in place", async () => {
    let pass = 0;
    const calls = stubBackend({
      consistency: () => {
        pass += 1;
        return pass === 1
          ? jsonResponse({ findings: [REALM_FINDING], summary: "发现 1 处分歧。" })
          : jsonResponse({ findings: [], summary: "未发现纰漏。" });
      },
      mutation: () => jsonResponse({ summary: "已纠正" }),
    });

    render(<NarrativeConsistencyPanel bookId="book-1" />);

    fireEvent.click(await screen.findByRole("button", { name: /纠正为「金丹」/u }));

    await waitFor(() => {
      expect(calls.some((call) => call.method === "PUT")).toBe(true);
    });
    const correction = calls.find((call) => call.method === "PUT")!;
    expect(correction.url).toBe("/api/books/book-1/narrative-memory/facts/fact-realm/correct");
    expect(correction.body.object).toBe("金丹");
    // 谓词沿用后端给的那条 slot，不让前端猜。
    expect(correction.body.predicate).toBe("修为");
    expect(String(correction.body.reason)).toContain("叙事体检");

    // 处理完要重新体检，纠正过的条目应从列表消失。
    await screen.findByTestId("narrative-consistency-empty");
  });

  it("retires the memory fact when the extraction is wrong", async () => {
    const calls = stubBackend({
      consistency: () => jsonResponse({ findings: [LOCATION_FINDING], summary: "发现 1 处分歧。" }),
      mutation: () => jsonResponse({ summary: "已作废" }),
    });

    render(<NarrativeConsistencyPanel bookId="book-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "作废这条" }));

    await waitFor(() => {
      expect(calls.some((call) => call.method === "DELETE")).toBe(true);
    });
    const retire = calls.find((call) => call.method === "DELETE")!;
    expect(retire.url).toBe("/api/books/book-1/narrative-memory/facts/fact-loc");
    expect(String(retire.body.reason)).toContain("叙事体检");
  });

  it("reports the backend message when a fix fails and keeps the finding visible", async () => {
    stubBackend({
      consistency: () => jsonResponse({ findings: [REALM_FINDING], summary: "发现 1 处分歧。" }),
      mutation: () => jsonResponse({ error: "not-found", summary: "找不到该叙事事实。" }, { status: 404 }),
    });

    render(<NarrativeConsistencyPanel bookId="book-1" />);

    fireEvent.click(await screen.findByRole("button", { name: /纠正为「金丹」/u }));

    await screen.findByText(/找不到该叙事事实|not-found/u);
    expect(screen.getByText(REALM_FINDING.title)).toBeTruthy();
  });

  it("persists「忽略此条」through the backend and offers an undo that restores the finding", async () => {
    // 假后端按忽略记录决定结果：被忽略的项进 ignored，撤销后回到 findings。
    let ignoredNow = false;
    const calls = stubBackend({
      consistency: () => jsonResponse(ignoredNow
        ? { findings: [], ignored: [SCENE_FINDING], summary: "未发现纰漏。另有 1 处已被你标为忽略。" }
        : { findings: [SCENE_FINDING], ignored: [], summary: "发现 1 处可能矛盾。" }),
      mutation: () => {
        const last = calls[calls.length - 1]!;
        ignoredNow = !last.url.endsWith("/remove");
        return jsonResponse({ summary: "ok" });
      },
    });

    render(<NarrativeConsistencyPanel bookId="book-1" />);

    fireEvent.click(await screen.findByRole("button", { name: /忽略此条/u }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === "POST")).toBe(true);
    });
    const ignore = calls.find((call) => call.method === "POST")!;
    expect(ignore.url).toBe("/api/books/book-1/narrative-memory/consistency/ignores");
    // 忽略键原样回传后端给的那份，前端不自己拼。
    expect(ignore.body).toEqual(SCENE_FINDING.ignoreKey);

    // 重新体检后进入空态，保留查看 / 撤销入口。
    const empty = await screen.findByTestId("narrative-consistency-empty");
    fireEvent.click(within(empty).getByRole("button", { name: /另有 1 条已被你忽略/u }));
    const ignoredList = screen.getByTestId("consistency-ignored");
    fireEvent.click(within(ignoredList).getByRole("button", { name: /撤销忽略/u }));

    await waitFor(() => {
      expect(calls.some((call) => call.url.endsWith("/consistency/ignores/remove"))).toBe(true);
    });
    expect(calls.find((call) => call.url.endsWith("/remove"))!.body).toEqual(SCENE_FINDING.ignoreKey);
    await screen.findByRole("button", { name: /忽略此条/u });
    expect(screen.queryByTestId("narrative-consistency-empty")).toBeNull();
  });

  it("renders scene-check findings with the original sentence and both chapter jumps", async () => {
    stubBackend({
      consistency: () => jsonResponse({ findings: [SCENE_FINDING], ignored: [], summary: "发现 1 处可能矛盾。" }),
    });
    const onJumpToChapter = vi.fn();

    render(<NarrativeConsistencyPanel bookId="book-1" onJumpToChapter={onJumpToChapter} />);

    await screen.findByText(SCENE_FINDING.title);
    expect(screen.getByText("死亡 / 离场后又行动")).toBeTruthy();
    expect(within(screen.getByTestId("consistency-evidence")).getByText(/甲一掌拍碎了石桌/u)).toBeTruthy();
    expect(screen.getByText(SCENE_FINDING.explanation.suggestedAction)).toBeTruthy();
    // 场景校验不和经纬比，不提供「纠正为」。
    expect(screen.queryByRole("button", { name: /纠正为/u })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /看第 3 章/u }));
    fireEvent.click(screen.getByRole("button", { name: /看第 2 章/u }));
    expect(onJumpToChapter.mock.calls).toEqual([[3], [2]]);
  });

  it("wires chapter and jingwei jumps to the workbench handlers", async () => {
    stubBackend({
      consistency: () => jsonResponse({ findings: [REALM_FINDING], summary: "发现 1 处分歧。" }),
    });
    const onJumpToChapter = vi.fn();
    const onOpenJingweiEntry = vi.fn().mockReturnValue(true);

    render(
      <NarrativeConsistencyPanel
        bookId="book-1"
        onJumpToChapter={onJumpToChapter}
        onOpenJingweiEntry={onOpenJingweiEntry}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /看第 95 章/u }));
    expect(onJumpToChapter).toHaveBeenCalledWith(95);

    fireEvent.click(screen.getByRole("button", { name: "看条目" }));
    expect(onOpenJingweiEntry).toHaveBeenCalledWith("entry-zhangsan");
  });

  it("tells the author when the jingwei entry is not loaded instead of failing silently", async () => {
    stubBackend({
      consistency: () => jsonResponse({ findings: [REALM_FINDING], summary: "发现 1 处分歧。" }),
    });

    render(<NarrativeConsistencyPanel bookId="book-1" onOpenJingweiEntry={() => false} />);

    fireEvent.click(await screen.findByRole("button", { name: "看条目" }));
    expect(screen.getByText(/条目不存在或尚未载入/u)).toBeTruthy();
  });

  it("does not offer a correct action when the backend gives no jingwei value to align to", async () => {
    stubBackend({
      consistency: () => jsonResponse({ findings: [LOCATION_FINDING], summary: "发现 1 处分歧。" }),
    });

    render(<NarrativeConsistencyPanel bookId="book-1" />);

    await screen.findByText(LOCATION_FINDING.title);
    expect(screen.queryByRole("button", { name: /纠正为/u })).toBeNull();
    expect(screen.getByRole("button", { name: "作废这条" })).toBeTruthy();
  });

  it("still renders a three-part explanation for findings from an older backend", async () => {
    stubBackend({
      consistency: () => jsonResponse({
        findings: [{
          kind: "realm-drift",
          title: "设定与现状不一致：王五 的境界",
          detail: "经纬设定为「元婴」，叙事记忆当前为「金丹」。",
          entity: "王五",
          jingweiValue: "元婴",
          memoryValue: "金丹",
          factId: "fact-old",
        }],
        summary: "发现 1 处分歧。",
      }),
    });

    render(<NarrativeConsistencyPanel bookId="book-1" />);

    await screen.findByText("设定与现状不一致：王五 的境界");
    for (const label of ["发生了什么", "为什么要看", "建议怎么做"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText(/经纬设定为「元婴」/u)).toBeTruthy();
  });
});
