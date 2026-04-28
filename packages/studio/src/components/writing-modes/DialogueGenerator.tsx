import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { postApi } from "@/hooks/use-api";

export interface DialogueGeneratorProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly onInsert: (text: string) => void;
}

interface DialogueLine {
  readonly character: string;
  readonly line: string;
}

const PURPOSE_OPTIONS = ["推进剧情", "揭示性格", "制造冲突", "传递信息", "缓和气氛"] as const;

export function DialogueGenerator({ bookId, chapterNumber, onInsert }: DialogueGeneratorProps) {
  const [characters, setCharacters] = useState("");
  const [scene, setScene] = useState("");
  const [purpose, setPurpose] = useState<string>(PURPOSE_OPTIONS[0]);
  const [rounds, setRounds] = useState(5);
  const [lines, setLines] = useState<readonly DialogueLine[]>([]);
  const [promptPreview, setPromptPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await postApi<{ lines?: readonly DialogueLine[]; mode?: "prompt-preview"; promptPreview?: string; prompt?: string }>(`/books/${bookId}/dialogue/generate`, {
        characters: characters.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        scene: scene.trim(),
        purpose,
        rounds,
        chapterNumber,
      });
      if (res.mode === "prompt-preview" || res.promptPreview) {
        setPromptPreview(res.promptPreview ?? res.prompt ?? "");
        setLines([]);
      } else {
        setLines(res.lines ?? []);
        setPromptPreview(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const formatDialogue = () => lines.map((l) => `${l.character}："${l.line}"`).join("\n");

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3 text-sm">
      <span className="font-medium">对话生成</span>

      <Input placeholder="角色（逗号分隔）" value={characters} onChange={(e) => setCharacters(e.target.value)} aria-label="角色" />
      <Textarea placeholder="场景描述" value={scene} onChange={(e) => setScene(e.target.value)} className="min-h-14" aria-label="场景描述" />

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          aria-label="对话目的"
        >
          {PURPOSE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs">
          轮数
          <Input type="number" min={1} max={20} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} className="w-16" aria-label="轮数" />
        </label>
      </div>

      <Button type="button" size="sm" onClick={() => void generate()} disabled={loading || !characters.trim()}>
        {loading ? "生成中..." : "生成对话"}
      </Button>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {promptPreview && (
        <div className="space-y-2 rounded-lg border border-dashed border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Prompt 预览</span>
            <div className="flex gap-2">
              <Button type="button" size="xs" variant="outline" onClick={() => void navigator.clipboard?.writeText(promptPreview)}>复制 prompt</Button>
              <Button type="button" size="xs" disabled>执行生成（未接入）</Button>
            </div>
          </div>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-6 text-muted-foreground">{promptPreview}</pre>
        </div>
      )}

      {lines.length > 0 && (
        <div className="space-y-2">
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3">
            {lines.map((l, i) => (
              <p key={i}><span className="font-medium">{l.character}</span>："{l.line}"</p>
            ))}
          </div>
          <Button type="button" size="xs" onClick={() => onInsert(formatDialogue())}>插入到正文</Button>
        </div>
      )}
    </div>
  );
}
