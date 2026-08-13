/**
 * 实体详情抽屉。
 *
 * 打通经纬（静态设定）与叙事记忆（动态状态）的孤岛：点任意实体名，右侧滑出
 * 统一抽屉，上半看经纬设定、下半看当前 fact 并可就地纠正/作废/新增，附变迁史。
 *
 * 边界：
 * - 关联键 = 实体名字符串（经纬条目 title ↔ fact subject/object）；
 * - fact 编辑只走 narrative-fact-edits 封装，语义与后端对齐；
 * - 经纬设定只读展示 + 跳转，不在抽屉里代写 canon（改设定去经纬编辑器）；
 * - 关系 tab 用谓词分组列表表达显式实体关系，数据源就是当前实体的 fact，
 *   不额外请求、不做统计共现。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, Loader2, Plus, Trash2, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";

import {
  correctFact,
  createFact,
  fetchFactsByEntity,
  retireFact,
  type EntityFact,
} from "./narrative-fact-edits";

export interface EntityDetailDrawerProps {
  readonly bookId: string;
  /** 实体名（同时是经纬条目 title 与 fact subject/object 的关联键）。 */
  readonly entity: string;
  readonly onClose: () => void;
  /** 打开经纬条目；返回 false 表示条目未载入，与 WorkbenchCanvas 契约一致。 */
  readonly onOpenJingweiEntry?: (entryId: string) => boolean;
  readonly currentChapter?: number;
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly facts: readonly EntityFact[] };

/** 经纬条目的最小展示字段。 */
interface JingweiEntryHit {
  readonly id: string;
  readonly title?: string;
  readonly category?: string;
  readonly layer?: string;
  readonly status?: string;
  readonly summary?: string;
  readonly preview?: string;
  readonly contentMd?: string;
}

type JingweiState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly entries: readonly JingweiEntryHit[] };

