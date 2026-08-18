/**
 * 实体详情抽屉 —— 酒馆式（SillyTavern 风格）一体化角色与实体总卡。
 *
 * 打通经纬（静态设定）与叙事记忆（动态时态）的孤岛：
 * 点任意实体名，右侧滑出多维卡片：
 * 1. 【Hero Banner】头像/立绘占位、实体姓名、别名徽章、当前状态标签；
 * 2. 【当前时态】当前所在章节/地点、身体状况、掌握秘密，支持就地纠正/作废/新增；
 * 3. 【出场档案 (Lore)】性格底色、行为禁忌、语言口癖，支持一键跳转经纬编辑；
 * 4. 【人物羁绊 (Relations)】与全书其它实体的实时双向/有向关系网络；
 * 5. 【变迁历史 (History)】按章节推进的时间线与心境转折轨迹。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  Calendar,
  ChevronRight,
  Clock,
  ExternalLink,
  GitBranch,
  HeartHandshake,
  History,
  Info,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Swords,
  Trash2,
  UserCheck,
  UserRound,
  Users,
  Wand2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  readonly aliases?: readonly string[];
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

  const matchedJingwei = useMemo(() => {
    if (jingweiState.status !== "ready") return null;
    return jingweiState.entries.find((entry) => entry.title === entity) ?? jingweiState.entries[0] ?? null;
  }, [jingweiState, entity]);

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-[min(32rem,95vw)] gap-0 p-0 sm:max-w-none flex flex-col h-full bg-card">
        {/* 酒馆式 Hero Banner */}
        <div className="relative border-b border-border bg-muted/20 px-5 py-4 shrink-0">
          <div className="flex items-start gap-3">
            {/* 头像占位 */}
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary shadow-sm">
              <UserRound className="size-6" />
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight text-foreground truncate">{entity}</h2>
                {matchedJingwei?.category ? (
                  <Badge variant="secondary" className="text-[10px] px-1.5 h-4">
                    {matchedJingwei.category}
                  </Badge>
                ) : null}
                {matchedJingwei?.layer ? (
                  <Badge variant="outline" className="text-[9px] px-1.5 h-4 text-muted-foreground">
                    {matchedJingwei.layer}
                  </Badge>
                ) : null}
              </div>

              <p className="text-[11px] text-muted-foreground line-clamp-1">
                {matchedJingwei?.summary || "经纬设定与叙事记忆现状合一视图"}
              </p>

              {matchedJingwei?.aliases && matchedJingwei.aliases.length > 0 ? (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {matchedJingwei.aliases.map((alias) => (
                    <span key={alias} className="text-[9px] rounded bg-muted px-1.5 py-0.2 text-muted-foreground">
                      别名: {alias}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* 导航 Tabs */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4" data-testid="entity-detail-drawer">
          <Tabs defaultValue="state" className="space-y-3">
            <TabsList className="w-full grid grid-cols-4 h-8 p-0.5 bg-muted/50">
              <TabsTrigger value="state" className="text-xs">当前状态</TabsTrigger>
              <TabsTrigger value="lore" className="text-xs">设定</TabsTrigger>
              <TabsTrigger value="relations" className="text-xs">关系</TabsTrigger>
              <TabsTrigger value="history" className="text-xs">变迁史</TabsTrigger>
            </TabsList>

            <TabsContent value="state" className="space-y-2.5 pt-1">
              <FactsTab
                bookId={bookId}
                entity={entity}
                state={factsState}
                onRetry={() => void loadFacts()}
                onMutated={() => void handleMutated()}
              />
            </TabsContent>

            <TabsContent value="lore" className="space-y-2.5 pt-1">
              <JingweiTab
                state={jingweiState}
                onRetry={() => void loadJingwei()}
                onOpenJingweiEntry={onOpenJingweiEntry}
              />
            </TabsContent>

            <TabsContent value="relations" className="space-y-2.5 pt-1">
              <RelationsTab state={factsState} />
            </TabsContent>

            <TabsContent value="history" className="space-y-2.5 pt-1">
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
      <span className="text-xs">{label}</span>
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
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-3 text-primary" />
          <span className="text-xs font-semibold">当前动态时态</span>
          <span className="text-[10px] text-muted-foreground">({facts.length} 条)</span>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm transition-colors"
        >
          <Plus className="size-3" />
          新增状态
        </button>
      </div>

      {adding && (
        <FactForm
          bookId={bookId}
          initial={{ subject: entity, predicate: "", object: "", category: "state" }}
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
        <div className="rounded-lg border border-dashed border-border/80 p-6 text-center text-xs text-muted-foreground bg-muted/10 space-y-1">
          <p className="font-medium">这个实体还没有记忆状态</p>
          <p className="text-[10px] text-muted-foreground/80">写章结算后会自动沉淀，也可以点「新增状态」手工补一条。</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {facts.map((fact) => (
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
          ))}
        </div>
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
    <article className="rounded-lg border border-border/70 bg-card p-2.5 space-y-1.5 hover:border-border transition-colors shadow-xs" data-testid="entity-fact-row">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs leading-relaxed font-medium">
          <span className="text-foreground">{fact.subject}</span>
          <span className="mx-1.5 text-primary/80 font-normal">[{fact.predicate}]</span>
          <span className="text-foreground font-semibold">{fact.object}</span>
        </div>
        <div className="flex items-center gap-1">
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
            <Trash2 className="size-2.5" />
            作废
          </ActionButton>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <Badge variant="secondary" className="text-[9px] px-1 h-3.5">{fact.category}</Badge>
        {fact.sourceType && <span>来源 {fact.sourceType}</span>}
        {fact.confidence !== undefined && <span>置信 {Math.round(fact.confidence * 100)}%</span>}
        {fact.validFromChapter !== undefined && <span>第 {fact.validFromChapter} 章起</span>}
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
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2 shadow-xs" data-testid="entity-fact-form">
      {factId && <p className="text-[10px] text-muted-foreground">纠正会关闭旧值并写入一条 manual 新值，历史保留。</p>}
      <Field label="主体" value={subject} onChange={setSubject} placeholder="角色 / 实体" />
      <Field label="谓词" value={predicate} onChange={setPredicate} placeholder="如：境界 / 位置 / 伤势 / 关系" />
      <Field label="宾语" value={object} onChange={setObject} placeholder="如：元婴期 / 乱星海 / 中毒 / 结盟" />
      <Field label="类别" value={category} onChange={setCategory} placeholder="如：state / relationship" />
      <div className="flex justify-end gap-1.5 pt-1">
        <ActionButton onClick={onCancel} disabled={busy}>取消</ActionButton>
        <ActionButton
          primary
          disabled={disabled}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit({ subject, predicate, object, category, confidence: initial.confidence });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="size-3 animate-spin mr-1 inline" /> : null}
          {submitLabel}
        </ActionButton>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-10 shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-6 flex-1 min-w-0 rounded border border-border bg-background px-2 text-xs outline-none focus:border-primary"
      />
    </label>
  );
}

function ActionButton({ children, onClick, disabled, primary }: { children: ReactNode; onClick: () => void | Promise<void>; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void onClick()}
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50 ${
        primary
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "border border-border/80 bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* 出场设定 tab：经纬设定条目展示 + 打开编辑                             */
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
  const [openError, setOpenError] = useState<string | null>(null);

  if (state.status === "loading") return <LoadingBlock label="正在读经纬设定…" />;
  if (state.status === "error") return <ErrorBlock message={state.message} onRetry={onRetry} />;

  const entries = state.entries;
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/80 p-6 text-center text-xs text-muted-foreground bg-muted/10">
        经纬中尚未建立该实体的设定档案。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {openError && (
        <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-2 text-[11px] text-destructive">
          {openError}
        </p>
      )}
      {entries.map((entry) => (
        <article
          key={entry.id}
          className="rounded-lg border border-border/70 bg-card p-3 space-y-2 hover:border-border transition-colors shadow-xs"
          data-testid="jingwei-entry-hit"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-xs text-foreground">{entry.title}</span>
              {entry.category ? <Badge variant="secondary" className="text-[9px] px-1 h-3.5">{entry.category}</Badge> : null}
              {entry.layer ? <Badge variant="outline" className="text-[9px] px-1 h-3.5">{entry.layer}</Badge> : null}
            </div>
            {onOpenJingweiEntry ? (
              <button
                type="button"
                onClick={() => {
                  setOpenError(null);
                  const ok = onOpenJingweiEntry(entry.id);
                  if (!ok) {
                    setOpenError("经纬条目不存在或尚未载入");
                    toast("经纬条目不存在或尚未载入", "error");
                  }
                }}
                className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline font-medium"
              >
                <ExternalLink className="size-2.5" />
                打开编辑
              </button>
            ) : null}
          </div>

          {entry.summary ? (
            <p className="text-[11px] text-muted-foreground leading-relaxed">{entry.summary}</p>
          ) : entry.contentMd ? (
            <div className="max-h-36 overflow-y-auto rounded bg-muted/30 p-2 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {entry.contentMd.slice(0, 500)}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 人物羁绊 tab：关系列表                                              */
/* ------------------------------------------------------------------ */

function RelationsTab({ state }: { state: LoadState }) {
  if (state.status === "loading") return <LoadingBlock label="正在读关系网络…" />;
  if (state.status === "error") return <p className="text-xs text-destructive">{state.message}</p>;

  const relFacts = state.facts.filter((fact) => fact.category === "relationship" || fact.category === "relations");
  if (relFacts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/80 p-6 text-center text-xs text-muted-foreground bg-muted/10">
        暂无显式人物羁绊记录。
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {relFacts.map((fact) => (
        <div key={fact.id} className="rounded-lg border border-border/70 bg-card p-2.5 flex items-center justify-between text-xs shadow-xs">
          <div className="flex items-center gap-2">
            <HeartHandshake className="size-3.5 text-primary/80" />
            <span>与 <strong className="font-semibold text-foreground">{fact.object}</strong></span>
          </div>
          <Badge variant="secondary" className="text-[10px]">{fact.predicate}</Badge>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 变迁轨迹 tab：fact 历史                                             */
/* ------------------------------------------------------------------ */

function HistoryTab({ bookId, state }: { bookId: string; state: LoadState }) {
  if (state.status === "loading") return <LoadingBlock label="正在读变迁轨迹…" />;
  if (state.status === "error") return <p className="text-xs text-destructive">{state.message}</p>;

  const facts = state.facts;
  if (facts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/80 p-6 text-center text-xs text-muted-foreground bg-muted/10">
        暂无变迁历史。
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {facts.map((fact) => (
        <div key={fact.id} className="rounded-lg border border-border/70 bg-card p-2.5 text-xs space-y-1 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground text-[10px]">
            <span>第 {fact.validFromChapter ?? "—"} 章 起</span>
            <Badge variant="outline" className="text-[9px]">{fact.category}</Badge>
          </div>
          <div className="font-medium text-foreground">
            {fact.subject} · {fact.predicate} → <span className="text-primary font-semibold">{fact.object}</span>
          </div>
          {fact.evidenceText ? (
            <p className="text-[10px] text-muted-foreground line-clamp-2 bg-muted/30 p-1.5 rounded">
              依据：{fact.evidenceText}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
