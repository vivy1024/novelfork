import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Save, Trash2, Loader2, X, History, Link, RotateCcw } from "lucide-react";
import type { JingweiEntry } from "./hooks/useJingweiEntries";

interface JingweiEntryFormProps {
  entry: JingweiEntry;
  bookId?: string;
  onSave: (entryId: string, payload: {
    title: string;
    contentMd?: string;
    fields: Record<string, unknown>;
    visibility: "global" | "tracked" | "nested";
    aliases?: string[];
    relatedEntryIds?: string[];
    visibleAfterChapter?: number | null;
    visibleUntilChapter?: number | null;
  }) => Promise<boolean>;
  onDelete: (entryId: string) => Promise<boolean>;
  onClose: () => void;
}

export function JingweiEntryForm({ entry, bookId, onSave, onDelete, onClose }: JingweiEntryFormProps) {
  const [title, setTitle] = useState(entry.title);
  const [contentMd, setContentMd] = useState(entry.contentMd ?? "");
  const [category, setCategory] = useState(entry.category);
  const [layer, setLayer] = useState<"canon" | "dynamic" | "reference">(entry.layer ?? "dynamic");
  const [visibility, setVisibility] = useState<"global" | "tracked" | "nested">(entry.visibility ?? "tracked");
  const [priorityTier, setPriorityTier] = useState<"auto" | "core" | "relevant" | "reference">(entry.priorityTier ?? "auto");
  const [status, setStatus] = useState<string>(entry.status ?? "confirmed");
  const [aliases, setAliases] = useState<string[]>(entry.aliases ?? []);
  const [aliasInput, setAliasInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setTitle(entry.title);
    setContentMd(entry.contentMd ?? "");
    setCategory(entry.category);
    setLayer(entry.layer ?? "dynamic");
    setVisibility(entry.visibility ?? "tracked");
    setPriorityTier(entry.priorityTier ?? "auto");
    setStatus(entry.status ?? "confirmed");
    setAliases(entry.aliases ?? []);
    setAliasInput("");
    setError(null);
    setShowHistory(false);
  }, [entry.id]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const ok = await onSave(entry.id, {
      title: title.trim(),
      contentMd,
      fields: { category, layer, status },
      visibility,
      aliases,
    });
    if (!ok) setError("保存失败");
    setSaving(false);
  }

  async function handleDelete() {
    const ok = await onDelete(entry.id);
    if (!ok) setError("删除失败");
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0 border-l border-border">
      {/* Header: title + status */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        <Input value={title} onChange={e => setTitle(e.target.value)} className="text-sm h-8 font-medium flex-1" />
        <StatusBadge status={status} onChange={setStatus} />
        <Button size="xs" variant="ghost" onClick={onClose}><X className="size-3" /></Button>
      </div>

      {/* Metadata bar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border flex-wrap text-xs">
        <MetaField label="分类">
          <Input value={category} onChange={e => setCategory(e.target.value)} className="h-6 w-28 text-xs" />
        </MetaField>
        <MetaField label="层级">
          <SimpleSelect value={layer} onValueChange={v => setLayer(v as "canon" | "dynamic" | "reference")} options={[
            { value: "canon", label: "Canon" },
            { value: "dynamic", label: "Dynamic" },
            { value: "reference", label: "Reference" },
          ]} className="w-24" />
        </MetaField>
        <MetaField label="可见性">
          <SimpleSelect value={visibility} onValueChange={v => setVisibility(v as "global" | "tracked" | "nested")} options={[
            { value: "global", label: "全局" },
            { value: "tracked", label: "追踪" },
            { value: "nested", label: "嵌套" },
          ]} className="w-20" />
        </MetaField>
        <MetaField label="优先级">
          <SimpleSelect value={priorityTier} onValueChange={v => setPriorityTier(v as "auto" | "core" | "relevant" | "reference")} options={[
            { value: "auto", label: "自动" },
            { value: "core", label: "核心" },
            { value: "relevant", label: "相关" },
            { value: "reference", label: "参考" },
          ]} className="w-20" />
        </MetaField>
      </div>

      {/* Aliases bar */}
      <div className="shrink-0 flex items-center gap-1 px-3 py-1 border-b border-border">
        <span className="text-[10px] text-muted-foreground">别名:</span>
        {aliases.map((a, i) => (
          <Badge key={i} variant="secondary" className="text-[10px] gap-0.5 pr-1">
            {a}
            <button onClick={() => setAliases(aliases.filter((_, j) => j !== i))} className="ml-0.5 hover:text-destructive">
              <X className="size-2" />
            </button>
          </Badge>
        ))}
        <Input
          value={aliasInput}
          onChange={e => setAliasInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && aliasInput.trim()) { setAliases([...aliases, aliasInput.trim()]); setAliasInput(""); e.preventDefault(); } }}
          placeholder="回车添加"
          className="h-5 w-24 text-[10px] border-none bg-transparent px-1"
        />
      </div>

      {/* Main body: markdown editor */}
      <div className="flex-1 min-h-0 p-2">
        <Textarea
          value={contentMd}
          onChange={e => setContentMd(e.target.value)}
          className="h-full w-full font-mono text-sm resize-none border-0 focus-visible:ring-0 bg-transparent"
          placeholder="在此编写设定内容（Markdown 格式）..."
        />
      </div>

      {/* Dependencies */}
      <DependenciesSection bookId={bookId} entryId={entry.id} />

      {/* Footer */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-border">
        <Button size="sm" disabled={saving} onClick={handleSave}>
          {saving ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Save className="size-3.5 mr-1" />}
          保存
        </Button>
        {entry.version && <span className="text-[10px] text-muted-foreground">v{entry.version}</span>}
        <Button size="xs" variant="ghost" onClick={() => setShowHistory(!showHistory)}>
          <History className="size-3 mr-1" />历史
        </Button>
        <span className="flex-1" />
        {error && <span className="text-xs text-destructive">{error}</span>}
        <Button size="xs" variant="ghost" className="text-destructive" onClick={handleDelete}>
          <Trash2 className="size-3" />
        </Button>
      </div>

      {/* Revision history panel (conditional) */}
      {showHistory && (
        <RevisionHistoryPanel
          bookId={bookId}
          entryId={entry.id}
          onReverted={(revision) => {
            setContentMd(revision.content_md);
            if (revision.category) setCategory(revision.category);
            if (revision.layer === "canon" || revision.layer === "dynamic" || revision.layer === "reference") setLayer(revision.layer);
          }}
        />
      )}
    </div>
  );
}

