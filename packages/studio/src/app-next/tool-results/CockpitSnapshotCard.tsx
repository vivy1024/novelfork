import { AlertTriangle, Gauge } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { ToolResultSurface } from "./ToolResultSurface";
import {
  asRecord,
  getNumber,
  getString,
  getToolResultData,
  type ToolResultArtifact,
  type ToolResultRendererContext,
} from "./types";

const BOOK_STATUS_LABEL: Record<string, string> = {
  incubating: "构思中",
  outlining: "规划中",
  active: "连载中",
  paused: "暂停",
  completed: "已完结",
  dropped: "已弃坑",
};

/** 快照里的列表都是 `{ status, items, reason? }`。 */
function listItems(value: unknown): Record<string, unknown>[] {
  const items = asRecord(value)?.items;
  return Array.isArray(items) ? items.flatMap((item) => (asRecord(item) ? [asRecord(item)!] : [])) : [];
}

function chapterArtifact(item: Record<string, unknown>): ToolResultArtifact | null {
  const artifact = asRecord(item.artifact);
  if (!artifact || artifact.openInCanvas !== true) return null;
  if (typeof artifact.kind !== "string" || typeof artifact.id !== "string") return null;
  return artifact as ToolResultArtifact;
}

/** 驾驶舱快照：进度、当前焦点、风险、待回收伏笔与近期章节（数据结构见 novel-plugin 的 CockpitSnapshot）。 */
export function CockpitSnapshotCard({ result, onOpenArtifact }: ToolResultRendererContext) {
  const data = asRecord(getToolResultData(result));
  const book = asRecord(data?.book);
  const progress = asRecord(data?.progress);
  const focus = asRecord(data?.currentFocus);
  const risks = listItems(data?.riskCards);
  const hooks = listItems(data?.openHooks);
  const chapters = listItems(data?.recentChapterResults).slice(0, 3);

  const status = getString(book?.status);
  const chapterCount = getNumber(progress?.chapterCount) ?? 0;
  const targetChapters = getNumber(progress?.targetChapters);
  const totalWords = getNumber(progress?.totalWords) ?? 0;
  const chapterWordTarget = getNumber(progress?.chapterWordTarget);
  const focusText = getString(focus?.content).trim();

  return (
    <ToolResultSurface
      testId="tool-result-cockpit"
      icon={<Gauge className="size-4 text-muted-foreground" />}
      title={getString(book?.title, "驾驶舱快照")}
      meta={status ? <Badge variant="secondary">{BOOK_STATUS_LABEL[status] ?? status}</Badge> : undefined}
    >
      <p className="text-xs text-muted-foreground">
        {chapterCount} 章{targetChapters ? ` / 目标 ${targetChapters} 章` : ""} · 共 {totalWords.toLocaleString()} 字
        {chapterWordTarget ? ` · 单章目标 ${chapterWordTarget.toLocaleString()} 字` : ""}
      </p>
      <p className="text-xs">
        <span className="text-muted-foreground">当前焦点：</span>
        {focusText ? <span className="line-clamp-3 whitespace-pre-line">{focusText}</span> : "未设置"}
      </p>
      {risks.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {risks.slice(0, 3).map((risk) => (
            <li key={getString(risk.id)} className="flex items-start gap-1.5 text-xs">
              <AlertTriangle className={risk.level === "danger" ? "mt-0.5 size-3.5 shrink-0 text-destructive" : "mt-0.5 size-3.5 shrink-0 text-muted-foreground"} />
              <span className="min-w-0">
                {getString(risk.title)}
                {getString(risk.detail) && <span className="text-muted-foreground">：{getString(risk.detail)}</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">暂无风险提示</p>
      )}
      <p className="text-xs">
        <span className="text-muted-foreground">待回收伏笔：</span>
        {hooks.length === 0 ? "无" : `${hooks.length} 条（${hooks.slice(0, 2).map((hook) => getString(hook.text)).filter(Boolean).join("；")}${hooks.length > 2 ? "……" : ""}）`}
      </p>
      {chapters.length > 0 && (
        <ul className="flex flex-col gap-1">
          {chapters.map((chapter) => {
            const artifact = chapterArtifact(chapter);
            return (
              <li key={getString(chapter.id)} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate">
                  第 {getNumber(chapter.chapterNumber) ?? "?"} 章 {getString(chapter.title)}
                  <span className="text-muted-foreground"> · {(getNumber(chapter.wordCount) ?? 0).toLocaleString()} 字</span>
                </span>
                {artifact && onOpenArtifact && (
                  <Button variant="ghost" size="sm" onClick={() => onOpenArtifact(artifact)}>
                    在画布打开
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </ToolResultSurface>
  );
}
