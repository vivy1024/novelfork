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

describe("BookSettingsPanel 的宿主插槽", () => {
  it("宿主注入项目设置时渲染该分区，说明 Runtime 只覆盖技能与可选工具", async () => {
    render(
      <BookSettingsPanel
        bookId="book-1"
        onBack={vi.fn()}
        projectSettingsSlot={<div data-testid="project-settings-stub">Runtime 项目设置</div>}
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
    expect(screen.queryByText("Runtime 项目设置")).toBeNull();
  });
});
