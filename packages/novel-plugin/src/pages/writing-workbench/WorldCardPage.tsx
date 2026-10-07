/**
 * 世界卡 — WorldCardPage
 *
 * 地点 / 势力 / 道具 / 世界模型 / 能力体系这些"世界侧"经纬条目，过去只有通用表单，
 * 看不到它们在正文里的动态轨迹。这张卡沿用角色卡的两段结构：
 *  - 上半：静态设定（标题 + 正文，作者说什么就是什么）
 *  - 下半：实体动态区（叙事记忆只读召回，按分类抽取"当前状态"、发展历程、关联角色）
 *
 * 复用既有导出，不复制第二套取数逻辑：
 *  - 发展历程 → CharacterCardPage 的 loadEvolution（graph view=event_chain，按经纬条目 id）
 *  - 当前状态 → narrative-fact-edits 的 fetchFactsByEntity（facts/by-entity?entryId=）
 *  - 关联角色 → graph view=relationship 的对端实体（focusEntryId）
 *
 * 三路请求各自容错：任一路失败只让该子区显示不可用，静态编辑区永远可用。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { fetchJson } from "@/hooks/use-api";
import {
  Activity,
  Clock3,
  GitBranch,
  Globe2,
  Loader2,
  MapPin,
  Package,
  Pencil,
  RefreshCw,
  Save,
  ScrollText,
  Shield,
  Users,
  Zap,
} from "lucide-react";

import { opensInEditMode, type JingweiEntryData, type JingweiEntrySavePayload, type RelatedEntryItem } from "./JingweiEntryEditor";
import {
  JingweiCanonPanel,
  canonValuesFromEntry,
  toCanonSaveSlice,
  type JingweiCanonValues,
} from "./JingweiCanonPanel";
import { loadEvolution, type EvolutionStep } from "./CharacterCardPage";
import { fetchFactsByEntity, type EntityFact } from "./narrative-fact-edits";
// ─── 分类语义（世界卡覆盖的 5 个分类） ──────────────────────────────

/** 走世界卡的经纬分类。characters 有独立角色卡，不在此列。 */
export const WORLD_CARD_CATEGORIES = ["world-model", "locations", "factions", "power-system", "props"] as const;

export type WorldCardCategory = (typeof WORLD_CARD_CATEGORIES)[number];

export function isWorldCardCategory(category: string | undefined): boolean {
  return (WORLD_CARD_CATEGORIES as readonly string[]).includes(category ?? "");
}

interface CategoryPresentation {
  readonly label: string;
  readonly icon: typeof MapPin;
  /** 「当前状态」从 fact 里抽取时用的关键词。 */
  readonly stateKeywords: readonly string[];
  readonly stateLabel: string;
  readonly placeholder: string;
}

const CATEGORY_PRESENTATION: Record<string, CategoryPresentation> = {
  locations: {
    label: "地点",
    icon: MapPin,
    stateKeywords: ["位置", "所在", "地点", "驻地", "坐标", "location"],
    stateLabel: "当前位置状态",
    placeholder: "写这个地点的地理、格局、氛围、归属……",
  },
  factions: {
    label: "势力",
    icon: Shield,
    stateKeywords: ["势力", "阵营", "归属", "统属", "faction", "阵线"],
    stateLabel: "当前势力态势",
    placeholder: "写这个势力的构成、诉求、势力范围、行事风格……",
  },
  props: {
    label: "道具资源",
    icon: Package,
    stateKeywords: ["持有", "装备", "携带", "归属", "item", "resource", "法宝"],
    stateLabel: "当前持有 / 流转",
    placeholder: "写这件道具的来历、效果、代价、限制……",
  },
  "world-model": {
    label: "世界模型",
    icon: Globe2,
    stateKeywords: ["规则", "设定", "世界", "law", "rule"],
    stateLabel: "已被正文确立的规则",
    placeholder: "写这条世界规则的运行逻辑、边界与例外……",
  },
  "power-system": {
    label: "能力体系",
    icon: Zap,
    stateKeywords: ["境界", "等级", "修为", "能力", "rank", "level"],
    stateLabel: "已被正文确立的等级事实",
    placeholder: "写这套体系的等级、进阶条件、数值约束……",
  },
};

