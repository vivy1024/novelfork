/**
 * 情节点预算编辑器 —— 让作者直接编辑本章节奏，而不是只能看模型给的一版。
 *
 * 纪律：本组件不调用任何工具、不发网络请求。它只做两件事：
 * 1. 编辑情节点数据（增删、排序、改字段）；
 * 2. 用 checkBeatBudget 做本地即时校验，给作者当场反馈。
 * 权威校验仍在后端 scene.spec / pipeline.write，本地结果只是预览。
 */

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { checkBeatBudget, type BeatBudgetItem, type BeatDensity } from "../../handlers/beat-budget";

export interface BeatBudgetEditorProps {
  /** 本章目标字数。0 表示未知，此时不做本地校验。 */
  readonly chapterTarget: number;
  readonly value: readonly BeatBudgetItem[];
  readonly onChange: (next: BeatBudgetItem[]) => void;
  readonly disabled?: boolean;
}

const DENSITY_OPTIONS: readonly { readonly value: BeatDensity; readonly label: string }[] = [
  { value: "dense", label: "密（展开）" },
  { value: "normal", label: "中（常规）" },
  { value: "sparse", label: "疏（带过）" },
];

function newBeat(): BeatBudgetItem {
  return { summary: "", density: "normal", words: 0 };
}

export function BeatBudgetEditor({ chapterTarget, value, onChange, disabled = false }: BeatBudgetEditorProps) {
  const beats = [...value];
  // chapterTarget 未知时不跑校验：拿不到目标字数就没有判定依据，不能编一个默认值。
  const report = chapterTarget > 0 ? checkBeatBudget({ chapterTarget, beats }) : null;

  const patch = (index: number, next: Partial<BeatBudgetItem>) => {
    const current = beats[index];
    if (!current) return;
    const updated = [...beats];
    updated[index] = { ...current, ...next };
    onChange(updated);
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= beats.length) return;
    const updated = [...beats];
    const moved = updated[index]!;
    updated[index] = updated[target]!;
    updated[target] = moved;
    onChange(updated);
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="beat-budget-editor">
      {beats.length === 0 && (
        <p className="text-2xs text-muted-foreground">
          还没有情节点。不拆点时只有「本章总字数」一个约束，容易平均用力。
        </p>
      )}

      {beats.map((beat, index) => (
        <div key={`beat-${index}`} className="rounded border border-border bg-background/60 px-1.5 py-1">
          <div className="flex items-center gap-1">
            <span className="shrink-0 text-2xs text-muted-foreground">#{index + 1}</span>
            <input
              type="text"
              value={beat.summary}
              disabled={disabled}
              onChange={(event) => patch(index, { summary: event.target.value })}
              placeholder="发生什么（如：赵铭当场要求改标注）"
              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-2xs outline-none focus:border-primary"
              data-testid={`beat-editor-summary-${index}`}
            />
            <button
              type="button"
              disabled={disabled || index === 0}
              onClick={() => move(index, -1)}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
              aria-label={`上移第 ${index + 1} 个情节点`}
              data-testid={`beat-editor-up-${index}`}
            >
              <ArrowUp className="size-3" />
            </button>
            <button
              type="button"
              disabled={disabled || index === beats.length - 1}
              onClick={() => move(index, 1)}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
              aria-label={`下移第 ${index + 1} 个情节点`}
              data-testid={`beat-editor-down-${index}`}
            >
              <ArrowDown className="size-3" />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(beats.filter((_, position) => position !== index))}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-30"
              aria-label={`删除第 ${index + 1} 个情节点`}
              data-testid={`beat-editor-remove-${index}`}
            >
              <Trash2 className="size-3" />
            </button>
          </div>
          <div className="mt-0.5 flex items-center gap-1 pl-4">
            <select
              value={beat.density}
              disabled={disabled}
              onChange={(event) => patch(index, { density: event.target.value as BeatDensity })}
              className="rounded border border-border bg-background px-1 py-0.5 text-2xs outline-none"
              aria-label={`第 ${index + 1} 个情节点的密度`}
              data-testid={`beat-editor-density-${index}`}
            >
              {DENSITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              value={beat.words}
              disabled={disabled}
              onChange={(event) => patch(index, { words: Math.max(0, Number(event.target.value) || 0) })}
              className="w-16 rounded border border-border bg-background px-1 py-0.5 text-2xs outline-none focus:border-primary"
              aria-label={`第 ${index + 1} 个情节点的字数`}
              data-testid={`beat-editor-words-${index}`}
            />
            <span className="text-2xs text-muted-foreground">字</span>
            <input
              type="text"
              value={beat.function ?? ""}
              disabled={disabled}
              onChange={(event) => patch(index, { function: event.target.value })}
              placeholder="功能（冲突升级 / 信息揭示…）"
              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-2xs outline-none focus:border-primary"
              data-testid={`beat-editor-function-${index}`}
            />
          </div>
        </div>
      ))}

      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...beats, newBeat()])}
        className="flex items-center justify-center gap-1 rounded border border-dashed border-border px-2 py-1 text-2xs text-muted-foreground hover:bg-accent disabled:opacity-40"
        data-testid="beat-editor-add"
      >
        <Plus className="size-3" />
        添加情节点
      </button>

      {report === null ? (
        <p className="text-2xs text-muted-foreground" data-testid="beat-editor-budget-line">
          未知本章目标字数，无法校验预算。
        </p>
      ) : (
        <p
          className={`text-2xs ${report.ok ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`}
          data-testid="beat-editor-budget-line"
        >
          {report.budgetLine}
        </p>
      )}

      {report && report.findings.length > 0 && (
        <ul className="flex flex-col gap-0.5" data-testid="beat-editor-findings">
          {report.findings.map((finding, index) => (
            <li
              key={`${finding.code}-${index}`}
              className={`text-2xs ${finding.severity === "block" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}
              data-testid="beat-editor-finding"
            >
              {finding.whatHappened}
              {finding.suggestedAction ? ` → ${finding.suggestedAction}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
