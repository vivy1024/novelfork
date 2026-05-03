import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { EditorArea, useEditorTabs, type EditorTab } from "./EditorArea";

afterEach(() => { cleanup(); });

const sampleTabs: EditorTab[] = [
  { id: "ch1", title: "第一章 灵潮初起", content: <div>章节正文</div> },
  { id: "ch2", title: "第二章 入门考核", dirty: true, content: <div>第二章内容</div> },
];

describe("EditorArea", () => {
  it("renders tabs and active content", () => {
    render(<EditorArea tabs={sampleTabs} activeTabId="ch1" onTabChange={vi.fn()} onTabClose={vi.fn()} />);

    expect(screen.getByText("第一章 灵潮初起")).toBeTruthy();
    expect(screen.getByText("第二章 入门考核")).toBeTruthy();
    expect(screen.getByText("章节正文")).toBeTruthy();
  });

  it("shows dirty indicator on modified tabs", () => {
    render(<EditorArea tabs={sampleTabs} activeTabId="ch1" onTabChange={vi.fn()} onTabClose={vi.fn()} />);

    const ch2Tab = screen.getByText("第二章 入门考核").closest("[role=tab]");
    expect(ch2Tab?.textContent).toContain("●");
  });

  it("switches tab on click", () => {
    const onChange = vi.fn();
    render(<EditorArea tabs={sampleTabs} activeTabId="ch1" onTabChange={onChange} onTabClose={vi.fn()} />);

    fireEvent.click(screen.getByText("第二章 入门考核"));
    expect(onChange).toHaveBeenCalledWith("ch2");
  });

  it("closes tab on X button click", () => {
    const onClose = vi.fn();
    render(<EditorArea tabs={sampleTabs} activeTabId="ch1" onTabChange={vi.fn()} onTabClose={onClose} />);

    fireEvent.click(screen.getByLabelText("关闭 第一章 灵潮初起"));
    expect(onClose).toHaveBeenCalledWith("ch1");
  });

  it("shows empty state when no tabs", () => {
    render(<EditorArea tabs={[]} activeTabId={null} onTabChange={vi.fn()} onTabClose={vi.fn()} />);
    expect(screen.getByText(/从左侧叙事线选择/)).toBeTruthy();
  });
});

describe("useEditorTabs", () => {
  it("opens and closes tabs", () => {
    const { result } = renderHook(() => useEditorTabs());

    act(() => {
      result.current.openTab({ id: "t1", title: "Tab 1", content: null });
    });
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe("t1");

    act(() => {
      result.current.openTab({ id: "t2", title: "Tab 2", content: null });
    });
    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeTabId).toBe("t2");

    act(() => {
      result.current.closeTab("t2");
    });
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe("t1");
  });

  it("does not duplicate tabs", () => {
    const { result } = renderHook(() => useEditorTabs());

    act(() => {
      result.current.openTab({ id: "t1", title: "Tab 1", content: null });
      result.current.openTab({ id: "t1", title: "Tab 1", content: null });
    });
    expect(result.current.tabs).toHaveLength(1);
  });

  it("sets dirty flag", () => {
    const { result } = renderHook(() => useEditorTabs());

    act(() => {
      result.current.openTab({ id: "t1", title: "Tab 1", content: null });
      result.current.setDirty("t1", true);
    });
    expect(result.current.tabs[0]?.dirty).toBe(true);
  });
});
