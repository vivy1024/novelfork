import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("保存成功但附带动作没做完（如图谱没同步）时显示提示，不当作保存失败", async () => {
    stubEntryApi();
    const onSave = vi.fn(async () => ({ notice: "条目已保存，但实体图谱没能同步；可在「章后事实」里手动重建实体索引。" }));

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "rd-4", title: "林照", contentMd: "人物", sectionId: "sec-1", status: "confirmed" }}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(await screen.findByPlaceholderText(/条目标题/), { target: { value: "林照（主角）" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    // 保存照常完成：回到阅读模式，没有错误条
    await waitFor(() => expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    expect((await screen.findByTestId("jingwei-save-notice")).textContent).toContain("实体图谱没能同步");
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

describe("JingweiEntryEditor optimistic concurrency payload (T-24)", () => {
  function stubRevisions() {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/revisions")) {
        return new Response(JSON.stringify({ revisions: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ entries: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }));
  }

  it("保存时把编辑器持有的条目版本作为 expectedVersion 带给 onSave", async () => {
    const onSave = vi.fn(async () => undefined);
    stubRevisions();
    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "cc-1", title: "林舟", contentMd: "初版设定", sectionId: "sec-1", category: "characters", version: 7, fields: { role: "旧角色" } }}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(await screen.findByPlaceholderText("条目标题（如：角色名、地点名）"), { target: { value: "作者新改的设定" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith("cc-1", expect.objectContaining({ expectedVersion: 7 }));
  });

  it("条目没有有效版本时不带 expectedVersion，走原有无版本路径，不传非法值", async () => {
    const onSave = vi.fn(async () => undefined);
    stubRevisions();
    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "cc-2", title: "林舟", contentMd: "初版设定", sectionId: "sec-1", category: "characters", fields: { role: "旧角色" } }}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(await screen.findByPlaceholderText("条目标题（如：角色名、地点名）"), { target: { value: "无版本的编辑" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const payload = onSave.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("expectedVersion");
  });
});

describe("JingweiEntryEditor 章节可见性窗口", () => {
  function stubEditorApi(entry: Record<string, unknown> = {}) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/revisions")) return json({ revisions: [] });
      if (url.endsWith("/progressions")) {
        if (init?.method === "POST") return json({ progression: { id: "p-new" } });
        return json({ progressions: entry.progressions ?? [] });
      }
      if (url.includes("/dependencies")) return json(entry.dependencies ?? { dependsOn: [], dependedBy: [] });
      if (url.includes("/relations")) return json(entry.relations ?? { relations: [] });
      if (/\/jingwei\/entries$/.test(url)) return json({ entries: entry.entries ?? [] });
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("作者能直接填章节窗口，保存时作为 visibleAfterChapter / visibleUntilChapter 传出", async () => {
    stubEditorApi();
    const onSave = vi.fn(async () => undefined);

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "cw-1", title: "林舟", contentMd: "正文", sectionId: "sec-1", category: "characters", status: "confirmed", visibility: "tracked" }}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const window = await screen.findByTestId("jingwei-chapter-window");
    expect(within(window).getByLabelText("生效起始章")).toBeTruthy();

    // 没有改动时保存是禁用的：窗口本身不能凭空造出 dirty
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(window).getByLabelText("生效起始章"), { target: { value: "5" } });
    fireEvent.change(within(window).getByLabelText("退场截止章"), { target: { value: "12" } });
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith("cw-1", expect.objectContaining({
      visibleAfterChapter: 5,
      visibleUntilChapter: 12,
    }));
  });

  it("清空章节窗口后保存传 null，不会把旧窗口留在服务端", async () => {
    stubEditorApi();
    const onSave = vi.fn(async () => undefined);

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{
          id: "cw-2",
          title: "林舟",
          contentMd: "正文",
          sectionId: "sec-1",
          category: "characters",
          status: "confirmed",
          visibility: "tracked",
          visibleAfterChapter: 3,
          visibleUntilChapter: 9,
        }}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const window = await screen.findByTestId("jingwei-chapter-window");
    const after = within(window).getByLabelText("生效起始章") as HTMLInputElement;
    const until = within(window).getByLabelText("退场截止章") as HTMLInputElement;
    expect(after.value).toBe("3");
    expect(until.value).toBe("9");

    fireEvent.change(after, { target: { value: "" } });
    fireEvent.change(until, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const payload = onSave.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.visibleAfterChapter).toBeNull();
    expect(payload.visibleUntilChapter).toBeNull();
  });

  it("取消编辑把窗口输入还原成已保存值", async () => {
    stubEditorApi();

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "cw-3", title: "林舟", contentMd: "正文", sectionId: "sec-1", category: "characters", status: "confirmed", visibleAfterChapter: 4 }}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const window = await screen.findByTestId("jingwei-chapter-window");
    fireEvent.change(within(window).getByLabelText("生效起始章"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃" }));

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const reopened = await screen.findByTestId("jingwei-chapter-window");
    expect((within(reopened).getByLabelText("生效起始章") as HTMLInputElement).value).toBe("4");
  });
});

describe("JingweiEntryEditor 演变台账", () => {
  it("演变 Tab 列出章号 / 字段 / 旧值 → 新值，并能新增一条", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/revisions")) return json({ revisions: [] });
      if (url.endsWith("/progressions")) {
        if (init?.method === "POST") return json({ progression: { id: "p-2" } }, );
        return json({
          progressions: [{
            id: "p-1",
            entry_id: "pg-1",
            field_key: "realm",
            old_value: "炼气七层",
            new_value: "筑基初期",
            chapter_number: 20,
            description: "突破",
            created_at: 1,
          }],
        });
      }
      return json({ entries: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "pg-1", title: "林舟", contentMd: "正文", sectionId: "sec-1", category: "characters", status: "confirmed" }}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /演变/ }));
    const row = await screen.findByTestId("jingwei-progression-row");
    expect(row.textContent).toContain("第 20 章");
    expect(row.textContent).toContain("realm");
    expect(row.textContent).toContain("炼气七层 →");
    expect(row.textContent).toContain("筑基初期");
    expect(row.textContent).toContain("突破");

    fireEvent.change(screen.getByLabelText("字段名"), { target: { value: "location" } });
    fireEvent.change(screen.getByLabelText("新值"), { target: { value: "黄枫谷" } });
    fireEvent.click(screen.getByRole("button", { name: /记一条演变/ }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/progressions") && (call[1] as RequestInit | undefined)?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(String((post![1] as RequestInit).body))).toMatchObject({
        fieldKey: "location",
        newValue: "黄枫谷",
        chapterNumber: null,
      });
    });
  });

  it("没有演变记录时给出空态说明", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/revisions")) return json({ revisions: [] });
      if (url.endsWith("/progressions")) return json({ progressions: [] });
      return json({ entries: [] });
    }));

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "pg-empty", title: "林舟", contentMd: "正文", sectionId: "sec-1", category: "characters", status: "confirmed" }}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /演变/ }));
    expect(await screen.findByText("还没有演变记录")).toBeTruthy();
  });
});

