import type { ReactNode } from "react";
import { Command } from "cmdk";

import { useApi } from "../hooks/use-api";
import type { TFunction } from "../hooks/use-i18n";
import type { Tab } from "../hooks/use-tabs";
import type { AdminSection, SettingsSection, WorkflowSection } from "../routes";

interface Nav {
  toDashboard: () => void;
  toWorkflow: (section?: WorkflowSection) => void;
  toSessions: () => void;
  toBookCreate: () => void;
  toGenres: () => void;
  toStyle: () => void;
  toImport: () => void;
  toRadar: () => void;
  toDoctor: () => void;
  toSearch: () => void;
  toAdmin: (section?: AdminSection) => void;
  toSettings: (section?: SettingsSection) => void;
}

interface CommandPaletteProps {
  readonly nav: Nav;
  readonly tabs: ReadonlyArray<Tab>;
  readonly activateTab: (tabId: string) => void;
  readonly onClose: () => void;
  readonly onNewBook: () => void;
  readonly t: TFunction;
}

export function CommandPalette({ nav, tabs, activateTab, onClose, onNewBook, t }: CommandPaletteProps) {
  const { data: userSettings } = useApi<{ preferences?: { workbenchMode?: boolean } }>("/settings/user");
  const workbenchModeEnabled = Boolean(userSettings?.preferences?.workbenchMode);

  const run = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-[20vh] backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Command
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        label="Command Palette"
      >
        <Command.Input
          placeholder={t("common.enterCommand")}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
          autoFocus
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-4 py-6 text-center text-sm text-muted-foreground">
            No results found.
          </Command.Empty>

          <Command.Group heading="Primary" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
            <Item onSelect={() => run(nav.toDashboard)}>项目总览</Item>
            <Item onSelect={() => run(nav.toSessions)}>会话中心</Item>
            {workbenchModeEnabled ? <Item onSelect={() => run(() => nav.toWorkflow())}>工作流配置</Item> : null}
            {workbenchModeEnabled ? <Item onSelect={() => run(() => nav.toAdmin())}>管理中心</Item> : null}
            <Item onSelect={() => run(() => nav.toSettings())}>设置</Item>
            <Item onSelect={() => run(onNewBook)}>{t("nav.newBook")}</Item>
          </Command.Group>

          {workbenchModeEnabled ? (
            <Command.Group heading="Workflow" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
              <Item onSelect={() => run(() => nav.toWorkflow("project"))}>项目与模型</Item>
              <Item onSelect={() => run(() => nav.toWorkflow("agents"))}>Agent</Item>
              <Item onSelect={() => run(() => nav.toWorkflow("toolchain"))}>工具链入口</Item>
              <Item onSelect={() => run(() => nav.toWorkflow("mcp"))}>MCP 工具</Item>
              <Item onSelect={() => run(() => nav.toWorkflow("diagnostics"))}>诊断面板</Item>
              <Item onSelect={() => run(() => nav.toWorkflow("plugins"))}>插件</Item>
            </Command.Group>
          ) : null}

          <Command.Group heading="Content Tools" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
            <Item onSelect={() => run(nav.toSearch)}>{t("nav.search")}</Item>
            <Item onSelect={() => run(nav.toStyle)}>{t("nav.style")}</Item>
            <Item onSelect={() => run(nav.toImport)}>{t("nav.import")}</Item>
            <Item onSelect={() => run(nav.toGenres)}>{t("create.genre")}</Item>
            <Item onSelect={() => run(nav.toRadar)}>{t("nav.radar")}</Item>
            <Item onSelect={() => run(nav.toDoctor)}>{t("nav.doctor")}</Item>
          </Command.Group>

          {workbenchModeEnabled ? (
            <Command.Group heading="Admin" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
              <Item onSelect={() => run(() => nav.toAdmin("providers"))}>供应商</Item>
              <Item onSelect={() => run(() => nav.toAdmin("resources"))}>资源监控</Item>
              <Item onSelect={() => run(() => nav.toAdmin("requests"))}>请求历史</Item>
              <Item onSelect={() => run(() => nav.toAdmin("daemon"))}>{t("nav.daemon")}</Item>
              <Item onSelect={() => run(() => nav.toAdmin("logs"))}>{t("logs.title")}</Item>
              <Item onSelect={() => run(() => nav.toAdmin("worktrees"))}>Worktree</Item>
            </Command.Group>
          ) : null}

          {tabs.length > 0 && (
            <Command.Group heading="Open Tabs" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
              {tabs.map((tab) => (
                <Item key={tab.id} onSelect={() => run(() => activateTab(tab.id))}>
                  {tab.label}
                </Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

function Item({ children, onSelect }: { children: ReactNode; onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="cursor-pointer rounded-md px-3 py-2 text-sm text-foreground transition-colors aria-selected:bg-primary/10 aria-selected:text-primary"
    >
      {children}
    </Command.Item>
  );
}
