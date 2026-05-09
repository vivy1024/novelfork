import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";

import type { VisibilityRuleDraft } from "./types";

export function VisibilityRuleEditor({
  value,
  onChange,
  nestedOptions,
}: {
  value: VisibilityRuleDraft;
  onChange: (next: VisibilityRuleDraft) => void;
  nestedOptions: ReadonlyArray<{ id: string; label: string }>;
}) {
  const updateNumber = (key: "visibleAfterChapter" | "visibleUntilChapter", raw: string) => {
    const parsed = raw.trim() === "" ? undefined : Number(raw);
    onChange({ ...value, [key]: Number.isFinite(parsed) ? parsed : undefined });
  };

  const parentIds = value.parentIds ?? [];

  return (
    <fieldset className="rounded-xl border border-border/50 bg-muted/20 p-4">
      <legend className="px-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">可见性规则</legend>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Type
          <SimpleSelect
            value={value.type}
            onValueChange={(val) => onChange({ ...value, type: val as VisibilityRuleDraft["type"] })}
            options={[
              { value: "global", label: "global：全局可见" },
              { value: "tracked", label: "tracked：文本命中后可见" },
              { value: "nested", label: "nested：父条目引入" },
            ]}
            className="w-full"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          起始章节
          <Input
            type="number"
            value={value.visibleAfterChapter ?? ""}
            onChange={(event) => updateNumber("visibleAfterChapter", event.target.value)}
            placeholder="不限制"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          结束章节
          <Input
            type="number"
            value={value.visibleUntilChapter ?? ""}
            onChange={(event) => updateNumber("visibleUntilChapter", event.target.value)}
            placeholder="不限制"
          />
        </label>
      </div>

      {value.type === "nested" && (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">Nested 父条目</div>
          <div className="flex flex-wrap gap-2">
            {nestedOptions.map((option) => {
              const checked = parentIds.includes(option.id);
              return (
                <label key={option.id} className={`rounded-full border px-3 py-1 text-xs ${checked ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground"}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...parentIds, option.id]
                        : parentIds.filter((id) => id !== option.id);
                      onChange({ ...value, parentIds: next });
                    }}
                    className="mr-1"
                  />
                  {option.label}
                </label>
              );
            })}
            {nestedOptions.length === 0 && <span className="text-xs text-muted-foreground">暂无可选父条目</span>}
          </div>
        </div>
      )}
    </fieldset>
  );
}
