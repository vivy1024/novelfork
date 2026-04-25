import { BookOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { JingweiSectionView } from "./types";

interface LegacyTabView<T extends string> {
  id: T;
  label: string;
}

interface JingweiSectionTabsProps<T extends string> {
  sections: JingweiSectionView[];
  activeSectionId: string | null;
  activeLegacyTab: T;
  legacyTabs: ReadonlyArray<LegacyTabView<T>>;
  onSelectSection: (section: JingweiSectionView) => void;
  onSelectLegacyTab: (tab: T) => void;
}

export function JingweiSectionTabs<T extends string>({
  sections,
  activeSectionId,
  activeLegacyTab,
  legacyTabs,
  onSelectSection,
  onSelectLegacyTab,
}: JingweiSectionTabsProps<T>) {
  const visibleSections = sections
    .filter((section) => section.enabled && section.showInSidebar)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  return (
    <aside className="rounded-2xl border border-border/40 bg-card/70 p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3 px-2">
        <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">经纬栏目</div>
        {visibleSections.length > 0 ? <Badge variant="outline">{visibleSections.length} 个启用</Badge> : null}
      </div>

      {visibleSections.length > 0 ? (
        <Tabs
          value={activeSectionId ?? visibleSections[0]?.id}
          onValueChange={(value) => {
            const section = visibleSections.find((item) => item.id === value);
            if (section) onSelectSection(section);
          }}
          orientation="vertical"
          className="block"
        >
          <TabsList variant="line" className="flex w-full flex-col items-stretch gap-1 bg-transparent p-0">
            {visibleSections.map((section) => (
              <TabsTrigger
                key={section.id}
                value={section.id}
                className="w-full justify-between rounded-xl px-3 py-2.5 text-left"
              >
                <span className="flex items-center gap-2"><BookOpen size={14} />{section.name}</span>
                {!section.participatesInAi ? <Badge variant="secondary">本地</Badge> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : (
        <div>
          {legacyTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onSelectLegacyTab(tab.id)}
              className={`mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-all ${activeLegacyTab === tab.id ? "bg-primary/10 font-bold text-primary" : "text-foreground hover:bg-muted/60"}`}
            >
              <span className="flex items-center gap-2"><BookOpen size={14} />{tab.label}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
