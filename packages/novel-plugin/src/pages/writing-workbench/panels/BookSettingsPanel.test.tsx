import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJson = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
}));

// 叙事记忆分区有自己的保存链路，本文件只测书籍设置三条保存路径。
vi.mock("./NarrativeMemorySettingsPanel", () => ({
  NarrativeMemorySettingsSection: () => null,
}));

import { BookSettingsPanel } from "./BookSettingsPanel";

let putError: Error | null = null;

beforeEach(() => {
  putError = null;
  fetchJson.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      if (putError) throw putError;
      return {};
    }
    if (url.includes("/writing-layers")) return {};
    return {
      book: {
        title: "测试书",
        genre: "玄幻",
        platform: "other",
        language: "zh",
        targetChapters: 100,
        chapterWordCount: 2000,
      },
    };
  });
});

afterEach(() => {
  cleanup();
});

describe("BookSettingsPanel 保存状态", () => {
  it("保存失败显示失败信息并保留到下次保存，不再静默落回 idle", async () => {
    putError = new Error("网络中断");
    render(<BookSettingsPanel bookId="book-1" onBack={vi.fn()} />);

    const titleInput = await screen.findByPlaceholderText("输入书名");
    fireEvent.change(titleInput, { target: { value: "改名后的书" } });

    const errorBadge = await screen.findByTestId("book-settings-save-error", undefined, { timeout: 4000 });
    expect(errorBadge.textContent).toContain("保存失败");
    expect(errorBadge.textContent).toContain("网络中断");
    expect(screen.queryByText("已保存")).toBeNull();

    // 下次操作成功后错误才消失（error 态不会自己超时清掉）
    putError = null;
    fireEvent.change(titleInput, { target: { value: "再改一次" } });
    await screen.findByText("已保存", undefined, { timeout: 4000 });
    expect(screen.queryByTestId("book-settings-save-error")).toBeNull();
  }, 15000);

  it("书籍层保存失败同样亮出失败信息", async () => {
    putError = new Error("服务不可用");
    render(<BookSettingsPanel bookId="book-1" onBack={vi.fn()} />);

    const intent = await screen.findByLabelText("作者意图");
    fireEvent.change(intent, { target: { value: "写一部长线布局的群像戏" } });

    const errorBadge = await screen.findByTestId("book-settings-save-error", undefined, { timeout: 4000 });
    expect(errorBadge.textContent).toContain("服务不可用");
  }, 15000);
});

