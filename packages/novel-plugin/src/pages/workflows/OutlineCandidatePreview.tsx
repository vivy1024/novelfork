/** 大纲候选：调整思路 + 逐章安排 + 风险。作者确认后由叙述者落到卷纲。 */
export function OutlineCandidatePreview({ payload }: { payload: Record<string, unknown> }) {
  const chapters = Array.isArray(payload.chapters) ? payload.chapters.map((item) => (item && typeof item === "object" ? item as Record<string, unknown> : {})) : [];
  const risks = Array.isArray(payload.risks) ? payload.risks.filter((item): item is string => typeof item === "string") : [];
  return (
    <div className="space-y-1 text-xs" data-testid="workflow-candidate-outline">
      {typeof payload.summary === "string" ? <div className="whitespace-pre-wrap">{payload.summary}</div> : null}
      <ol className="space-y-1">
        {chapters.map((chapter, index) => (
          <li key={index} className="rounded border bg-background p-2">
            <span className="font-medium">第 {String(chapter.chapter ?? "?")} 章{typeof chapter.title === "string" && chapter.title ? `「${chapter.title}」` : ""}</span>
            {typeof chapter.goal === "string" ? ` · 目标：${chapter.goal}` : ""}
            {typeof chapter.conflict === "string" ? ` · 冲突：${chapter.conflict}` : ""}
            {Array.isArray(chapter.hooks) && chapter.hooks.length > 0 ? ` · 伏笔：${chapter.hooks.map(String).join("、")}` : ""}
          </li>
        ))}
      </ol>
      {risks.length > 0 ? <ul className="list-disc space-y-0.5 pl-4 text-warning">{risks.map((risk, index) => <li key={index}>{risk}</li>)}</ul> : null}
      <div className="text-muted-foreground">确认后由叙述者按这份安排调整卷纲，不会自动改动书里的大纲。</div>
    </div>
  );
}
