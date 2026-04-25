import { Trash2 } from "lucide-react";

import { JingweiEmptyState } from "@/components/layout/FeatureEmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { JingweiEntryView, JingweiSectionView } from "./types";

interface JingweiEntryListProps {
  section: JingweiSectionView;
  entries: JingweiEntryView[];
  loading?: boolean;
  onEdit: (entry: JingweiEntryView) => void;
  onDelete: (entry: JingweiEntryView) => void;
  onCreate?: () => void;
}

export function JingweiEntryList({ section, entries, loading, onEdit, onDelete, onCreate }: JingweiEntryListProps) {
  if (loading) return <div className="text-sm text-muted-foreground">条目加载中...</div>;
  if (entries.length === 0) {
    return <JingweiEmptyState sectionName={section.name} onCreateEntry={onCreate} />;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {entries.map((entry) => (
        <article key={entry.id} className="rounded-xl border border-border/50 bg-background/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <button type="button" className="text-left font-semibold hover:text-primary" onClick={() => onEdit(entry)}>{entry.title}</button>
              <div className="mt-1 text-xs text-muted-foreground">{entry.id}</div>
            </div>
            <Button type="button" size="icon-xs" variant="ghost" aria-label={`删除 ${entry.title}`} onClick={() => onDelete(entry)}>
              <Trash2 size={13} />
            </Button>
          </div>
          <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{entry.contentMd || "（无正文）"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline">visibility: {entry.visibilityRule.type}</Badge>
            {entry.participatesInAi ? <Badge>参与 AI</Badge> : <Badge variant="secondary">本地</Badge>}
            {entry.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
          </div>
        </article>
      ))}
    </div>
  );
}