function presentationFor(category: string | undefined): CategoryPresentation {
  return CATEGORY_PRESENTATION[category ?? ""] ?? {
    label: "世界设定",
    icon: Globe2,
    stateKeywords: ["状态", "设定"],
    stateLabel: "当前状态",
    placeholder: "写这条设定的细节……",
  };
}
// ─── 动态区数据 ──────────────────────────────────────────────────────

interface RelationshipRecord {
  subject?: string;
  object?: string;
  predicate?: string;
  evidenceText?: string;
  sourceChapter?: number;
  chapterNumber?: number;
}

interface GraphRelationshipResponse {
  facts?: RelationshipRecord[];
  events?: RelationshipRecord[];
}

export interface RelatedCharacter {
  readonly name: string;
  readonly label: string;
  readonly chapter?: number;
}

export interface WorldDynamicsSnapshot {
  readonly stateFacts: readonly EntityFact[];
  readonly otherFacts: readonly EntityFact[];
  readonly evolution: readonly EvolutionStep[];
  readonly relatedCharacters: readonly RelatedCharacter[];
}

function factMatchesKeywords(fact: EntityFact, keywords: readonly string[]): boolean {
  const haystack = [fact.category, fact.predicate, fact.object, fact.evidenceText]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

export function factText(fact: EntityFact): string {
  const parts = [fact.predicate, fact.object].filter((value) => typeof value === "string" && value.trim());
  return parts.join("：") || fact.evidenceText?.trim() || "已记录动态事实";
}

/** 从已按条目 id 过滤的关系图里取出对端显示名。selfName 只用于去掉本实体，不参与查询。 */
export function extractRelatedCharacters(
  payload: GraphRelationshipResponse,
  selfName?: string,
): RelatedCharacter[] {
  const self = selfName?.trim();
  const collected: RelatedCharacter[] = [];
  for (const record of [...(payload.facts ?? []), ...(payload.events ?? [])]) {
    const subject = record.subject?.trim();
    const object = record.object?.trim();
    if (!subject || !object) continue;
    for (const counterpart of [subject, object]) {
      if (self && counterpart === self) continue;
      if (collected.some((item) => item.name === counterpart)) continue;
      const chapter = record.sourceChapter ?? record.chapterNumber;
      collected.push({
        name: counterpart,
        label: [record.predicate?.trim(), record.evidenceText?.trim()].filter(Boolean).join("：") || "与本实体有交互",
        ...(typeof chapter === "number" && Number.isFinite(chapter) ? { chapter } : {}),
      });
    }
  }
  return collected.slice(0, 8);
}
type DynamicsState =
  | { status: "idle" | "loading" }
  | { status: "ready"; snapshot: WorldDynamicsSnapshot }
  | { status: "error"; message: string };

/**
 * 实体动态区取数。与角色卡同源接口，但按世界分类抽取"当前状态"。
 * 三路请求并发，各自 catch：单路失败不会让整个动态区变成错误态。
 */
function useWorldDynamics(bookId: string | undefined, entryId: string, selfName: string, keywords: readonly string[]) {
  const [state, setState] = useState<DynamicsState>({ status: "idle" });
  const keywordKey = keywords.join("|");

  const load = useCallback(async () => {
    const id = entryId.trim();
    if (!bookId?.trim() || !id) {
      setState({ status: "ready", snapshot: { stateFacts: [], otherFacts: [], evolution: [], relatedCharacters: [] } });
      return;
    }
    setState({ status: "loading" });
    const activeKeywords = keywordKey ? keywordKey.split("|") : [];
    const [groups, evolution, relationships] = await Promise.all([
      fetchFactsByEntity(bookId, { entryId: id }).catch(() => []),
      loadEvolution(bookId, id).catch(() => []),
      fetchJson<GraphRelationshipResponse>(
        `/api/books/${encodeURIComponent(bookId)}/narrative-memory/graph?view=relationship&focusEntryId=${encodeURIComponent(id)}`,
      ).catch(() => ({} as GraphRelationshipResponse)),
    ]);
    const facts = groups.flatMap((group) => group.facts ?? []);
    setState({
      status: "ready",
      snapshot: {
        stateFacts: facts.filter((fact) => factMatchesKeywords(fact, activeKeywords)).slice(0, 6),
        otherFacts: facts.filter((fact) => !factMatchesKeywords(fact, activeKeywords)).slice(0, 6),
        evolution: evolution.slice(-10),
        relatedCharacters: extractRelatedCharacters(relationships, selfName),
      },
    });
  }, [bookId, entryId, selfName, keywordKey]);

  useEffect(() => { void load(); }, [load]);

  return { state, refresh: () => void load() };
}
function FactLine({ fact }: { fact: EntityFact }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/70 px-2.5 py-2">
      <p className="text-xs font-medium leading-relaxed">{factText(fact)}</p>
      {typeof fact.sourceChapter === "number" ? (
        <p className="mt-0.5 text-2xs text-muted-foreground">第 {fact.sourceChapter} 章结算</p>
      ) : null}
    </div>
  );
}

