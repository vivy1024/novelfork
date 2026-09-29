/**
 * 文风金库面板（T2.7）：每章 AI 原稿与作者改动的占比，以及可采纳为范文的改稿段。
 *
 * - 占比由服务端逐句比对现算（GET /style/vault），只读；
 * - 点开某章看改稿段（GET /style/vault/chapters/:n），勾选后采纳进文风预设的「作者改稿」来源，
 *   写入前读取预设版本号，冲突时提示重新载入，不覆盖别处的修改。
 */

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson, invalidateApiPaths, useApi } from "@/hooks/use-api";

interface AuthorShare {
  readonly aiChars: number;
  readonly authorChars: number;
  readonly totalChars: number;
  readonly authorRatio: number;
}

interface VaultChapter {
  readonly chapterNumber: number;
  readonly title: string;
  readonly hasAiDraft: boolean;
  readonly share?: AuthorShare;
  readonly error?: string;
}

interface VaultSummary {
  readonly chapters?: readonly VaultChapter[];
  readonly overallAuthorRatio?: number | null;
}

interface RevisionPair {
  readonly aiText: string;
  readonly authorText: string;
  readonly similarity: number;
}

interface VaultDetail {
  readonly revisionPairs?: readonly RevisionPair[];
}

const SCENE_TYPE_OPTIONS = [
  ["general", "通用"],
  ["dialogue", "对话"],
  ["action", "动作"],
  ["description", "描写"],
  ["interiority", "心理"],
  ["transition", "过渡"],
] as const;

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function vaultPath(bookId: string): string {
  return `/api/books/${encodeURIComponent(bookId)}/style/vault`;
}

function ChapterRevisions({ bookId, chapterNumber, onAdopted }: { readonly bookId: string; readonly chapterNumber: number; readonly onAdopted?: () => void }) {
  const { data, loading, error } = useApi<VaultDetail>(`${vaultPath(bookId)}/chapters/${chapterNumber}`);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [sceneTypes, setSceneTypes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ readonly tone: "ok" | "error"; readonly text: string } | null>(null);

  if (loading) return <p className="px-2 py-1 text-2xs text-muted-foreground">读取改稿…</p>;
  if (error) return <p className="px-2 py-1 text-2xs text-destructive">{String(error)}</p>;
  const pairs = data?.revisionPairs ?? [];
  if (pairs.length === 0) {
    return <p className="px-2 py-1 text-2xs text-muted-foreground">这一章还没有「改过但认得出」的段落：要么原样保留了 AI 原稿，要么整段重写了。</p>;
  }

  const toggle = (index: number) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });

  const adopt = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const preset = await fetchJson<{ revision: string | null }>(`/api/books/${encodeURIComponent(bookId)}/style/preset`);
      await fetchJson(`${vaultPath(bookId)}/adopt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: preset.revision,
          samples: [...selected].map((index) => ({
            chapterNumber,
            authorText: pairs[index]!.authorText,
            aiText: pairs[index]!.aiText,
            sceneType: sceneTypes[index] ?? "general",
          })),
        }),
      });
      setMessage({ tone: "ok", text: `已把 ${selected.size} 段改稿采纳为本书范文，下一章写作时会优先作为示例。` });
      setSelected(new Set());
      invalidateApiPaths([`/api/books/${encodeURIComponent(bookId)}/style/preset`]);
      window.dispatchEvent(new CustomEvent("novelfork:style-preset-updated", { detail: { bookId } }));
      onAdopted?.();
    } catch (adoptError) {
      setMessage({ tone: "error", text: adoptError instanceof Error ? adoptError.message : "采纳失败。" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 px-2 pb-2">
      {pairs.map((pair, index) => (
        <div key={index} className="space-y-1.5 rounded-md border border-border/60 bg-background/60 p-2">
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <div className="mb-0.5 text-2xs font-medium text-muted-foreground">AI 原文</div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground line-through decoration-muted-foreground/40">{pair.aiText}</p>
            </div>
            <div>
              <div className="mb-0.5 text-2xs font-medium text-muted-foreground">作者改稿</div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed">{pair.authorText}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-2xs">
              <input
                type="checkbox"
                checked={selected.has(index)}
                onChange={() => toggle(index)}
                aria-label={`选中第 ${chapterNumber} 章改稿段 ${index + 1}`}
              />
              采纳这段
            </label>
            <label className="flex items-center gap-1 text-2xs text-muted-foreground">
              场景
              <select
                className="rounded border border-border bg-background px-1 py-0.5 text-2xs"
                value={sceneTypes[index] ?? "general"}
                onChange={(event) => setSceneTypes((current) => ({ ...current, [index]: event.target.value }))}
                aria-label={`第 ${chapterNumber} 章改稿段 ${index + 1} 的场景类型`}
              >
                {SCENE_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        {message ? (
          <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-2xs text-destructive" : "text-2xs text-muted-foreground"}>{message.text}</p>
        ) : <span />}
        <Button size="sm" className="gap-1" disabled={busy || selected.size === 0} onClick={() => void adopt()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          采纳为范文（{selected.size}）
        </Button>
      </div>
    </div>
  );
}

export function StyleVaultPanel({ bookId }: { readonly bookId: string }) {
  const { data, loading } = useApi<VaultSummary>(vaultPath(bookId));
  const [openChapter, setOpenChapter] = useState<number | null>(null);
  const drafted = (data?.chapters ?? []).filter((chapter) => chapter.hasAiDraft);

  return (
    <Card aria-label="文风金库">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          文风金库
          {typeof data?.overallAuthorRatio === "number" ? <Badge variant="secondary">全书作者改动 {percent(data.overallAuthorRatio)}</Badge> : null}
        </CardTitle>
        <CardDescription>
          AI 写完一章会留一份原稿。你改过之后，这里逐句比对出作者改动的占比；改过的段落可以采纳为本书范文，下一章写作时优先作为示例。占比只反映你改了多少，不代表任何检测工具的判断。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {loading ? <p className="text-xs text-muted-foreground">读取中…</p> : null}
        {!loading && drafted.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有 AI 写的章节。叙述者用写作管线或 chapter.write 写章后，这里会出现对照。</p>
        ) : null}
        {drafted.map((chapter) => {
          const open = openChapter === chapter.chapterNumber;
          return (
            <div key={chapter.chapterNumber} className="rounded-md border border-border/50">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/40"
                onClick={() => setOpenChapter(open ? null : chapter.chapterNumber)}
                aria-expanded={open}
              >
                {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                <span className="min-w-0 flex-1 truncate">第 {chapter.chapterNumber} 章 · {chapter.title}</span>
                {chapter.error ? (
                  <span className="text-2xs text-destructive">{chapter.error}</span>
                ) : chapter.share ? (
                  <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <span className="block h-full bg-primary" style={{ width: percent(chapter.share.authorRatio) }} />
                    </span>
                    作者改动 {percent(chapter.share.authorRatio)}
                  </span>
                ) : null}
              </button>
              {open ? (
                <ChapterRevisions
                  bookId={bookId}
                  chapterNumber={chapter.chapterNumber}
                  onAdopted={() => invalidateApiPaths([vaultPath(bookId)])}
                />
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
