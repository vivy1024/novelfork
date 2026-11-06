/**
 * 侧栏页签条：真正的 tablist / tab 语义（aria-selected、aria-controls、方向键切换）。
 *
 * 作品基础、故事推进两块侧栏共用。页签固定单行、可横向滚动（窄侧栏下换行会把页签挤成两三行、
 * 压掉内容区）；当前页签始终滚进可见区，溢出时两侧出现滚动按钮，方向键 / Home / End 也能逐个走到。
 * 面板一侧用 `sidebarTabPanelProps` 给内容区挂上 role=tabpanel 与对应的 aria-labelledby。
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface SidebarTabItem<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly count?: number;
  readonly title?: string;
  readonly icon?: ReactNode;
}

function tabDomId(idPrefix: string, id: string): string {
  return `${idPrefix}-tab-${id}`;
}

function panelDomId(idPrefix: string, id: string): string {
  return `${idPrefix}-panel-${id}`;
}

/** 内容区的 tabpanel 属性，与 SidebarTabs 的同名 idPrefix 配对。 */
export function sidebarTabPanelProps(idPrefix: string, id: string) {
  return {
    role: "tabpanel" as const,
    id: panelDomId(idPrefix, id),
    "aria-labelledby": tabDomId(idPrefix, id),
  };
}

export function SidebarTabs<Id extends string>({
  tabs,
  active,
  onChange,
  ariaLabel,
  idPrefix,
  size = "md",
  testId,
}: {
  readonly tabs: readonly SidebarTabItem<Id>[];
  readonly active: Id;
  readonly onChange: (id: Id) => void;
  readonly ariaLabel: string;
  /** 页签与面板 id 的前缀；同一页面里多组页签必须不同。 */
  readonly idPrefix: string;
  /** md：主页签（下划线样式）；sm：二级分类（胶囊样式）。 */
  readonly size?: "md" | "sm";
  readonly testId?: string;
}) {
  const buttonsRef = useRef(new Map<Id, HTMLButtonElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const updateOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  // 当前页签滚进可见区：切换、页签数变化、侧栏宽度变化时都对齐一次。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const reveal = () => {
      const button = buttonsRef.current.get(active);
      if (button) {
        const start = button.offsetLeft - el.offsetLeft;
        const end = start + button.offsetWidth;
        if (start < el.scrollLeft) el.scrollLeft = start;
        else if (end > el.scrollLeft + el.clientWidth) el.scrollLeft = end - el.clientWidth;
      }
      updateOverflow();
    };
    reveal();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(reveal);
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, tabs.length, updateOverflow]);

  const scrollByPage = (direction: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(80, el.clientWidth * 0.7), behavior: "smooth" });
  };

  // 方向键在页签之间移动并直接切换（WAI-ARIA 自动激活模式）；Home/End 跳到首尾。
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = tabs[next]!;
    onChange(target.id);
    buttonsRef.current.get(target.id)?.focus();
  };

  // 滚动按钮只给鼠标用（键盘已有方向键），不进 Tab 序列，也不读给读屏。
  const scrollButton = (direction: -1 | 1) => (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      title={direction < 0 ? "向左滚动页签" : "向右滚动页签"}
      data-testid={testId ? `${testId}-scroll-${direction < 0 ? "left" : "right"}` : undefined}
      onClick={() => scrollByPage(direction)}
      className={`absolute inset-y-0 z-10 flex w-5 items-center justify-center text-muted-foreground hover:text-foreground ${
        direction < 0 ? "left-0 bg-gradient-to-r" : "right-0 bg-gradient-to-l"
      } from-card via-card/90 to-transparent`}
    >
      {direction < 0 ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
    </button>
  );

  return (
    <div
      className={size === "md"
        ? "relative shrink-0 border-b border-border bg-muted/10"
        : "relative shrink-0 border-b border-border/60"}
      data-overflow-left={overflow.left || undefined}
      data-overflow-right={overflow.right || undefined}
    >
    {overflow.left ? scrollButton(-1) : null}
    <div
      ref={scrollRef}
      role="tablist"
      aria-label={ariaLabel}
      data-testid={testId}
      onScroll={updateOverflow}
      onWheel={(event) => {
        // 竖向滚轮换算成横向，鼠标用户不必按 Shift
        if (event.deltaY !== 0 && event.currentTarget.scrollWidth > event.currentTarget.clientWidth) event.currentTarget.scrollLeft += event.deltaY;
      }}
      className={`flex flex-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${size === "md"
        ? "items-end gap-0.5 px-2 pt-1.5"
        : "gap-1 px-2 py-1.5"}`}
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) buttonsRef.current.set(tab.id, node);
              else buttonsRef.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={tabDomId(idPrefix, tab.id)}
            aria-selected={selected}
            aria-controls={panelDomId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            title={tab.title}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={size === "md"
              ? `flex shrink-0 items-center gap-1 whitespace-nowrap rounded-t-md border-b-2 px-2 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selected ? "border-primary bg-background text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`
              : `flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined ? (
              <span className={`tabular-nums font-normal ${selected ? (size === "md" ? "text-primary/80" : "text-primary-foreground/80") : "text-muted-foreground"}`}>
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
    {overflow.right ? scrollButton(1) : null}
    </div>
  );
}
