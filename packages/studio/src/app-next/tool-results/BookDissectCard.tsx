import { FileSearch, Users, Globe, Link2, ClipboardCheck } from "lucide-react";

import { asRecord, getNumber, getString, getStringArray, getToolResultData, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function names(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const record = asRecord(item);
      if (record) {
        const name = getString(record.name) || getString(record.title) || getString(record.summary);
        return name ? [name] : [];
      }
      return typeof item === "string" && item.trim() ? [item.trim()] : [];
    })
    .slice(0, limit);
}

function StatRow({ icon: Icon, label, count, samples }: {
  icon: typeof Users;
  label: string;
  count: number;
  samples: readonly string[];
}) {
  if (count === 0) return null;
  return (
    <li className="flex items-start gap-1.5 text-xs">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <span className="text-foreground">{label} {count}</span>
        {samples.length > 0 && (
          <span className="ml-1 text-muted-foreground">{samples.join("、")}{count > samples.length ? " …" : ""}</span>
        )}
      </div>
    </li>
  );
}

/** book.dissect 采纳卡：抽取结果落在 needs-review，等作者确认后才升 canon。 */
export const BookDissectCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;

  const knowledge = asRecord(data.knowledge) ?? asRecord(data.draft);
  const fromChapter = getNumber(data.fromChapter);
  const toChapter = getNumber(data.toChapter);
  const applied = data.applied === true;
  const settled = data.settled === true;
  const summary = getString(data.summary);

  const characterCount = countOf(knowledge?.characterCards) || getStringArray(knowledge?.characters).length;
  const worldCount = countOf(knowledge?.worldElements);
  const hookCount = countOf(knowledge?.openHooks) || getStringArray(knowledge?.hooks).length;
  const summaryCount = countOf(knowledge?.detailedSummaries) || countOf(knowledge?.chapterSummaries);
  const suggestedFocus = getString(knowledge?.suggestedFocus);

  return (
    <div data-testid="tool-result-book-dissect" className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex items-center gap-2">
        <FileSearch className="size-4 text-primary" />
        <span className="font-medium">拆书结果</span>
        {fromChapter && toChapter && (
          <span className="text-xs text-muted-foreground">第 {fromChapter}–{toChapter} 章</span>
        )}
      </div>

      <ul className="space-y-1">
        <StatRow icon={Users} label="人物" count={characterCount} samples={names(knowledge?.characterCards, 4).length > 0 ? names(knowledge?.characterCards, 4) : getStringArray(knowledge?.characters).slice(0, 4)} />
        <StatRow icon={Globe} label="世界设定" count={worldCount} samples={names(knowledge?.worldElements, 3)} />
        <StatRow icon={Link2} label="未收伏笔" count={hookCount} samples={names(knowledge?.openHooks, 2).length > 0 ? names(knowledge?.openHooks, 2) : getStringArray(knowledge?.hooks).slice(0, 2)} />
        <StatRow icon={ClipboardCheck} label="章摘要" count={summaryCount} samples={[]} />
      </ul>

      {suggestedFocus && (
        <p className="text-xs text-muted-foreground">
          建议下一步焦点：<span className="text-foreground">{suggestedFocus}</span>
        </p>
      )}

      <div className="border-t border-border pt-2 text-xs text-muted-foreground">
        {applied ? (
          <p>
            已写入经纬，状态为 <span className="text-amber-500">needs-review（待确认）</span>。
            确认无误后再升为 canon；有幻觉的条目直接改或删。
          </p>
        ) : (
          <p>仅预览，未写入经纬。确认后用 book.dissect(apply=true) 落库为待确认档。</p>
        )}
        {settled && <p>已同时结算叙事记忆。</p>}
        {summary && <p className="mt-1">{summary}</p>}
      </div>
    </div>
  );
};
