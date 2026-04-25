import { Input } from "@/components/ui/input";

import type { JingweiEntryView, JingweiVisibilityRuleType, JingweiVisibilityRuleView } from "./types";

interface VisibilityRuleEditorProps {
  value: JingweiVisibilityRuleView;
  entries: JingweiEntryView[];
  onChange: (value: JingweiVisibilityRuleView) => void;
}

export function VisibilityRuleEditor({ value, entries, onChange }: VisibilityRuleEditorProps) {
  const setPatch = (patch: Partial<JingweiVisibilityRuleView>) => onChange({ ...value, ...patch });
  const parentIds = new Set(value.parentEntryIds ?? []);

  return (
    <fieldset className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
      <legend className="px-1 text-sm font-semibold">可见性规则</legend>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-sm font-medium">可见性类型
          <select value={value.type} onChange={(event) => setPatch({ type: event.target.value as JingweiVisibilityRuleType })} className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
            <option value="tracked">tracked：命中正文后注入</option>
            <option value="global">global：章节范围内常驻</option>
            <option value="nested">nested：被关联时展开</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">起始章节
          <Input type="number" value={value.visibleAfterChapter ?? ""} placeholder="不限制" onChange={(event) => setPatch({ visibleAfterChapter: readNumber(event.target.value) })} />
        </label>
        <label className="space-y-1 text-sm font-medium">结束章节
          <Input type="number" value={value.visibleUntilChapter ?? ""} placeholder="不限制" onChange={(event) => setPatch({ visibleUntilChapter: readNumber(event.target.value) })} />
        </label>
      </div>
      <label className="space-y-1 text-sm font-medium">关键词
        <Input value={(value.keywords ?? []).join(",")} onChange={(event) => setPatch({ keywords: splitList(event.target.value) })} />
      </label>
      {entries.length > 0 ? (
        <div className="space-y-2">
          <div className="text-sm font-medium">父条目 / 关联触发</div>
          <div className="grid gap-2 md:grid-cols-2">
            {entries.map((entry) => (
              <label key={entry.id} className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/70 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={parentIds.has(entry.id)}
                  aria-label={`关联条目：${entry.title}`}
                  onChange={(event) => {
                    const next = new Set(parentIds);
                    if (event.target.checked) next.add(entry.id);
                    else next.delete(entry.id);
                    setPatch({ parentEntryIds: [...next] });
                  }}
                />
                {entry.title}
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

function splitList(value: string): string[] {
  return value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
}

function readNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
