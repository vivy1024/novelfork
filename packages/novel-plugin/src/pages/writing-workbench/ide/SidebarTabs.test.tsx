import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { SidebarPageHead } from "./SidebarPageHead";
import { SidebarTabs } from "./SidebarTabs";
import { Route } from "lucide-react";

afterEach(cleanup);

type Id = "a" | "b" | "c";

function Harness({ initial = "a" as Id }) {
  const [active, setActive] = useState<Id>(initial);
  return (
    <SidebarTabs<Id>
      ariaLabel="测试视图"
      idPrefix="t"
      testId="tabs"
      active={active}
      onChange={setActive}
      tabs={[{ id: "a", label: "甲" }, { id: "b", label: "乙", count: 2 }, { id: "c", label: "丙" }]}
    />
  );
}

describe("SidebarTabs 单行横向滚动", () => {
  it("页签条单行不换行、可横向滚动", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist", { name: "测试视图" });
    expect(list.className).toContain("flex-nowrap");
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).not.toContain("flex-wrap ");
  });

  it("方向键 / Home / End 切换页签并移动焦点（键盘可达）", () => {
    render(<Harness />);
    const first = screen.getByRole("tab", { name: "甲" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = screen.getByRole("tab", { name: /乙/ });
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "End" });
    expect(screen.getByRole("tab", { name: "丙" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "丙" }), { key: "Home" });
    expect(first.getAttribute("aria-selected")).toBe("true");
  });

  it("当前页签在可视区外时滚进可视区", () => {
    render(<Harness initial="c" />);
    const list = screen.getByRole("tablist");
    const target = screen.getByRole("tab", { name: "丙" });
    // jsdom 没有布局：手工给出尺寸，模拟 100px 宽的页签条里第三个页签在 200–260px
    Object.defineProperty(list, "clientWidth", { configurable: true, value: 100 });
    Object.defineProperty(list, "scrollWidth", { configurable: true, value: 300 });
    Object.defineProperty(target, "offsetLeft", { configurable: true, value: 200 });
    Object.defineProperty(target, "offsetWidth", { configurable: true, value: 60 });
    fireEvent.click(screen.getByRole("tab", { name: "甲" }));
    fireEvent.click(target);
    expect(list.scrollLeft).toBe(160);
  });
});

describe("SidebarPageHead 用途句", () => {
  it("用途句为次要文字：小一号、单行截断，title 带全文（含当前状态）", () => {
    render(<SidebarPageHead icon={Route} title="故事推进" purpose="看写到哪、下一步写什么" status="第 3 章" />);
    const sub = screen.getByTestId("sidebar-page-head-sub");
    expect(sub.className).toContain("truncate");
    expect(sub.className).toContain("text-2xs");
    expect(sub.className).toContain("text-muted-foreground");
    expect(sub.getAttribute("title")).toBe("看写到哪、下一步写什么 · 当前：第 3 章");
  });
});
