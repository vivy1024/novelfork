import { useCallback, useEffect, useMemo, useRef } from "react";

import { SplitView, usePanelLayout, type SplitViewHandle, type SplitViewPanel } from "@/components/split-view/SplitView";

// ---------------------------------------------------------------------------
// Placeholder panels
// ---------------------------------------------------------------------------

function SidebarPlaceholder() {
  return <div className="p-3 text-sm text-muted-foreground">Sidebar</div>;
}

function EditorPlaceholder() {
  return <div className="p-3 text-sm text-muted-foreground">Editor Area</div>;
}

function ConversationPlaceholder() {
  return <div className="p-3 text-sm text-muted-foreground">Conversation</div>;
}

// ---------------------------------------------------------------------------
// Layout defaults
// ---------------------------------------------------------------------------

const LAYOUT_KEY = "studio-main";

const LAYOUT_DEFAULTS = {
  widths: { sidebar: 220, editor: 600, conversation: 400 },
  collapsed: { sidebar: false, editor: false, conversation: false },
} as const;

// ---------------------------------------------------------------------------
// StudioApp
// ---------------------------------------------------------------------------

export function StudioApp() {
  const splitRef = useRef<SplitViewHandle>(null);
  const { layout } = usePanelLayout(LAYOUT_KEY, LAYOUT_DEFAULTS);

  const panels: SplitViewPanel[] = useMemo(
    () => [
      {
        id: "sidebar",
        content: <SidebarPlaceholder />,
        defaultWidth: LAYOUT_DEFAULTS.widths.sidebar,
        minWidth: 180,
        collapsible: true,
        collapsed: layout.collapsed.sidebar,
      },
      {
        id: "editor",
        content: <EditorPlaceholder />,
        defaultWidth: LAYOUT_DEFAULTS.widths.editor,
        minWidth: 200,
      },
      {
        id: "conversation",
        content: <ConversationPlaceholder />,
        defaultWidth: LAYOUT_DEFAULTS.widths.conversation,
        minWidth: 320,
        collapsible: true,
        collapsed: layout.collapsed.conversation,
      },
    ],
    [layout.collapsed.sidebar, layout.collapsed.conversation],
  );

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;

    switch (e.key.toLowerCase()) {
      case "b":
        e.preventDefault();
        splitRef.current?.toggleCollapse("sidebar");
        break;
      case "j":
        e.preventDefault();
        splitRef.current?.toggleCollapse("conversation");
        break;
      case "1":
        e.preventDefault();
        focusPanel("sidebar");
        break;
      case "2":
        e.preventDefault();
        focusPanel("editor");
        break;
      case "3":
        e.preventDefault();
        focusPanel("conversation");
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div data-testid="studio-app" className="h-full w-full">
      <SplitView
        ref={splitRef}
        panels={panels}
        className="h-full w-full"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function focusPanel(panelId: string): void {
  const el = document.querySelector(`[data-testid="split-panel-${panelId}"]`);
  if (el instanceof HTMLElement) {
    const focusable = el.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? el).focus();
  }
}