function DependenciesSection({ bookId, entryId }: { bookId?: string; entryId: string }) {
  const [deps, setDeps] = useState<{ dependsOn: any[]; dependedBy: any[] }>({ dependsOn: [], dependedBy: [] });
  const [addingDep, setAddingDep] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);

  useEffect(() => {
    if (!bookId) return;
    fetch(`/api/books/${bookId}/jingwei/entries/${entryId}/dependencies`)
      .then(r => r.json())
      .then(setDeps)
      .catch(() => {});
  }, [bookId, entryId]);

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim() || !bookId) { setSearchResults([]); return; }
    const r = await fetch(`/api/books/${bookId}/jingwei/search?q=${encodeURIComponent(q)}`);
    const d = await r.json();
    setSearchResults((d.results ?? []).filter((r: any) => r.id !== entryId));
  };

  const addDependency = async (targetId: string) => {
    if (!bookId) return;
    await fetch(`/api/books/${bookId}/jingwei/dependencies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceEntryId: entryId, targetEntryId: targetId }),
    });
    const r = await fetch(`/api/books/${bookId}/jingwei/entries/${entryId}/dependencies`);
    setDeps(await r.json());
    setAddingDep(false);
    setSearchQuery("");
    setSearchResults([]);
  };

  const removeDependency = async (depId: string) => {
    if (!bookId) return;
    await fetch(`/api/books/${bookId}/jingwei/dependencies/${depId}`, { method: "DELETE" });
    const r = await fetch(`/api/books/${bookId}/jingwei/entries/${entryId}/dependencies`);
    setDeps(await r.json());
  };

  const hasDeps = deps.dependsOn.length > 0 || deps.dependedBy.length > 0;
  if (!hasDeps && !addingDep) {
    return (
      <div className="px-3 py-1 border-t border-border">
        <button onClick={() => setAddingDep(true)} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
          <Link className="size-2.5" />添加关联
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 border-t border-border space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground font-medium">关联条目</span>
        {!addingDep && (
          <button onClick={() => setAddingDep(true)} className="text-[10px] text-primary hover:underline">+添加</button>
        )}
      </div>

      {deps.dependsOn.length > 0 && (
        <div className="space-y-0.5">
          <span className="text-[9px] text-muted-foreground">引用 →</span>
          {deps.dependsOn.map((d: any) => (
            <div key={d.depId} className="flex items-center gap-1 text-[10px]">
              <span className="text-foreground">{d.title}</span>
              <span className="text-muted-foreground">({d.category})</span>
              <button onClick={() => removeDependency(d.depId)} className="text-muted-foreground hover:text-destructive ml-auto">×</button>
            </div>
          ))}
        </div>
      )}

      {deps.dependedBy.length > 0 && (
        <div className="space-y-0.5">
          <span className="text-[9px] text-muted-foreground">← 被引用</span>
          {deps.dependedBy.map((d: any) => (
            <div key={d.depId} className="flex items-center gap-1 text-[10px]">
              <span className="text-foreground">{d.title}</span>
              <span className="text-muted-foreground">({d.category})</span>
            </div>
          ))}
        </div>
      )}

      {addingDep && (
        <div className="space-y-1">
          <Input
            value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
            placeholder="搜索要关联的条目..."
            className="text-xs h-6"
            autoFocus
          />
          {searchResults.map((r: any) => (
            <button key={r.id} onClick={() => addDependency(r.id)} className="w-full text-left text-[10px] px-2 py-1 rounded hover:bg-muted">
              {r.title} <span className="text-muted-foreground">({r.category})</span>
            </button>
          ))}
          <button onClick={() => { setAddingDep(false); setSearchQuery(""); setSearchResults([]); }} className="text-[10px] text-muted-foreground">取消</button>
        </div>
      )}
    </div>
  );
}

function MetaField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function StatusBadge({ status, onChange }: { status: string; onChange: (s: string) => void }) {
  const colors: Record<string, string> = {
    confirmed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    draft: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    "needs-review": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  const labels: Record<string, string> = { confirmed: "已确认", draft: "未确认", "needs-review": "需审查" };
  const next: Record<string, string> = { confirmed: "draft", draft: "needs-review", "needs-review": "confirmed" };

  return (
    <button
      onClick={() => onChange(next[status] ?? "confirmed")}
      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${colors[status] ?? colors.draft}`}
      title="点击切换状态"
    >
      {labels[status] ?? status}
    </button>
  );
}