function WorldDynamicsSection({
  bookId,
  entryId,
  selfName,
  presentation,
}: {
  bookId?: string;
  entryId: string;
  selfName: string;
  presentation: CategoryPresentation;
}) {
  const { state, refresh } = useWorldDynamics(bookId, entryId, selfName, presentation.stateKeywords);
  const snapshot = state.status === "ready" ? state.snapshot : undefined;
  const isEmpty = snapshot
    && snapshot.stateFacts.length === 0
    && snapshot.otherFacts.length === 0
    && snapshot.evolution.length === 0
    && snapshot.relatedCharacters.length === 0;

  return (
    <Card className="border-sky-500/30 bg-sky-500/[0.035]" data-testid="world-dynamics-section">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-sky-600" />
              实体动态
              <Badge variant="secondary" className="text-2xs font-normal">动态数据</Badge>
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">来自叙事记忆的只读召回；不改经纬静态设定。</p>
          </div>
          {bookId ? (
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={refresh} aria-label="刷新实体动态">
              <RefreshCw className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.status === "loading" ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/70 px-3 py-5 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />正在读取叙事记忆……
          </div>
        ) : state.status === "error" ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/[0.04] px-3 py-3 text-xs text-destructive">
            <span>动态数据暂时不可用：{state.message}</span>
            <Button variant="outline" size="sm" onClick={refresh}>重试</Button>
          </div>
        ) : (
          <>
            {isEmpty ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/[0.05] px-4 py-4 text-center" data-testid="world-dynamics-empty">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">该实体暂无章后结算记录</p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                  叙事记忆只收录正文中实际出现并经章后结算的动态。「{selfName.trim() || "该实体"}」可能尚未登场，
                  或结算器未从正文识别到与它相关的变化。静态设定不受影响。
                </p>
              </div>
            ) : null}

            <section className="space-y-2" aria-labelledby="world-current-state-title">
              <div className="flex items-center gap-2">
                <Clock3 className="size-3.5 text-sky-600" />
                <h3 id="world-current-state-title" className="text-xs font-semibold tracking-wide">{presentation.stateLabel}</h3>
                <span className="text-2xs text-muted-foreground">来自当前 open facts</span>
              </div>
              {snapshot && snapshot.stateFacts.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {snapshot.stateFacts.map((fact, index) => <FactLine key={fact.id ?? `state-${index}`} fact={fact} />)}
                </div>
              ) : <p className="rounded-md border border-dashed border-border/70 px-3 py-3 text-xs text-muted-foreground">暂无匹配该分类关键词的动态事实。</p>}
              {snapshot && snapshot.otherFacts.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {snapshot.otherFacts.map((fact, index) => (
                    <Badge key={fact.id ?? `other-${index}`} variant="outline" className="text-2xs font-normal">{factText(fact)}</Badge>
                  ))}
                </div>
              ) : null}
            </section>

            <Separator />
            <section className="space-y-2" aria-labelledby="world-evolution-title">
              <div className="flex items-center gap-2">
                <GitBranch className="size-3.5 text-sky-600" />
                <h3 id="world-evolution-title" className="text-xs font-semibold tracking-wide">发展历程</h3>
                <span className="text-2xs text-muted-foreground">最近 10 条</span>
              </div>
              {snapshot && snapshot.evolution.length > 0 ? (
                <ol className="space-y-2 border-l border-sky-500/25 pl-3">
                  {snapshot.evolution.map((step, index) => (
                    <li key={`${step.chapter}-${step.eventType}-${index}`} className="rounded-md border border-border/50 bg-background/60 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-2xs">第 {step.chapter} 章</Badge>
                        <Badge variant="secondary" className="text-2xs font-normal">{step.eventType}</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-foreground/90">{step.description}</p>
                    </li>
                  ))}
                </ol>
              ) : <p className="rounded-md border border-dashed border-border/70 px-3 py-3 text-xs text-muted-foreground">还没有检索到与该实体相关的章节事件。</p>}
            </section>

            <Separator />

            <section className="space-y-2" aria-labelledby="world-related-characters-title">
              <div className="flex items-center gap-2">
                <Users className="size-3.5 text-sky-600" />
                <h3 id="world-related-characters-title" className="text-xs font-semibold tracking-wide">关联角色</h3>
                <span className="text-2xs text-muted-foreground">与该实体有过交互</span>
              </div>
              {snapshot && snapshot.relatedCharacters.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {snapshot.relatedCharacters.map((item) => (
                    <div key={item.name} className="rounded-md border border-border/50 bg-background/60 px-3 py-2">
                      <div className="flex items-center gap-2 text-xs font-medium">
                        <span className="truncate">{item.name}</span>
                        {item.chapter !== undefined ? <Badge variant="outline" className="text-2xs">第 {item.chapter} 章</Badge> : null}
                      </div>
                      <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{item.label}</p>
                    </div>
                  ))}
                </div>
              ) : <p className="rounded-md border border-dashed border-border/70 px-3 py-3 text-xs text-muted-foreground">暂未发现与该实体交互的角色。</p>}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
