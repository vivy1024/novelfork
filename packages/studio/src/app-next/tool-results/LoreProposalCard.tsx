import { useState } from "react";

import { BookOpenCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fetchJson } from "@/hooks/use-api";

import { buildBookApiPath } from "../backend-contract";

import { ToolResultSurface } from "./ToolResultSurface";
import { asRecord, getString, getToolResultArtifact, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

function show(value: unknown): string {
  if (value === null || value === undefined) return "（空）";
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  return JSON.stringify(value);
}

/** lore.propose_update 的经纬字段改动候选卡：字段级 before/after + 采用（fieldsPatch 合并，其余字段原样）。 */
export const LoreProposalCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const artifact = getToolResultArtifact(context.result);
  if (!artifact || artifact.kind !== "lore-update") return null;

  const bookId = getString(artifact.bookId);
  const entryId = getString(artifact.entryId);
  const entryTitle = getString(artifact.entryTitle);
  const category = getString(artifact.category);
  const reason = getString(artifact.reason);
  const fieldsPatch = asRecord(artifact.fieldsPatch) ?? {};
  const before = asRecord(artifact.before) ?? {};
  const keys = Object.keys(fieldsPatch);

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [applied, setApplied] = useState(false);

  const apply = async () => {
    if (!bookId || !entryId || keys.length === 0) {
      setNote({ tone: "error", text: "候选数据不完整，没法采用；请让叙述者重新提交候选。" });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await fetchJson(buildBookApiPath(bookId, "jingwei", "entries", entryId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldsPatch }),
      });
      setApplied(true);
      setNote({ tone: "ok", text: `条目「${entryTitle}」已按候选合并 ${keys.length} 个字段。` });
    } catch (err) {
      setNote({ tone: "error", text: err instanceof Error && err.message ? err.message : "采用失败" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolResultSurface
      testId="tool-result-lore-update"
      title={<>设定改动候选 · {entryTitle || entryId}</>}
      icon={<BookOpenCheck className="size-4 text-primary" />}
      meta={`${category}${category ? " · " : ""}未采用前不会写入条目`}
    >
      {reason && <p className="text-xs text-foreground" data-testid="lore-update-reason">改动原因：{reason}</p>}
      <ul className="flex flex-col gap-1" data-testid="lore-update-fields">
        {keys.map((key) => (
          <li key={key} className="rounded border border-border/60 bg-background/60 px-2 py-1 text-2xs">
            <div className="font-medium text-foreground">{key}</div>
            <div className="text-muted-foreground">改前：{show(before[key])}</div>
            <div className="text-foreground">改后：{show(fieldsPatch[key])}</div>
          </li>
        ))}
      </ul>
      {note ? (
        <p className={`text-2xs ${note.tone === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`} data-testid="lore-update-note">
          {note.text}
        </p>
      ) : null}
      {!applied ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs text-muted-foreground">只合并这几个字段；条目其他字段原样保留。</p>
          <Button size="sm" disabled={busy} onClick={() => void apply()} data-testid="lore-update-apply">
            {busy ? <Loader2 className="size-3 animate-spin" /> : null}
            采用候选
          </Button>
        </div>
      ) : (
        <p className="text-2xs text-emerald-700 dark:text-emerald-300" data-testid="lore-update-applied">已采用</p>
      )}
    </ToolResultSurface>
  );
};