interface RevisionHistoryRecord {
  id: string;
  reason?: string | null;
  changed_by: string;
  created_at: number;
  content_md: string;
  category?: string | null;
  layer?: string | null;
}

function RevisionHistoryPanel({
  bookId,
  entryId,
  onReverted,
}: {
  bookId?: string;
  entryId: string;
  onReverted?: (revision: RevisionHistoryRecord) => void;
}) {
  const [revisions, setRevisions] = useState<RevisionHistoryRecord[]>([]);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookId) return;
    fetch(`/api/books/${bookId}/jingwei/entries/${entryId}/revisions`)
      .then(r => r.json())
      .then(d => setRevisions(d.revisions ?? []))
      .catch(() => setRevisions([]));
  }, [bookId, entryId]);

  async function revert(revision: RevisionHistoryRecord): Promise<void> {
    if (!bookId || revertingId) return;
    setRevertingId(revision.id);
    setError(null);
    try {
      const response = await fetch(`/api/books/${bookId}/jingwei/entries/${entryId}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId: revision.id }),
      });
      if (!response.ok) throw new Error("回滚失败");
      onReverted?.(revision);
      setRevisions((current) => current.filter((item) => item.id !== revision.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "回滚失败");
    } finally {
      setRevertingId(null);
    }
  }

  if (revisions.length === 0) return <div className="px-3 py-2 text-xs text-muted-foreground border-t">暂无修改历史</div>;

  return (
    <div className="max-h-48 overflow-y-auto border-t border-border px-3 py-2 space-y-1">
      <p className="text-[10px] text-muted-foreground font-medium">修改历史（可回滚正文、分类与层级）</p>
      {error && <p className="text-[10px] text-destructive">{error}</p>}
      {revisions.map(r => (
        <div key={r.id} className="flex items-center gap-2 text-[10px]">
          <span className="text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</span>
          <span className={r.changed_by === "agent" || r.changed_by === "agent-write" ? "text-blue-500" : "text-foreground"}>{r.changed_by}</span>
          {r.reason && <span className="text-muted-foreground truncate flex-1">{r.reason}</span>}
          <Button size="xs" variant="ghost" disabled={revertingId !== null} onClick={() => void revert(r)} title="回滚到此版本">
            {revertingId === r.id ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
          </Button>
        </div>
      ))}
    </div>
  );
}
