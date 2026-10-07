import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JingweiEntryEditor } from "./JingweiEntryEditor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("JingweiEntryEditor canonical history", () => {
  it("uses jingwei_revision API only and ignores legacy revisionHistory JSON", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/revisions")) {
        return new Response(JSON.stringify({ revisions: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ entries: [{ id: "entry-1", title: "条目", relatedEntryIds: [] }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{
          id: "entry-1",
          title: "条目",
          contentMd: "正文",
          revisionHistory: [{ timestamp: "2026-08-01T00:00:00.000Z", source: "user", changedFields: ["contentMd"] }],
        }}
        onSave={vi.fn()}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /历史/ }));

    expect(await screen.findByText("暂无修改记录")).toBeTruthy();
    expect(screen.queryByText(/修改了.*contentMd/)).toBeNull();
  });

  it("does not refetch history when parent rerenders with equivalent relation arrays", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/revisions")) {
        return new Response(JSON.stringify({ revisions: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ entries: [{ id: "entry-1", title: "条目", relatedEntryIds: ["entry-2"] }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSave = vi.fn();
    const { rerender } = render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "entry-1", title: "条目", contentMd: "正文", relatedEntryIds: ["entry-2"] }}
        relatedEntries={[{ id: "entry-2", title: "关联条目" }]}
        onSave={onSave}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    rerender(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "entry-1", title: "条目", contentMd: "正文", relatedEntryIds: ["entry-2"] }}
        relatedEntries={[{ id: "entry-2", title: "关联条目" }]}
        onSave={onSave}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a real history loading error instead of pretending the list is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/revisions")) return new Response("error", { status: 500 });
      return new Response(JSON.stringify({ entries: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "entry-1", title: "条目", contentMd: "正文" }}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /历史/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("历史加载失败（500）");
  });

  it("冲突分类画出正方/反方/赌注/收束，保存时把 fields 一并写回", async () => {
    const onSave = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/revisions")) {
        return new Response(JSON.stringify({ revisions: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ entries: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{
          id: "cf-1",
          title: "通道授权",
          contentMd: "争夺通道",
          sectionId: "sec-1",
          category: "conflicts",
          fields: { protagonistSide: "林舟", antagonistSide: "周衡", stakes: "通道" },
        }}
        onSave={onSave}
      />,
    );

    // 已确认条目默认档案式阅读，显式点「编辑」进入表单
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(await screen.findByTestId("jingwei-entry-fields")).toBeTruthy();
    expect(screen.getByLabelText(/正方/)).toBeTruthy();
    expect(screen.getByLabelText(/反方/)).toBeTruthy();
    expect(screen.getByLabelText(/赌注/)).toBeTruthy();
    expect(screen.getByLabelText(/收束状态/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/赌注/), { target: { value: "失去北境通道" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith("cf-1", expect.objectContaining({
      title: "通道授权",
      fields: expect.objectContaining({
        protagonistSide: "林舟",
        antagonistSide: "周衡",
        stakes: "失去北境通道",
        name: "通道授权",
      }),
    }));
  });
});

describe("JingweiEntryEditor 档案式阅读 / 编辑切换", () => {
  function stubEntryApi() {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/revisions")) {
        return new Response(JSON.stringify({ revisions: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ entries: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }));
  }

  it("已确认条目默认阅读：字段按标签值列出、空字段隐藏、关联可跳转", async () => {
    stubEntryApi();
    const onNavigateToEntry = vi.fn();

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{
          id: "rd-1",
          title: "通道授权",
          contentMd: "争夺通道",
          sectionId: "sec-1",
          category: "conflicts",
          status: "confirmed",
          fields: { protagonistSide: "林舟", antagonistSide: "周衡", stakes: "通道", status: "进行中", resolutionChapter: "" },
          relatedEntryIds: ["rd-2"],
        }}
        relatedEntries={[{ id: "rd-2", title: "北境危机" }]}
        onNavigateToEntry={onNavigateToEntry}
        onSave={vi.fn()}
      />,
    );

    // 默认不是表单：没有保存按钮，有明确的「编辑」入口
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy();
    // 标题是阅读式标题，而非输入框
    expect(screen.getByRole("heading", { name: "通道授权" })).toBeTruthy();
    // 字段区：标签: 值，空字段不出现
    const fieldList = await screen.findByTestId("jingwei-entry-fields-reading");
    expect(fieldList.textContent).toContain("正方");
    expect(fieldList.textContent).toContain("林舟");
    expect(fieldList.textContent).toContain("进行中");
    expect(fieldList.textContent).not.toContain("收束章节");
    // 关联条目在「关联」tab 保持可点跳转
    fireEvent.click(screen.getByRole("button", { name: /关联/ }));
    fireEvent.click(screen.getByRole("button", { name: /北境危机/ }));
    expect(onNavigateToEntry).toHaveBeenCalledWith("rd-2");
  });

  it("编辑表单与界面上统一叫「待确认」，不再出现「需审查」", () => {
    stubEntryApi();

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "rd-3", title: "待确认条目", contentMd: "正文", sectionId: "sec-1", status: "needs-review" }}
        onSave={vi.fn()}
      />,
    );

    // needs-review 打开即编辑；状态选择器当前值与界面文案都叫「待确认」
    expect(screen.getAllByText("待确认").length).toBeGreaterThan(0);
    expect(screen.queryByText("需审查")).toBeNull();
  });

  it("点编辑进入表单，保存成功后回到阅读模式", async () => {
    stubEntryApi();
    const onSave = vi.fn(async () => undefined);

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "rd-2", title: "旧标题", contentMd: "正文", sectionId: "sec-1", status: "confirmed" }}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    // 进入表单后标题是输入框
    const titleInput = await screen.findByPlaceholderText(/条目标题/);
    fireEvent.change(titleInput, { target: { value: "新标题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith("rd-2", expect.objectContaining({ title: "新标题" }));
    // 保存成功回到阅读模式
    await waitFor(() => expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    expect(screen.getByRole("heading", { name: "新标题" })).toBeTruthy();
  });

  it("取消编辑：无改动直接回阅读，有改动需确认放弃且不回写", async () => {
    stubEntryApi();
    const onSave = vi.fn(async () => undefined);

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "rd-3", title: "原标题", contentMd: "正文", sectionId: "sec-1", status: "confirmed" }}
        onSave={onSave}
      />,
    );

    // 无改动：取消直接回到阅读模式
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();

    // 有改动：取消先出现内联确认
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByPlaceholderText(/条目标题/), { target: { value: "改过的标题" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByText("放弃未保存的修改？")).toBeTruthy();
    // 放弃后回阅读模式，保留原值
    fireEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "原标题" })).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("needs-review 草案打开即编辑态", async () => {
    stubEntryApi();

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "dr-1", title: "草案条目", contentMd: "草稿正文", sectionId: "sec-1", category: "conflicts", status: "needs-review", fields: { stakes: "赌注" } }}
        onSave={vi.fn()}
      />,
    );

    // 不点编辑直接进入表单
    expect(await screen.findByTestId("jingwei-entry-fields")).toBeTruthy();
    expect(screen.getByLabelText(/赌注/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "草案条目" })).toBeNull();
  });

  it("draft（未确认）条目同样打开即编辑态", async () => {
    stubEntryApi();

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "dr-2", title: "未确认条目", contentMd: "草稿正文", sectionId: "sec-1", category: "conflicts", status: "draft", fields: { stakes: "赌注" } }}
        onSave={vi.fn()}
      />,
    );

    // draft 与 needs-review 同为未确认、不进召回：打开即编辑，便于先改再确认
    expect(await screen.findByTestId("jingwei-entry-fields")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "未确认条目" })).toBeNull();
  });
});
