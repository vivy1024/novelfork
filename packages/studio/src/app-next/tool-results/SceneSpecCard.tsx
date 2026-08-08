import { AlertTriangle, ChevronRight, MapPin, NotebookPen, Users, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { SecondaryModelCalls } from "./SecondaryModelCalls";
import { ToolResultSurface } from "./ToolResultSurface";
import { asRecord, getNumber, getString, getStringArray, getToolResultData, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

interface SceneRow {
  readonly key: string;
  readonly characters: readonly string[];
  readonly location: string;
  readonly conflict: string;
  readonly mood: string;
  readonly outcome: string;
  readonly hooksUsed: readonly string[];
  readonly hooksPlanted: readonly string[];
}

interface BeatRow {
  readonly key: string;
  readonly summary: string;
  readonly density: string;
  readonly words: number | null;
  readonly func: string;
}

interface BudgetFinding {
  readonly key: string;
  readonly severity: "block" | "warn";
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

function readScenes(value: unknown): SceneRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    return [{
      key: `scene-${index}`,
      characters: getStringArray(record.characters),
      location: getString(record.location),
      conflict: getString(record.conflict),
      mood: getString(record.mood),
      outcome: getString(record.outcome),
      hooksUsed: getStringArray(record.hooks_used),
      hooksPlanted: getStringArray(record.hooks_planted),
    }];
  });
}

function readBeats(value: unknown): BeatRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    return [{
      key: `beat-${index}`,
      summary: getString(record.summary, "(未命名情节点)"),
      density: getString(record.density, "normal"),
      words: getNumber(record.words),
      func: getString(record.function),
    }];
  });
}

/** beatBudget.findings 已经是三段式（whatHappened/whyItMatters/suggestedAction），照搬即可。 */
function readBudgetFindings(value: unknown): BudgetFinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    return [{
      key: `${getString(record.code, "finding")}-${index}`,
      severity: record.severity === "block" ? "block" : "warn",
      whatHappened: getString(record.whatHappened),
      whyItMatters: getString(record.whyItMatters),
      suggestedAction: getString(record.suggestedAction),
    }];
  });
}

const DENSITY_LABEL: Record<string, string> = { dense: "密", sparse: "疏", normal: "中" };

function BeatBar({ words, ceiling }: { words: number | null; ceiling: number }) {
  if (!words || ceiling <= 0) return null;
  const pct = Math.min(100, Math.round((words / ceiling) * 100));
  return (
    <span className="inline-block h-1 w-10 shrink-0 overflow-hidden rounded-full bg-muted align-middle">
      <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </span>
  );
}

/** scene.spec 写作蓝图卡：一眼看清场景与情节点节奏预算，预算不合规会拦 pipeline.write。 */
export const SceneSpecCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;

  const spec = asRecord(data.sceneSpec);
  if (!spec) return null;
  const budget = asRecord(data.beatBudget);
  const chapter = getNumber(spec.chapter);
  const specTitle = getString(spec.title);
  const wordTarget = getNumber(spec.wordTarget);
  const scenes = readScenes(spec.scenes);
  const beats = readBeats(spec.beatBudget);
  const constraints = getStringArray(spec.constraints);
  const budgetOk = budget?.ok === true;
  const budgetLine = getString(budget?.budgetLine);
  const ceiling = getNumber(budget?.ceiling) ?? (wordTarget ? Math.round(wordTarget * 1.1) : 0);
  const findings = readBudgetFindings(budget?.findings);
  const blockers = findings.filter((finding) => finding.severity === "block");

  return (
    <ToolResultSurface
      testId="tool-result-scene-spec"
      title={<>写作蓝图{chapter ? ` · 第${chapter}章` : ""}</>}
      icon={<NotebookPen className="size-4 text-primary" />}
      meta={`${scenes.length} 个场景${wordTarget ? ` · 目标 ${wordTarget} 字` : ""}`}
    >
      {specTitle && <p className="text-xs text-foreground">章标题：{specTitle}</p>}

      <ul className="flex flex-col gap-1.5">
        {scenes.map((scene, index) => (
          <li key={scene.key} className="text-xs">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-foreground">
              <span className="text-muted-foreground">场景 {index + 1}</span>
              {scene.characters.length > 0 && (
                <span className="inline-flex items-center gap-1"><Users className="size-3 shrink-0 text-muted-foreground" />{scene.characters.join("、")}</span>
              )}
              {scene.location && (
                <span className="inline-flex items-center gap-1 text-muted-foreground"><MapPin className="size-3 shrink-0" />{scene.location}</span>
              )}
            </p>
            {scene.conflict && <p className="text-muted-foreground">冲突：{scene.conflict}</p>}
            {(scene.mood || scene.outcome) && (
              <p className="text-muted-foreground">
                {scene.mood && <span>情绪：{scene.mood}</span>}
                {scene.mood && scene.outcome ? "　" : ""}
                {scene.outcome && <span>结果：{scene.outcome}</span>}
              </p>
            )}
          </li>
        ))}
      </ul>

      <Separator />
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-1.5 text-xs">
          {!budgetOk && <XCircle className="size-3.5 shrink-0 text-destructive" />}
          <span className={budgetOk ? "text-muted-foreground" : "text-destructive"}>
            {budgetLine || (beats.length > 0 ? `${beats.length} 个情节点` : "未拆情节点预算")}
          </span>
          {!budgetOk && <Badge variant="destructive">不合规</Badge>}
        </p>
        {beats.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">展开情节点预算（{beats.length} 点）</summary>
            <ul className="mt-1 flex flex-col gap-0.5">
              {beats.map((beat) => (
                <li key={beat.key} className="flex items-start gap-1.5 text-muted-foreground">
                  <span className="shrink-0 text-foreground">【{DENSITY_LABEL[beat.density] ?? beat.density}{beat.words ?? "?"}】</span>
                  <BeatBar words={beat.words} ceiling={ceiling} />
                  <span className="min-w-0">{beat.summary}{beat.func ? `（${beat.func}）` : ""}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {findings.length > 0 && (
        <>
          <Separator />
          <ul className="flex flex-col gap-1.5">
            {findings.map((finding) => (
              <li key={finding.key} className="text-xs">
                <div className="flex items-start gap-1.5">
                  {finding.severity === "block"
                    ? <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                    : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-foreground" />}
                  <div className="min-w-0">
                    <p className="text-foreground">{finding.whatHappened}</p>
                    {finding.whyItMatters && <p className="text-muted-foreground">{finding.whyItMatters}</p>}
                    {finding.suggestedAction && (
                      <p className="flex items-start gap-1 text-muted-foreground">
                        <ChevronRight className="mt-0.5 size-3 shrink-0" />
                        <span>{finding.suggestedAction}</span>
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {constraints.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">硬约束（{constraints.length}）</summary>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-muted-foreground">
            {constraints.map((constraint, index) => <li key={`constraint-${index}`}>{constraint}</li>)}
          </ul>
        </details>
      )}

      <SecondaryModelCalls value={data.modelCalls} />

      {blockers.length > 0 && (
        <p className="text-xs text-destructive">预算判为不合规，pipeline.write 会以 beat-budget-invalid 拒绝，请先重排预算再写章。</p>
      )}
    </ToolResultSurface>
  );
};
