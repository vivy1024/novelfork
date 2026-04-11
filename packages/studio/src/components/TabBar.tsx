/**
 * TabBar — IDE-style horizontal tab strip.
 * Renders open tabs with close buttons, theme toggle, and chat toggle.
 */

import { X, Sun, Moon, Bell, MessageSquare } from "lucide-react";
import type { Tab } from "../hooks/use-tabs";

interface TabBarProps {
  tabs: ReadonlyArray<Tab>;
  activeTabId: string;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  isDark: boolean;
  onToggleTheme: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  isDark,
  onToggleTheme,
  chatOpen,
  onToggleChat,
}: TabBarProps) {
  return (
    <header className="h-10 shrink-0 flex items-center border-b border-border/40 bg-background">
      {/* Tab strip */}
      <div className="flex-1 flex items-center overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-1.5 px-3 h-10 text-xs font-medium cursor-pointer border-r border-border/30 select-none shrink-0 transition-colors ${
                isActive
                  ? "bg-background text-foreground border-b-2 border-b-primary"
                  : "bg-secondary/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              }`}
              onClick={() => onActivate(tab.id)}
              onMouseDown={(e) => {
                // Middle-click to close
                if (e.button === 1 && tab.closable) {
                  e.preventDefault();
                  onClose(tab.id);
                }
              }}
            >
              <span className="truncate max-w-[120px]">{tab.label}</span>
              {tab.closable && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  className="w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-foreground/10 transition-all"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-1.5 px-3 shrink-0">
        <button
          onClick={onToggleTheme}
          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
          title={isDark ? "Light Mode" : "Dark Mode"}
        >
          {isDark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-all relative">
          <Bell size={14} />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-primary rounded-full" />
        </button>
        <button
          onClick={onToggleChat}
          className={`w-7 h-7 flex items-center justify-center rounded-md transition-all ${
            chatOpen
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-primary hover:bg-primary/10"
          }`}
          title="Toggle AI Assistant"
        >
          <MessageSquare size={14} />
        </button>
      </div>
    </header>
  );
}