describe("BookSettingsPanel 书籍层：作者意图可改，当前聚焦与本书规则只读", () => {
  function layersResponse() {
    return {
      bookDesign: { authorIntent: "原意图", currentFocus: "罗盘里的聚焦", volumeOutline: "第一卷：经纬导出" },
      bookRulesRaw: "主角必须隐忍",
      bookRules: [{ id: "rule-1", title: "人设锁定", content: "主角必须隐忍" }],
      notices: [],
      revisions: { authorIntent: "rev-intent" },
    };
  }

  it("当前聚焦与本书规则只读显示，没有可编辑的输入框", async () => {
    fetchJson.mockImplementation(async (url: string) => (url.includes("/writing-layers") ? layersResponse() : { book: { title: "测试书" } }));
    render(<BookSettingsPanel bookId="book-1" onBack={vi.fn()} />);

    const focus = await screen.findByTestId("current-focus-summary");
    await waitFor(() => expect(focus.textContent).toContain("罗盘里的聚焦"));
    expect(screen.queryByLabelText("当前聚焦")).toBeNull();
    expect(screen.queryByDisplayValue("罗盘里的聚焦")).toBeNull();
    const rules = screen.getByTestId("book-rules-summary");
    expect(rules.textContent).toContain("人设锁定");
    expect(rules.textContent).toContain("主角必须隐忍");
    expect(screen.queryByLabelText("书籍硬规则")).toBeNull();
    expect(screen.queryByDisplayValue("主角必须隐忍")).toBeNull();
  });

  it("按钮跳到唯一的编辑处：创作罗盘 / 写作规则", async () => {
    fetchJson.mockImplementation(async (url: string) => (url.includes("/writing-layers") ? layersResponse() : { book: { title: "测试书" } }));
    const onOpenCompass = vi.fn();
    const onOpenBookRules = vi.fn();
    render(<BookSettingsPanel bookId="book-1" onBack={vi.fn()} onOpenCompass={onOpenCompass} onOpenBookRules={onOpenBookRules} />);

    fireEvent.click(await screen.findByRole("button", { name: "去创作罗盘修改" }));
    fireEvent.click(screen.getByRole("button", { name: "去写作规则修改" }));
    expect(onOpenCompass).toHaveBeenCalledTimes(1);
    expect(onOpenBookRules).toHaveBeenCalledTimes(1);
  });

  it("改作者意图时 PUT 只带 authorIntent 及其 revision，不带当前聚焦、规则或卷纲", async () => {
    fetchJson.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return { revisions: { authorIntent: "rev-intent-2" } };
      if (url.includes("/writing-layers")) return layersResponse();
      return { book: { title: "测试书" } };
    });
    render(<BookSettingsPanel bookId="book-1" onBack={vi.fn()} />);

    fireEvent.change(await screen.findByDisplayValue("原意图"), { target: { value: "新意图" } });

    await waitFor(() => {
      expect(fetchJson.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT")).toBe(true);
    }, { timeout: 4000 });
    const put = fetchJson.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT")!;
    expect(String(put[0])).toContain("/writing-layers");
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({
      bookDesign: { authorIntent: "新意图" },
      revisions: { authorIntent: "rev-intent" },
    });
  }, 15000);

  it("迁移留下的旧聚焦以提示显示，点「知道了」后收起并通知服务端", async () => {
    fetchJson.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: true };
      if (url.includes("/writing-layers")) {
        return { ...layersResponse(), notices: [{ field: "currentFocus", message: "旧版设置里还有一份不同的当前聚焦。", legacyText: "旧聚焦正文" }] };
      }
      return { book: { title: "测试书" } };
    });
    render(<BookSettingsPanel bookId="book-1" onBack={vi.fn()} />);

    const notice = await screen.findByTestId("writing-layers-notice-currentFocus");
    expect(notice.textContent).toContain("旧聚焦正文");
    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    await waitFor(() => expect(screen.queryByTestId("writing-layers-notice-currentFocus")).toBeNull());
    expect(fetchJson.mock.calls.some(([url, init]) => String(url).includes("/notices/currentFocus/dismiss") && (init as RequestInit | undefined)?.method === "POST")).toBe(true);
  });

  it("卷纲只读显示，并引导到经纬「卷纲/大纲」编辑", async () => {
    fetchJson.mockImplementation(async (url: string) => (url.includes("/writing-layers") ? layersResponse() : { book: { title: "测试书" } }));
    render(<BookSettingsPanel bookId="book-1" onBack={vi.fn()} />);

    const outline = await screen.findByDisplayValue("第一卷：经纬导出");
    expect(outline.hasAttribute("readonly")).toBe(true);
    expect(screen.getByTestId("volume-outline-readonly").textContent).toContain("卷纲/大纲");
  });

  it("revision 冲突时提示作者重新载入，点按钮后重新读取", async () => {
    let layerReads = 0;
    fetchJson.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const error = new Error("「作者意图」在你打开设置之后已经被别处改过") as Error & { code?: string };
        error.code = "WRITING_LAYER_REVISION_CONFLICT";
        throw error;
      }
      if (url.includes("/writing-layers")) { layerReads += 1; return layersResponse(); }
      return { book: { title: "测试书" } };
    });
    render(<BookSettingsPanel bookId="book-1" onBack={vi.fn()} />);

    fireEvent.change(await screen.findByDisplayValue("原意图"), { target: { value: "我的改动" } });

    const banner = await screen.findByTestId("writing-layers-conflict", undefined, { timeout: 4000 });
    expect(banner.textContent).toContain("被别处改过");
    const before = layerReads;
    fireEvent.click(screen.getByRole("button", { name: "重新载入最新内容" }));
    await waitFor(() => expect(layerReads).toBe(before + 1));
    await waitFor(() => expect(screen.queryByTestId("writing-layers-conflict")).toBeNull());
  }, 15000);
});

describe("BookSettingsPanel 的宿主插槽", () => {
  it("宿主注入项目设置时渲染该分区，并说明 MCP / 钩子只能统一设置", async () => {
    render(
      <BookSettingsPanel
        bookId="book-1"
        onBack={vi.fn()}
        projectSettingsSlot={<div data-testid="project-settings-stub">项目设置</div>}
      />,
    );

    expect(await screen.findByTestId("project-settings-stub")).not.toBeNull();
    const section = document.querySelector('[data-settings-section="runtime-project"]');
    expect(section).not.toBeNull();
    // 读者要知道 MCP / 钩子 / 规则这一轮为什么不在本书级。
    expect(section?.textContent).toContain("MCP");
    expect(section?.textContent).toContain("钩子");
  });

  it("没有宿主插槽时整块不渲染，不留空壳分区", async () => {
    render(<BookSettingsPanel bookId="book-1" onBack={vi.fn()} />);

    await screen.findByPlaceholderText("输入书名");
    expect(document.querySelector('[data-settings-section="runtime-project"]')).toBeNull();
    expect(screen.queryByText("本书技能与工具")).toBeNull();
  });
});
