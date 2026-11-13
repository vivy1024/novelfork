import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookMarked,
  Check,
  ChevronDown,
  ChevronRight,
  Filter,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type MechanismFetchJson = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface MechanismAbstractSlot {
  readonly slot: string;
  readonly roleDescription: string;
}

export interface MechanismCard {
  readonly id: string;
  readonly name: string;
  readonly sourceTitle: string;
  readonly sourceChapterRange: string;
  readonly readerDesire: string;
  readonly emotionChain: string;
  readonly triggerAndPayoff: string;
  readonly abstractSlots: readonly MechanismAbstractSlot[];
  readonly forbiddenSourceTerms: readonly string[];
  readonly tags: readonly string[];
  readonly status: "needs-review" | "confirmed";
}

function isNotFoundError(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const record = cause as Record<string, unknown>;
  return record.status === 404 || record.statusCode === 404;
}

export function normaliseMechanismCard(value: unknown, index = 0): MechanismCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : null;
  if (!name) return null;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `mech-${index + 1}`;
  const abstractSlots: MechanismAbstractSlot[] = Array.isArray(record.abstractSlots)
    ? record.abstractSlots.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const obj = item as Record<string, unknown>;
        const slot = typeof obj.slot === "string" ? obj.slot.trim() : "";
        const roleDescription = typeof obj.roleDescription === "string" ? obj.roleDescription.trim() : "";
        return slot ? [{ slot, roleDescription }] : [];
      })
    : [];
  const forbiddenSourceTerms = Array.isArray(record.forbiddenSourceTerms)
    ? record.forbiddenSourceTerms.filter((t): t is string => typeof t === "string" && Boolean(t.trim())).map((t) => t.trim())
    : [];
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((t): t is string => typeof t === "string" && Boolean(t.trim())).map((t) => t.trim())
    : [];
  return {
    id,
    name,
    sourceTitle: typeof record.sourceTitle === "string" && record.sourceTitle.trim() ? record.sourceTitle.trim() : "未命名参考书",
    sourceChapterRange: typeof record.sourceChapterRange === "string" && record.sourceChapterRange.trim() ? record.sourceChapterRange.trim() : "未标明章区间",
    readerDesire: typeof record.readerDesire === "string" ? record.readerDesire.trim() : "",
    emotionChain: typeof record.emotionChain === "string" ? record.emotionChain.trim() : "",
    triggerAndPayoff: typeof record.triggerAndPayoff === "string" ? record.triggerAndPayoff.trim() : "",
    abstractSlots,
    forbiddenSourceTerms,
    tags,
    status: record.status === "confirmed" ? "confirmed" : "needs-review",
  };
}

export function normaliseMechanismCardList(value: unknown): MechanismCard[] {
  if (Array.isArray(value)) {
    return value.map((item, idx) => normaliseMechanismCard(item, idx)).filter((c): c is MechanismCard => c !== null);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.cards)) {
      return record.cards.map((item, idx) => normaliseMechanismCard(item, idx)).filter((c): c is MechanismCard => c !== null);
    }
  }
  return [];
}

export interface MechanismDistillPanelProps {
  bookId: string;
  fetchJson: MechanismFetchJson;
  refreshKey?: number;
  initialCards?: readonly MechanismCard[];
  onSwitchToSampling?: () => void;
  onCardsCountChange?: (count: number) => void;
}