describe("JingweiEntryEditor 结构化依赖与静态关系", () => {
  it("关联 Tab 同时展示简单引用、依赖双向与静态关系，并可跳转", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/revisions")) return json({ revisions: [] });
      if (url.includes("/dependencies")) {
        return json({
          dependsOn: [{ depId: "dep-1", relationType: "references", targetEntryId: "entry-loc", title: "青云山" }],
          dependedBy: [{ depId: "dep-2", relationType: "references", sourceEntryId: "entry-fac", title: "青云宗" }],
        });
      }
      if (url.includes("/relations")) {
        return json({ relations: [{ id: "rel-1", source_entry_id: "entry-lin", target_entry_id: "entry-fac", relation_type: "师徒", label: "授业" }] });
      }
      if (/\/jingwei\/entries$/.test(url)) {
        return json({ entries: [{ id: "entry-loc", title: "青云山" }, { id: "entry-fac", title: "青云宗" }] });
      }
      return json({});
    }));
    const onNavigateToEntry = vi.fn();

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "entry-lin", title: "林舟", contentMd: "正文", sectionId: "sec-1", category: "characters", status: "confirmed" }}
        onNavigateToEntry={onNavigateToEntry}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /关联/ }));

    const dependencies = await screen.findByTestId("jingwei-dependencies");
    await waitFor(() => expect(within(dependencies).getAllByTestId("jingwei-dependency-row")).toHaveLength(2));
    fireEvent.click(within(dependencies).getByRole("button", { name: "青云山" }));
    expect(onNavigateToEntry).toHaveBeenCalledWith("entry-loc");

    const relations = screen.getByTestId("jingwei-relations");
    await waitFor(() => expect(within(relations).getByTestId("jingwei-relation-row")).toBeTruthy());
    expect(within(relations).getByTestId("jingwei-relation-row").textContent).toContain("师徒");
    fireEvent.click(within(relations).getByRole("button", { name: "青云宗" }));
    expect(onNavigateToEntry).toHaveBeenCalledWith("entry-fac");
  });

  it("移除依赖会调用 DELETE 接口", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/revisions")) return json({ revisions: [] });
      if (url.includes("/dependencies")) {
        if (init?.method === "DELETE") return json({ ok: true });
        return json({ dependsOn: [{ depId: "dep-9", relationType: "references", targetEntryId: "entry-loc", title: "青云山" }], dependedBy: [] });
      }
      if (url.includes("/relations")) return json({ relations: [] });
      if (/\/jingwei\/entries$/.test(url)) return json({ entries: [{ id: "entry-loc", title: "青云山" }] });
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <JingweiEntryEditor
        bookId="book-1"
        entry={{ id: "entry-lin", title: "林舟", contentMd: "正文", sectionId: "sec-1", category: "characters", status: "confirmed" }}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /关联/ }));
    const dependencies = await screen.findByTestId("jingwei-dependencies");
    const remove = await within(dependencies).findByRole("button", { name: /移除依赖 青云山/ });
    fireEvent.click(remove);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/jingwei/dependencies/dep-9") && (call[1] as RequestInit | undefined)?.method === "DELETE")).toBe(true);
    });
  });
});