export function EntityDetailDrawer({
  bookId,
  entity,
  onClose,
  onOpenJingweiEntry,
  currentChapter,
}: EntityDetailDrawerProps) {
  const [factsState, setFactsState] = useState<LoadState>({ status: "loading" });
  const [jingweiState, setJingweiState] = useState<JingweiState>({ status: "loading" });
  const factsGenerationRef = useRef(0);
  const jingweiGenerationRef = useRef(0);

  useEffect(() => () => {
    factsGenerationRef.current += 1;
    jingweiGenerationRef.current += 1;
  }, []);

  const loadFacts = useCallback(async () => {
    const generation = ++factsGenerationRef.current;
    setFactsState({ status: "loading" });
    try {
      const groups = await fetchFactsByEntity(bookId, {
        ...(currentChapter !== undefined ? { asOfChapter: currentChapter } : {}),
        entity,
      });
      const group = groups.find((item) => item.entity === entity);
      if (generation !== factsGenerationRef.current) return;
      setFactsState({ status: "ready", facts: group?.facts ?? [] });
    } catch (cause) {
      if (generation !== factsGenerationRef.current) return;
      setFactsState({ status: "error", message: cause instanceof Error ? cause.message : "加载叙事记忆失败" });
    }
  }, [bookId, entity, currentChapter]);

  const loadJingwei = useCallback(async () => {
    const generation = ++jingweiGenerationRef.current;
    setJingweiState({ status: "loading" });
    try {
      const { fetchJson } = await import("@/hooks/use-api");
      const payload = await fetchJson<{ results?: JingweiEntryHit[] }>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/search?q=${encodeURIComponent(entity)}`,
      );
      if (generation !== jingweiGenerationRef.current) return;
      setJingweiState({ status: "ready", entries: payload.results ?? [] });
    } catch (cause) {
      if (generation !== jingweiGenerationRef.current) return;
      setJingweiState({ status: "error", message: cause instanceof Error ? cause.message : "加载经纬设定失败" });
    }
  }, [bookId, entity]);

  useEffect(() => {
    void loadFacts();
    void loadJingwei();
  }, [loadFacts, loadJingwei]);

  const handleMutated = useCallback(async () => {
    await loadFacts();
  }, [loadFacts]);

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-[min(28rem,90vw)] gap-0 p-0 sm:max-w-none">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <UserRound className="size-4 text-primary" />
            {entity}
          </SheetTitle>
          <SheetDescription className="text-[11px]">
            经纬设定与叙事记忆现状；改设定去经纬编辑器，改现状在下方就地处理。
          </SheetDescription>
        </SheetHeader>

        <div className="h-full overflow-y-auto p-3" data-testid="entity-detail-drawer">
          <Tabs defaultValue="state" className="space-y-3">
            <TabsList className="w-full">
              <TabsTrigger value="state" className="flex-1">当前状态</TabsTrigger>
              <TabsTrigger value="lore" className="flex-1">设定</TabsTrigger>
              <TabsTrigger value="relations" className="flex-1">关系</TabsTrigger>
              <TabsTrigger value="history" className="flex-1">变迁史</TabsTrigger>
            </TabsList>

            <TabsContent value="state" className="space-y-2">
              <FactsTab
                bookId={bookId}
                entity={entity}
                state={factsState}
                onRetry={() => void loadFacts()}
                onMutated={() => void handleMutated()}
              />
            </TabsContent>

            <TabsContent value="lore" className="space-y-2">
              <JingweiTab
                state={jingweiState}
                onRetry={() => void loadJingwei()}
                onOpenJingweiEntry={onOpenJingweiEntry}
              />
            </TabsContent>

            <TabsContent value="relations" className="space-y-2">
              <RelationsTab state={factsState} />
            </TabsContent>

            <TabsContent value="history" className="space-y-2">
              <HistoryTab bookId={bookId} state={factsState} />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground" data-testid="entity-drawer-loading">
      <Loader2 className="size-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 space-y-2 text-destructive" data-testid="entity-drawer-error">
      <p className="text-[11px]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded border border-destructive/40 px-2 py-1 text-[10px] hover:bg-destructive/10"
      >
        重试
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 当前状态 tab：fact 列表 + 就地纠正 / 作废 / 新增                     */
/* ------------------------------------------------------------------ */

function FactsTab({
  bookId,
  entity,
  state,
  onRetry,
  onMutated,
}: {
  bookId: string;
  entity: string;
  state: LoadState;
  onRetry: () => void;
  onMutated: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (state.status === "loading") return <LoadingBlock label="正在读当前状态…" />;
  if (state.status === "error") return <ErrorBlock message={state.message} onRetry={onRetry} />;

  const facts = state.facts;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">{facts.length} 条当前状态</p>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] border border-border hover:bg-muted"
        >
          <Plus className="size-3" />
          新增状态
        </button>
      </div>

      {adding && (
        <FactForm
          bookId={bookId}
          initial={{ subject: entity, predicate: "", object: "", category: "" }}
          submitLabel="写入状态"
          onSubmit={async (input) => {
            await createFact(bookId, input);
            toast("已写入这条状态", "success");
            setAdding(false);
            onMutated();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {facts.length === 0 && !adding ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-[11px] text-muted-foreground">
          这个实体还没有记忆状态。写章结算后会自动出现，也可以点「新增状态」手工补一条。
        </div>
      ) : (
        facts.map((fact) => (
          <FactRow
            key={fact.id}
            bookId={bookId}
            fact={fact}
            editing={editingId === fact.id}
            onEdit={() => setEditingId(fact.id)}
            onCancelEdit={() => setEditingId(null)}
            onMutated={() => {
              setEditingId(null);
              onMutated();
            }}
          />
        ))
      )}
    </div>
  );
}

function FactRow({
  bookId,
  fact,
  editing,
  onEdit,
  onCancelEdit,
  onMutated,
}: {
  bookId: string;
  fact: EntityFact;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onMutated: () => void;
}) {
  if (editing) {
    return (
      <FactForm
        bookId={bookId}
        factId={fact.id}
        initial={{ subject: fact.subject, predicate: fact.predicate, object: fact.object, category: fact.category, confidence: fact.confidence }}
        submitLabel="保存纠正"
        onSubmit={async (input) => {
          await correctFact(bookId, fact.id, {
            subject: input.subject,
            object: input.object,
            predicate: input.predicate,
            category: input.category,
            confidence: input.confidence,
            reason: "实体抽屉手工纠正",
          });
          toast("已纠正", "success");
          onMutated();
        }}
        onCancel={onCancelEdit}
      />
    );
  }

  return (
    <article className="rounded border border-border/60 p-2.5 space-y-1.5" data-testid="entity-fact-row">
      <div className="text-[11px] leading-relaxed">
        <span className="font-medium">{fact.subject}</span>
        <span className="mx-1 text-muted-foreground">—{fact.predicate}—</span>
        <span className="font-medium">{fact.object}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <Badge variant="secondary" className="text-[9px]">{fact.category}</Badge>
        {fact.sourceType && <span>来源 {fact.sourceType}</span>}
        {fact.confidence !== undefined && <span>置信 {Math.round(fact.confidence * 100)}%</span>}
        {fact.validFromChapter !== undefined && <span>第 {fact.validFromChapter} 章起</span>}
      </div>
      <div className="flex justify-end gap-1.5">
        <ActionButton onClick={onEdit}>纠正</ActionButton>
        <ActionButton
          onClick={async () => {
            try {
              await retireFact(bookId, fact.id, { reason: "实体抽屉手工作废" });
              toast("已作废这条状态", "success");
              onMutated();
            } catch (cause) {
              toast(cause instanceof Error ? cause.message : "作废失败", "error");
            }
          }}
        >
          <Trash2 className="size-3" />
          作废
        </ActionButton>
      </div>
    </article>
  );
}

function FactForm({
  bookId,
  factId,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  bookId: string;
  factId?: string;
  initial: { subject: string; predicate: string; object: string; category: string; confidence?: number };
  submitLabel: string;
  onSubmit: (input: { subject: string; predicate: string; object: string; category: string; confidence?: number }) => Promise<void>;
  onCancel: () => void;
}) {
  const [subject, setSubject] = useState(initial.subject);
  const [predicate, setPredicate] = useState(initial.predicate);
  const [object, setObject] = useState(initial.object);
  const [category, setCategory] = useState(initial.category);
  const [busy, setBusy] = useState(false);

  const disabled = !subject.trim() || !predicate.trim() || !object.trim() || !category.trim() || busy;

  return (
    <div className="rounded border border-border/60 bg-card p-2.5 space-y-2" data-testid="entity-fact-form">
      {factId && <p className="text-[10px] text-muted-foreground">纠正会关闭旧值并写入一条 manual 新值，历史保留。</p>}
      <Field label="主体" value={subject} onChange={setSubject} placeholder="角色 / 地点 / 物品" />
      <Field label="谓词" value={predicate} onChange={setPredicate} placeholder="如：境界 / 结盟 / 属于" />
      <Field label="宾语" value={object} onChange={setObject} placeholder="如：元婴期 / 李四 / 青云宗" />
      <Field label="类别" value={category} onChange={setCategory} placeholder="如：state / relationship" />
      <div className="flex justify-end gap-1.5">
        <ActionButton onClick={onCancel} disabled={busy}>取消</ActionButton>
        <ActionButton
          primary
          disabled={disabled}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit({ subject, predicate, object, category, confidence: initial.confidence });
            } catch (cause) {
              toast(cause instanceof Error ? cause.message : "保存失败", "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "保存中…" : submitLabel}
        </ActionButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 设定 tab：经纬条目只读展示 + 跳转                                     */
/* ------------------------------------------------------------------ */

function JingweiTab({
  state,
  onRetry,
  onOpenJingweiEntry,
}: {
  state: JingweiState;
  onRetry: () => void;
  onOpenJingweiEntry?: (entryId: string) => boolean;
}) {
  const [entryError, setEntryError] = useState<string | null>(null);

  if (state.status === "loading") return <LoadingBlock label="正在查经纬设定…" />;
  if (state.status === "error") return <ErrorBlock message={state.message} onRetry={onRetry} />;

  const entries = state.entries;
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-8 text-center text-[11px] text-muted-foreground">
        经纬里没有以这个名字登记的条目。要在经纬编辑器里新建设定。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entryError && <p className="text-[10px] text-destructive">{entryError}</p>}
      {entries.map((entry) => (
        <article key={entry.id} className="rounded border border-border/60 p-2.5 space-y-1.5" data-testid="jingwei-entry-hit">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[11px] font-medium">{entry.title ?? entry.id}</span>
            {entry.layer && <Badge variant="secondary" className="text-[9px]">{entry.layer}</Badge>}
          </div>
          {(entry.category || entry.status) && (
            <p className="text-[10px] text-muted-foreground">
              {[entry.category, entry.status].filter(Boolean).join(" · ")}
            </p>
          )}
          {(entry.summary || entry.preview) && <p className="text-[10px] leading-relaxed text-muted-foreground">{entry.summary ?? entry.preview}</p>}
          <div className="flex justify-end">
            {onOpenJingweiEntry && (
              <ActionButton
                onClick={() => {
                  setEntryError(null);
                  if (!onOpenJingweiEntry(entry.id)) {
                    setEntryError(`经纬条目不存在或尚未载入：${entry.title ?? entry.id}`);
                  }
                }}
              >
                <BookOpen className="size-3" />
                打开编辑
              </ActionButton>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 关系 tab：显式实体关系（谓词分组列表，数据源 = 当前实体 fact）          */
/* ------------------------------------------------------------------ */

function RelationsTab({ state }: { state: LoadState }) {
  if (state.status === "loading") return <LoadingBlock label="正在整理关系…" />;
  if (state.status === "error") return <p className="text-[11px] text-muted-foreground">关系随当前状态一起加载失败。</p>;

  const facts = state.facts;
  // 关系图只消费显式 relationship fact；状态类的 object 不能被误画成实体边。
  const grouped = useMemo(() => {
    const map = new Map<string, { predicate: string; pairs: [string, string][] }>();
    for (const fact of facts) {
      if (fact.category !== "relationship" || !fact.subject || !fact.object) continue;
      const key = fact.predicate || "（未命名关系）";
      const existing = map.get(key) ?? { predicate: key, pairs: [] };
      existing.pairs.push([fact.subject, fact.object]);
      map.set(key, existing);
    }
    return [...map.values()];
  }, [facts]);

  if (grouped.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-8 text-center text-[11px] text-muted-foreground">
        还没有关系。写章结算后，结盟 / 敌对 / 师徒这类关系会出现在这里。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {grouped.map((group) => (
        <section key={group.predicate} className="rounded border border-border/60 p-2.5 space-y-1">
          <h4 className="text-[11px] font-semibold text-muted-foreground">{group.predicate}</h4>
          {group.pairs.map(([subject, object], index) => (
            <p key={`${subject}-${object}-${index}`} className="text-[11px]">
              <span className="font-medium">{subject}</span>
              <span className="mx-1 text-muted-foreground">→</span>
              <span className="font-medium">{object}</span>
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 变迁史 tab：单条 fact 的演变轨迹（按需加载）                           */
/* ------------------------------------------------------------------ */

function HistoryTab({ bookId, state }: { bookId: string; state: LoadState }) {
  if (state.status === "loading") return <LoadingBlock label="正在读状态…" />;
  if (state.status === "error") return <p className="text-[11px] text-muted-foreground">历史随当前状态一起加载失败。</p>;

  const facts = state.facts;
  if (facts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-8 text-center text-[11px] text-muted-foreground">
        没有可追溯的状态。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">选择一条状态查看它的演变轨迹。</p>
      {facts.map((fact) => (
        <FactHistoryRow key={fact.id} bookId={bookId} fact={fact} />
      ))}
    </div>
  );
}

function FactHistoryRow({ bookId, fact }: { bookId: string; fact: EntityFact }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<readonly EntityFact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fetchJson } = await import("@/hooks/use-api");
      const payload = await fetchJson<{ items?: EntityFact[] }>(
        `/api/books/${encodeURIComponent(bookId)}/narrative-memory/facts/${encodeURIComponent(fact.id)}/history`,
      );
      setHistory(payload.items ?? []);
      setOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载历史失败");
    } finally {
      setLoading(false);
    }
  }, [bookId, fact.id]);

  return (
    <div className="rounded border border-border/60 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px]">
          <span className="font-medium">{fact.subject}</span>
          <span className="mx-1 text-muted-foreground">—{fact.predicate}—</span>
          <span className="font-medium">{fact.object}</span>
        </span>
        <ActionButton onClick={() => (open ? setOpen(false) : void loadHistory())}>
          {loading ? <Loader2 className="size-3 animate-spin" /> : open ? "收起" : "历史"}
        </ActionButton>
      </div>
      {error && <p className="text-[10px] text-destructive">{error}</p>}
      {open && history && (
        <ol className="space-y-1 border-l border-border pl-3">
          {history.map((item, index) => (
            <li key={item.id ?? index} className="text-[10px] text-muted-foreground">
              <span className="text-foreground">{item.subject} —{item.predicate}— {item.object}</span>
              {item.sourceChapter !== undefined && <span> · 第 {item.sourceChapter} 章</span>}
              {item.sourceType && <span> · {item.sourceType}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-primary"
      />
    </label>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  primary,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] transition-colors disabled:opacity-50 ${
        primary
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "border border-border hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
