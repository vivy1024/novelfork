import { useState } from "react";

import { FileDiff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fetchJson } from "@/hooks/use-api";

import { buildBookApiPath } from "../backend-contract";
import { ToolResultSurface } from "./ToolResultSurface";
import { getNumber, getString, getToolResultArtifact, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

function chars(text: string): number {
  return text.length;
}

/** chapter.propose_revision 的整章改动候选卡：before/after 摘要 + 采用/放弃；应用走 product 接口按 hash 闸门落盘。 */
export const ChapterRevisionCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const artifact = getToolResultArtifact(context.result);
  if (!artifact || artifact.kind !== "chapter-revision") return null;

  const bookId = getString(artifact.bookId);
  const chapterNumber = getNumber(artifact.chapterNumber);
  const reason = getString(artifact.reason);
  const originalHash = getString(artifact.originalHash);
  const newText = getString(artifact.newText);
  const originalPreview = getString(artifact.originalPreview);
  const newPreview = getString(artifact.newPreview);
  const originalExists = artifact.originalExists === true;
  const stats = (artifact.stats && typeof artifact.stats === "object" ? artifact.stats : {}) as Record<string, unknown>;

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [applied, setApplied] = useState(false);

  const apply = async () => {
    if (!bookId || !chapterNumber || !originalHash || !newText) {
      setNote({ tone: "error", text: "候选数据不完整，没法采用；请让叙述者重新提交候选。" });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await fetchJson(buildBookApiPath(bookId, "chapters", chapterNumber, "revision-apply"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originalHash, content: newText }),
      });
      setApplied(true);
      setNote({ tone: "ok", text: `第 ${chapterNumber} 章已按候选写入正文。` });
    } catch (err) {
      setNote({ tone: "error", text: err instanceof Error && err.message ? err.message : "采用失败" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolResultSurface
      testId="tool-result-chapter-revision"
      title={<>整章改动候选 · 第{chapterNumber ?? "?"}章</>}
      icon={<FileDiff className="size-4 text-primary" />}
      meta="未采用前不会写入正文"
    >
      {reason && <p className="text-xs text-foreground" data-testid="chapter-revision-reason">改动原因：{reason}</p>}
      <p className="text-2xs text-muted-foreground" data-testid="chapter-revision-stats">
        原 {getNumber(stats.originalChars) ?? 0} 字 → 新 {getNumber(stats.newChars) ?? chars(newText)} 字 ·
        保持一致 {getNumber(stats.unchangedParagraphs) ?? 0} 段 · 删 {getNumber(stats.removedParagraphs) ?? 0} 段 · 增 {getNumber(stats.addedParagraphs) ?? 0} 段
        {originalExists ? "" : "（该章原本不存在，按新建处理）"}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <p className="text-2xs text-muted-foreground">原文（前 600 字）</p>
          <p className="mt-0.5 max-h-24 overflow-y-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs" data-testid="chapter-revision-original">
            {originalPreview || "（无正文）"}
          </p>
        </div>
        <div>
          <p className="text-2xs text-muted-foreground">候选（前 600 字）</p>
          <p className="mt-0.5 max-h-24 overflow-y-auto whitespace-pre-wrap rounded bg-primary/10 p-2 text-xs" data-testid="chapter-revision-new">
            {newPreview || newText.slice(0, 600)}
          </p>
        </div>
      </div>
      {note ? (
        <p
          className={`text-2xs ${note.tone === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}
          data-testid="chapter-revision-note"
        >
          {note.text}
        </p>
      ) : null}
      {!applied ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs text-muted-foreground">采用那一刻的正文必须还是候选生成时的版本；不一致会被拒。</p>
          <Button size="sm" disabled={busy} onClick={() => void apply()} data-testid="chapter-revision-apply">
            {busy ? <Loader2 className="size-3 animate-spin" /> : null}
            采用候选
          </Button>
        </div>
      ) : (
        <p className="text-2xs text-emerald-700 dark:text-emerald-300" data-testid="chapter-revision-applied">已采用</p>
      )}
    </ToolResultSurface>
  );
};