// ─── 主组件 ──────────────────────────────────────────────────────────

export interface WorldCardPageProps {
  entry: JingweiEntryData;
  bookId?: string;
  saving?: boolean;
  onSave: (entryId: string, payload: JingweiEntrySavePayload) => Promise<void>;
  relatedEntries?: RelatedEntryItem[];
  onNavigateToEntry?: (entryId: string) => void;
}

const WORLD_HIDDEN_FIELD_KEYS = ["name"] as const;

export function WorldCardPage({ entry, bookId, saving = false, onSave, relatedEntries, onNavigateToEntry }: WorldCardPageProps) {
  const [title, setTitle] = useState(entry.title);
  const [savingLocal, setSavingLocal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canon, setCanon] = useState<JingweiCanonValues>(() => canonValuesFromEntry(entry));
  // 档案式阅读为默认形态；未确认条目（needs-review / draft）打开即编辑，与经纬条目详情同规。
  const [isEditing, setIsEditing] = useState(() => opensInEditMode(entry.status));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // 编辑基线：取消编辑据此还原，dirty 据此判定；打开即编辑（未确认条目）也从初始快照起步。
  const [baseline, setBaseline] = useState<{ title: string; contentMd: string; canonJson: string } | null>(
    () => ({ title: entry.title, contentMd: entry.contentMd ?? "", canonJson: JSON.stringify(canonValuesFromEntry(entry)) }),
  );
  const presentation = useMemo(() => presentationFor(canon.category), [canon.category]);
  const Icon = presentation.icon;

  // 只在条目 id 变化时重置。editor 用 ref，避免 mock 每次 render 新对象把 effect 打成死循环。
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);

  const currentContentMd = useCallback((): string => {
    const ed = editorRef.current;
    if (!ed) return entry.contentMd ?? "";
    return (ed.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ?? ed.getText();
    // entry.contentMd 只作编辑器缺失时的兜底，不随每次 render 进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: presentation.placeholder }),
      Markdown.configure({ html: false, tightLists: true, transformPastedText: true }),
    ],
    content: entry.contentMd ?? "",
    editable: isEditing,
    editorProps: {
      attributes: { class: "prose prose-sm max-w-none min-h-[220px] px-3 py-2 focus:outline-none" },
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    editor?.setEditable(isEditing);
  }, [editor, isEditing]);

  const dirty = isEditing && baseline !== null
    && (title !== baseline.title
      || currentContentMd() !== baseline.contentMd
      || JSON.stringify(canon) !== baseline.canonJson);

  useEffect(() => {
    setTitle(entry.title);
    setError(null);
    setCanon(canonValuesFromEntry(entry));
    setIsEditing(opensInEditMode(entry.status));
    setConfirmDiscard(false);
    setBaseline({ title: entry.title, contentMd: entry.contentMd ?? "", canonJson: JSON.stringify(canonValuesFromEntry(entry)) });
    editorRef.current?.commands.setContent(entry.contentMd ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  const handleSave = async () => {
    if (!editor || savingLocal) return;
    setSavingLocal(true);
    setError(null);
    try {
      const fields = { ...canon.fields };
      if (!String(fields.name ?? "").trim()) fields.name = title.trim() || entry.title;
      const slice = toCanonSaveSlice({ ...canon, fields }, entry);
      await onSave(entry.id, {
        title: title.trim() || entry.title,
        contentMd: (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.()
          ?? editor.getText(),
        ...slice,
      });
      // 保存成功回档案式阅读态。
      setIsEditing(false);
      setBaseline(null);
      setConfirmDiscard(false);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "保存失败");
    } finally {
      setSavingLocal(false);
    }
  };

  function handleStartEdit() {
    setBaseline({ title, contentMd: currentContentMd(), canonJson: JSON.stringify(canon) });
    setConfirmDiscard(false);
    setError(null);
    setIsEditing(true);
  }

  // 取消编辑：无改动直接回阅读态；有未保存改动时先走一次内联确认（与详情页同例）。
  function handleCancelEdit() {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    if (baseline) {
      setTitle(baseline.title);
      setCanon(JSON.parse(baseline.canonJson) as JingweiCanonValues);
      editorRef.current?.commands.setContent(baseline.contentMd);
    }
    setBaseline(null);
    setConfirmDiscard(false);
    setIsEditing(false);
  }

  const busy = saving || savingLocal;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <header className="border-b border-border/40 bg-muted/30 px-8 py-5">
        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Icon className="size-6 text-primary/60" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              {isEditing ? (
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={presentation.label === "地点" ? "地点名" : `${presentation.label}名称`}
                  className="h-auto border-none bg-transparent p-0 text-2xl font-bold focus-visible:ring-0"
                  style={{ boxShadow: "none" }}
                />
              ) : (
                <h1 className="p-0 text-2xl font-bold leading-snug" data-testid="world-card-title-reading">
                  {title.trim() || "未命名条目"}
                </h1>
              )}
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-2xs font-normal">{presentation.label}</Badge>
                {bookId ? null : <Badge variant="outline" className="text-2xs font-normal">未绑定书籍，动态区不可用</Badge>}
                {isEditing ? <Badge className="text-2xs font-normal">编辑中</Badge> : null}
              </div>
            </div>
          </div>
          {isEditing ? (
            <div className="flex shrink-0 items-center gap-2">
              {dirty ? <Badge className="text-2xs bg-yellow-500/10 text-yellow-600 border-yellow-500/20">未保存</Badge> : null}
              {confirmDiscard ? (
                <span className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">放弃未保存的修改？</span>
                  <Button size="xs" variant="destructive" onClick={handleCancelEdit}>放弃</Button>
                  <Button size="xs" variant="ghost" onClick={() => setConfirmDiscard(false)}>继续编辑</Button>
                </span>
              ) : (
                <Button size="xs" variant="ghost" onClick={handleCancelEdit}>取消</Button>
              )}
              <Button size="sm" className="gap-2" onClick={() => void handleSave()} disabled={!editor || busy || !dirty}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                保存
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="shrink-0" onClick={handleStartEdit} title="编辑此条目">
              <Pencil className="size-4 mr-1" />编辑
            </Button>
          )}
        </div>
        {error ? (
          <p role="alert" className="mt-2 rounded-md border border-destructive/30 bg-destructive/[0.05] px-3 py-1.5 text-xs text-destructive">{error}</p>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 px-8 py-6">
          <Card data-testid="world-static-section">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ScrollText className="size-4" />
                静态设定
                <span className="text-2xs font-normal text-muted-foreground">作者维护的权威设定</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-border bg-background">
                <EditorContent editor={editor} />
                {!isEditing && currentContentMd().trim() === "" ? (
                  <p className="px-3 pb-3 text-xs text-muted-foreground">暂无正文内容</p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <JingweiCanonPanel
            entry={entry}
            bookId={bookId}
            values={canon}
            onChange={setCanon}
            readOnly={!isEditing}
            hiddenFieldKeys={WORLD_HIDDEN_FIELD_KEYS}
            relatedEntries={relatedEntries}
            onNavigateToEntry={onNavigateToEntry}
            onRestored={(restored) => {
              setTitle(restored.title);
              setCanon(canonValuesFromEntry(restored));
              if (editor) editor.commands.setContent(restored.contentMd ?? "");
            }}
          />

          <WorldDynamicsSection bookId={bookId} entryId={entry.id} selfName={entry.title} presentation={presentation} />
        </div>
      </div>
    </div>
  );
}