export function MechanismDistillPanel({
  bookId,
  fetchJson,
  refreshKey = 0,
  initialCards,
  onSwitchToSampling,
  onCardsCountChange,
}: MechanismDistillPanelProps) {
  const [cards, setCards] = useState<MechanismCard[]>(() => (initialCards ? [...initialCards] : []));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "needs-review" | "confirmed">("all");
  const [expandedCardIds, setExpandedCardIds] = useState<Record<string, boolean>>({});
  const [busyCardId, setBusyCardId] = useState<string | null>(null);
  const [showQuickExtract, setShowQuickExtract] = useState(false);
  const [quickSourceName, setQuickSourceName] = useState("");
  const [quickText, setQuickText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [termInputs, setTermInputs] = useState<Record<string, string>>({});
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const encodedBookId = encodeURIComponent(bookId);
  const basePrimary = `/api/books/${encodedBookId}/mechanism-cards`;
  const baseFallback = `/api/books/${encodedBookId}/style/mechanism-cards`;

  const requestWithFallback = useCallback(
    async <T,>(suffix: string, init?: RequestInit): Promise<T> => {
      try {
        return await fetchJson<T>(`${basePrimary}${suffix}`, init);
      } catch (cause) {
        if (isNotFoundError(cause)) {
          return await fetchJson<T>(`${baseFallback}${suffix}`, init);
        }
        throw cause;
      }
    },
    [baseFallback, basePrimary, fetchJson],
  );

  const loadCards = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await requestWithFallback<unknown>("");
      if (!mounted.current) return;
      const list = normaliseMechanismCardList(response);
      setCards(list);
      onCardsCountChange?.(list.length);
    } catch (cause) {
      if (!mounted.current) return;
      if (isNotFoundError(cause)) {
        // 后端尚未暴露机制卡路由时平滑展示空态，不报错阻断界面
        setCards((prev) => prev);
      } else {
        setError(cause instanceof Error ? cause.message : "读取机制卡库失败，请稍后重试。");
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [onCardsCountChange, requestWithFallback]);

  useEffect(() => {
    void loadCards();
  }, [loadCards, refreshKey]);

  useEffect(() => {
    if (initialCards && initialCards.length > 0) {
      setCards((current) => {
        const byId = new Map(current.map((c) => [c.id, c]));
        for (const incoming of initialCards) {
          byId.set(incoming.id, incoming);
        }
        const merged = [...byId.values()];
        onCardsCountChange?.(merged.length);
        return merged;
      });
    }
  }, [initialCards, onCardsCountChange]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of cards) {
      for (const tag of card.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [cards]);

  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
      if (statusFilter !== "all" && card.status !== statusFilter) return false;
      if (selectedTag !== "all" && !card.tags.includes(selectedTag)) return false;
      return true;
    });
  }, [cards, selectedTag, statusFilter]);

  const confirmedCount = useMemo(() => cards.filter((c) => c.status === "confirmed").length, [cards]);
  const pendingCount = cards.length - confirmedCount;

  async function patchCard(
    card: MechanismCard,
    patch: Partial<Pick<MechanismCard, "status" | "tags" | "forbiddenSourceTerms">>,
    successMessage?: string,
  ) {
    if (busyCardId) return;
    setBusyCardId(card.id);
    setError(null);
    setNotice(null);
    try {
      const response = await requestWithFallback<unknown>(`/${encodeURIComponent(card.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!mounted.current) return;
      const updatedFromServer =
        response && typeof response === "object" && "card" in (response as Record<string, unknown>)
          ? normaliseMechanismCard((response as Record<string, unknown>).card)
          : normaliseMechanismCard(response);
      setCards((current) =>
        current.map((item) =>
          item.id === card.id
            ? updatedFromServer ?? {
                ...item,
                ...(patch.status ? { status: patch.status } : {}),
                ...(patch.tags ? { tags: patch.tags } : {}),
                ...(patch.forbiddenSourceTerms ? { forbiddenSourceTerms: patch.forbiddenSourceTerms } : {}),
              }
            : item,
        ),
      );
      if (successMessage) setNotice(successMessage);
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : "更新机制卡失败，请稍后重试。");
      }
    } finally {
      if (mounted.current) setBusyCardId(null);
    }
  }

  async function deleteCard(card: MechanismCard) {
    if (busyCardId) return;
    setBusyCardId(card.id);
    setError(null);
    setNotice(null);
    try {
      await requestWithFallback<unknown>(`/${encodeURIComponent(card.id)}`, {
        method: "DELETE",
      });
      if (!mounted.current) return;
      setCards((current) => {
        const next = current.filter((item) => item.id !== card.id);
        onCardsCountChange?.(next.length);
        return next;
      });
      setNotice(`已移除机制卡「${card.name}」。`);
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : "删除机制卡失败，请稍后重试。");
      }
    } finally {
      if (mounted.current) setBusyCardId(null);
    }
  }

  async function handleQuickExtract() {
    const sourceName = quickSourceName.trim();
    const text = quickText.trim();
    if (!sourceName || !text || extracting) {
      setError(!sourceName ? "请填写参考书名。" : "请粘贴需要提炼机制的剧情片段。");
      return;
    }
    setExtracting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await requestWithFallback<unknown>("/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceName, text }),
      });
      if (!mounted.current) return;
      const extracted = normaliseMechanismCardList(response);
      setCards((current) => {
        const byId = new Map(current.map((c) => [c.id, c]));
        for (const item of extracted) byId.set(item.id, item);
        const merged = [...byId.values()];
        onCardsCountChange?.(merged.length);
        return merged;
      });
      setQuickText("");
      setShowQuickExtract(false);
      setNotice(`已从「${sourceName}」提炼 ${extracted.length} 张可迁移机制卡，确认入库后即可在排细纲时按标签召回。`);
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : "抽取剧情机制卡失败，请稍后重试。");
      }
    } finally {
      if (mounted.current) setExtracting(false);
    }
  }

  function toggleExpand(cardId: string) {
    setExpandedCardIds((current) => ({ ...current, [cardId]: !current[cardId] }));
  }

  function addForbiddenTerm(card: MechanismCard) {
    const raw = (termInputs[card.id] ?? "").trim();
    if (!raw || card.forbiddenSourceTerms.includes(raw)) return;
    setTermInputs((prev) => ({ ...prev, [card.id]: "" }));
    void patchCard(card, { forbiddenSourceTerms: [...card.forbiddenSourceTerms, raw] });
  }

  function removeForbiddenTerm(card: MechanismCard, term: string) {
    void patchCard(card, {
      forbiddenSourceTerms: card.forbiddenSourceTerms.filter((t) => t !== term),
    });
  }

  function addCardTag(card: MechanismCard) {
    const raw = (tagInputs[card.id] ?? "").trim();
    if (!raw || card.tags.includes(raw)) return;
    setTagInputs((prev) => ({ ...prev, [card.id]: "" }));
    void patchCard(card, { tags: [...card.tags, raw] });
  }

  function removeCardTag(card: MechanismCard, tag: string) {
    void patchCard(card, {
      tags: card.tags.filter((t) => t !== tag),
    });
  }

  return (
    <section aria-label="可迁移机制卡库" className="space-y-4">
      {/* 顶部架构说明横幅 */}
      <Card className="border-border/80 bg-card/95">
        <CardHeader className="border-b border-border/60 pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Layers className="size-4 text-primary" />
                <CardTitle className="text-base" style={{ fontFamily: "var(--font-display)" }}>
                  可迁移机制卡库（细纲弹药库）
                </CardTitle>
                <Badge variant="secondary" className="tabular-nums">
                  已入库 {confirmedCount} / 共 {cards.length} 张
                </Badge>
                {pendingCount > 0 && (
                  <Badge variant="outline" className="border-warning/40 text-warning tabular-nums">
                    {pendingCount} 张待审阅
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs">
                剥离原著人名地名后的中观戏剧结构与制度博弈闭环。仅在排卷纲与细纲时按标签召回，不占正文写作预算。
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={loading}
                onClick={() => void loadCards()}
                aria-label="刷新机制卡库"
              >
                <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
                刷新
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setShowQuickExtract((v) => !v)}
              >
                <Plus className="size-3" />
                片段速抽机制卡
              </Button>
              {onSwitchToSampling && (
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  onClick={onSwitchToSampling}
                >
                  <BookMarked className="size-3 text-primary" />
                  从本地大文件选章抽取
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        {/* 快速片段抽取折叠区 */}
        {showQuickExtract && (
          <CardContent className="space-y-3 border-b border-border/60 bg-muted/15 pt-3 pb-4">
            <div className="grid gap-3 sm:grid-cols-[16rem_minmax(0,1fr)]">
              <label className="space-y-1">
                <span className="text-xs font-medium">参考书名</span>
                <Input
                  aria-label="机制抽取参考书名"
                  value={quickSourceName}
                  onChange={(event) => setQuickSourceName(event.target.value)}
                  placeholder="例如：没钱修什么仙"
                  disabled={extracting}
                  className="h-8 text-xs"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">剧情章节或片段</span>
                <Textarea
                  aria-label="机制抽取参考片段"
                  value={quickText}
                  onChange={(event) => setQuickText(event.target.value)}
                  placeholder="粘贴包含精彩博弈、制度套利或冲突反转的章节片段……"
                  disabled={extracting}
                  className="min-h-24 resize-y text-xs"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" size="xs" variant="ghost" onClick={() => setShowQuickExtract(false)} disabled={extracting}>
                收起
              </Button>
              <Button type="button" size="xs" onClick={() => void handleQuickExtract()} disabled={extracting}>
                {extracting && <Loader2 className="size-3 animate-spin" />}
                {extracting ? "提炼中…" : "开始提炼机制卡"}
              </Button>
            </div>
          </CardContent>
        )}

        {/* 状态与标签筛选栏 */}
        <CardContent className="flex flex-wrap items-center justify-between gap-2.5 pt-3">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="机制卡标签筛选">
            <Filter className="mr-0.5 size-3.5 text-muted-foreground" />
            <button
              type="button"
              onClick={() => setSelectedTag("all")}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                selectedTag === "all"
                  ? "border-primary/50 bg-primary text-primary-foreground font-medium"
                  : "border-border/70 bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              全部标签（{cards.length}）
            </button>
            {allTags.map(([tag, count]) => {
              const active = selectedTag === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedTag(tag)}
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    active
                      ? "border-primary/50 bg-primary text-primary-foreground font-medium"
                      : "border-border/70 bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  {tag}（{count}）
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-muted/20 p-0.5 text-xs">
            {([
              ["all", "全部"],
              ["needs-review", "待审阅"],
              ["confirmed", "已确认"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`rounded-md px-2 py-0.5 transition-colors ${
                  statusFilter === key
                    ? "bg-card text-foreground font-medium shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <p role="status" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-foreground">
          {notice}
        </p>
      )}

      {loading && cards.length === 0 ? (
        <div className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-border/60 bg-card p-6 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          正在读取可迁移机制卡库…
        </div>
      ) : filteredCards.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {filteredCards.map((card) => {
            const confirmed = card.status === "confirmed";
            const expanded = Boolean(expandedCardIds[card.id]);
            const cardBusy = busyCardId === card.id;
            return (
              <Card
                key={card.id}
                data-testid="mechanism-card"
                className={`border transition-colors ${
                  confirmed ? "border-primary/35 bg-card" : "border-border/80 bg-card/95"
                }`}
              >
                {/* 卡片顶部：机制名 + 来源书与章区间 + 状态徽标 + 适用标签 */}
                <CardHeader className="space-y-2 border-b border-border/60 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                          {card.name}
                        </h3>
                        <Badge variant="outline" className="text-2xs font-normal text-muted-foreground">
                          {card.sourceTitle} · {card.sourceChapterRange}
                        </Badge>
                      </div>
                    </div>
                    <Badge
                      variant={confirmed ? "default" : "outline"}
                      className={confirmed ? "" : "border-warning/40 text-warning"}
                    >
                      {confirmed ? "已确认入库" : "待审阅"}
                    </Badge>
                  </div>

                  {/* 适用场景标签胶囊 */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {card.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-2xs text-foreground"
                      >
                        {tag}
                        <button
                          type="button"
                          disabled={cardBusy}
                          aria-label={`移除标签 ${tag}`}
                          onClick={() => removeCardTag(card, tag)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="size-2.5" />
                        </button>
                      </span>
                    ))}
                    <div className="inline-flex items-center gap-1">
                      <input
                        aria-label={`为「${card.name}」新增标签`}
                        placeholder="+ 适用标签"
                        value={tagInputs[card.id] ?? ""}
                        disabled={cardBusy}
                        onChange={(e) => setTagInputs((prev) => ({ ...prev, [card.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addCardTag(card);
                          }
                        }}
                        className="h-5 w-20 rounded border border-dashed border-border px-1.5 text-2xs outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                </CardHeader>

                {/* 卡片中部：三行核心戏剧结构 */}
                <CardContent className="space-y-2.5 pt-3">
                  <div className="grid gap-2 text-xs">
                    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                      <span className="block text-2xs font-medium text-muted-foreground">读者期待</span>
                      <p className="mt-0.5 leading-relaxed text-foreground">{card.readerDesire || "未填写"}</p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                      <span className="block text-2xs font-medium text-muted-foreground">情绪链</span>
                      <p className="mt-0.5 leading-relaxed text-foreground">{card.emotionChain || "未填写"}</p>
                    </div>
                    <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
                      <span className="block text-2xs font-medium text-primary">触发 → 漏洞 → 兑现闭环</span>
                      <p className="mt-0.5 leading-relaxed text-foreground">{card.triggerAndPayoff || "未填写"}</p>
                    </div>
                  </div>

                  {/* 卡片底部：折叠展开 抽象替换槽位 + 禁抄原著专名 */}
                  <div className="rounded-lg border border-border/60 bg-background/60">
                    <button
                      type="button"
                      onClick={() => toggleExpand(card.id)}
                      aria-expanded={expanded}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <span>
                        抽象替换槽位（{card.abstractSlots.length}）与禁抄原著专名（{card.forbiddenSourceTerms.length}）
                      </span>
                      {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </button>

                    {expanded && (
                      <div className="space-y-3 border-t border-border/60 px-3 py-2.5 text-xs">
                        <div className="space-y-1.5">
                          <span className="block text-2xs font-medium text-muted-foreground">抽象替换槽位（迁移到本书时填入对应设定）</span>
                          {card.abstractSlots.length > 0 ? (
                            <div className="divide-y divide-border/50 rounded-md border border-border/60 bg-card">
                              {card.abstractSlots.map((slotItem, idx) => (
                                <div key={`${slotItem.slot}-${idx}`} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2 px-2.5 py-1.5">
                                  <span className="font-mono text-2xs font-medium text-primary">{slotItem.slot}</span>
                                  <span className="text-2xs text-foreground">{slotItem.roleDescription}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-2xs text-muted-foreground">暂无槽位说明。</p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <span className="flex items-center gap-1 text-2xs font-medium text-muted-foreground">
                            <ShieldAlert className="size-3 text-warning" />
                            禁抄原著专名（防止把参考书设定词带进细纲）
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {card.forbiddenSourceTerms.map((term) => (
                              <span
                                key={term}
                                className="inline-flex items-center gap-1 rounded-md border border-warning/35 bg-warning/8 px-2 py-0.5 text-2xs text-foreground"
                              >
                                {term}
                                <button
                                  type="button"
                                  disabled={cardBusy}
                                  aria-label={`移除禁抄词 ${term}`}
                                  onClick={() => removeForbiddenTerm(card, term)}
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <X className="size-2.5" />
                                </button>
                              </span>
                            ))}
                            <input
                              aria-label={`为「${card.name}」新增禁抄原著专名`}
                              placeholder="+ 原著专名"
                              value={termInputs[card.id] ?? ""}
                              disabled={cardBusy}
                              onChange={(e) => setTermInputs((prev) => ({ ...prev, [card.id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addForbiddenTerm(card);
                                }
                              }}
                              className="h-5 w-24 rounded border border-dashed border-border px-1.5 text-2xs outline-none focus:border-warning"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 操作按钮栏 */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-2xs text-muted-foreground">
                      仅在排卷纲与细纲时召回，不占正文预算
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        disabled={cardBusy}
                        aria-label={`删除机制卡：${card.name}`}
                        onClick={() => void deleteCard(card)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3" />
                        删除
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant={confirmed ? "outline" : "default"}
                        disabled={cardBusy}
                        aria-label={`${confirmed ? "退回待审" : "确认入库"}：${card.name}`}
                        onClick={() =>
                          void patchCard(
                            card,
                            { status: confirmed ? "needs-review" : "confirmed" },
                            confirmed ? `已将「${card.name}」退回待审。` : `已确认「${card.name}」入库，排卷纲与细纲时将按标签召回。`,
                          )
                        }
                      >
                        {cardBusy ? <Loader2 className="size-3 animate-spin" /> : confirmed ? <Check className="size-3" /> : null}
                        {confirmed ? "已确认 · 退回待审" : "确认入库"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="border-dashed border-border/80 bg-card/60">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Layers className="size-6 text-muted-foreground/70" />
            <p className="text-sm font-medium text-foreground">
              {cards.length === 0 ? "尚未收录可迁移机制卡" : "当前筛选条件下没有匹配的机制卡"}
            </p>
            <p className="max-w-md text-xs text-muted-foreground">
              {cards.length === 0
                ? "在「拆书与蒸馏采样」中勾选高能代表章点击「抽剧情机制卡」，即可提炼去专名化的中观戏剧机制，作为排卷纲与细纲的弹药库。"
                : "可以切换上方标签或状态筛选查看其余机制卡。"}
            </p>
            {cards.length === 0 && onSwitchToSampling && (
              <Button type="button" size="sm" variant="outline" onClick={onSwitchToSampling} className="mt-1">
                前往拆书采样抽取机制卡
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
