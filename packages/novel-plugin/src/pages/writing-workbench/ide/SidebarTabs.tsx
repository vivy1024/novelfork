/**
 * 侧栏页签条：真正的 tablist / tab 语义（aria-selected、aria-controls、方向键切换）。
 *
 * 作品基础、故事推进两块侧栏共用；窄侧栏下自动换行，不靠横向滚动藏页签。
 * 面板一侧用 `sidebarTabPanelProps` 给内容区挂上 role=tabpanel 与对应的 aria-labelledby。
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";

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

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-testid={testId}
      className={size === "md"
        ? "shrink-0 flex flex-wrap items-end gap-0.5 border-b border-border px-2 pt-1.5 bg-muted/10"
        : "shrink-0 flex flex-wrap gap-1 border-b border-border/60 px-2 py-1.5"}
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
  );
}
