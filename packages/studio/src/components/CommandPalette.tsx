import { Command } from "cmdk";
import type { TFunction } from "../hooks/use-i18n";
import type { Tab } from "../hooks/use-tabs";

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toBookCreate: () => void;
  toConfig: () => void;
  toDaemon: () => void;
  toLogs: () => void;
  toGenres: () => void;
  toStyle: () => void;
  toImport: () => void;
  toRadar: () => void;
  toDoctor: () => void;
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
  const run = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <Command
        className="w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl overflow-hidden"
        label="Command Palette"
      >
        <Command.Input
          placeholder={t("common.enterCommand")}
          className="w-full px-4 py-3 text-sm bg-transparent border-b border-border outline-none placeholder:text-muted-foreground"
          autoFocus
        />
        <Command.List className="max-h-72 overflow-y-auto p-2">
          <Command.Empty className="px-4 py-6 text-sm text-muted-foreground text-center">
            No results found.
          </Command.Empty>

          {/* Navigation */}
          <Command.Group heading="Navigation" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
            <Item onSelect={() => run(nav.toDashboard)}>Dashboard</Item>
            <Item onSelect={() => run(nav.toGenres)}>{t("create.genre")}</Item>
            <Item onSelect={() => run(nav.toConfig)}>{t("nav.config")}</Item>
            <Item onSelect={() => run(nav.toStyle)}>{t("nav.style")}</Item>
            <Item onSelect={() => run(nav.toImport)}>{t("nav.import")}</Item>
            <Item onSelect={() => run(nav.toRadar)}>{t("nav.radar")}</Item>
            <Item onSelect={() => run(nav.toDoctor)}>{t("nav.doctor")}</Item>
            <Item onSelect={() => run(nav.toDaemon)}>{t("nav.daemon")}</Item>
            <Item onSelect={() => run(nav.toLogs)}>{t("logs.title")}</Item>
            <Item onSelect={() => run(onNewBook)}>{t("nav.newBook")}</Item>
          </Command.Group>

          {/* Open Tabs */}
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

function Item({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="px-3 py-2 text-sm rounded-md cursor-pointer text-foreground aria-selected:bg-primary/10 aria-selected:text-primary transition-colors"
    >
      {children}
    </Command.Item>
  );
}
