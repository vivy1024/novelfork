import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { BibleContextPreview } from "./types";

export function ContextPreviewModal({
  open,
  preview,
  currentChapter,
  sceneText,
  loading,
  onCurrentChapterChange,
  onSceneTextChange,
  onPreview,
  onClose,
}: {
  open: boolean;
  preview: BibleContextPreview | null;
  currentChapter: number;
  sceneText: string;
  loading: boolean;
  onCurrentChapterChange: (value: number) => void;
  onSceneTextChange: (value: string) => void;
  onPreview: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
      <div className="max-h-[86vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between border-b border-border/60 p-5">
          <div>
            <h2 className="font-serif text-2xl font-semibold">预览 AI 上下文</h2>
            <p className="text-sm text-muted-foreground">按当前章节、sceneText 和 token 预算展示将注入写作 prompt 的故事经纬条目。</p>
          </div>
          <Button variant="ghost" onClick={onClose}>关闭</Button>
        </div>
        <div className="space-y-5 overflow-y-auto p-5">
          <div className="grid gap-3 md:grid-cols-[160px_1fr_auto]">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
              当前章节
              <Input
                type="number"
                value={currentChapter}
                onChange={(event) => onCurrentChapterChange(Number(event.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
              sceneText（用于 tracked 命中）
              <Input
                value={sceneText}
                onChange={(event) => onSceneTextChange(event.target.value)}
                placeholder="粘贴当前段落或场景关键词"
              />
            </label>
            <Button onClick={onPreview} disabled={loading} className="self-end">
              {loading ? "生成中..." : "刷新预览"}
            </Button>
          </div>

          {preview && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Stat label="模式" value={preview.mode} />
                <Stat label="Token 总数" value={String(preview.totalTokens)} />
                <Stat label="丢弃条目" value={preview.droppedIds.length ? preview.droppedIds.join(", ") : "无"} />
              </div>
              <div className="space-y-2">
                {preview.items.map((item) => (
                  <article key={item.id} className="rounded-xl border border-border/50 bg-background/70 p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded bg-primary/10 px-2 py-0.5 font-bold text-primary">{item.type}</span>
                      <span>{item.source}</span>
                      <span>{item.estimatedTokens} tokens</span>
                    </div>
                    <div className="font-semibold">{item.name}</div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{item.content}</p>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/70 p-4">
      <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
