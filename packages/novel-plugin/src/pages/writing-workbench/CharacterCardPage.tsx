/**
 * 酒馆风格大屏角色卡 — CharacterCardPage
 *
 * 设计理念（参考酒馆 SillyTavern）：
 *  - 不是干巴巴的表单，而是"一张角色身份卡"
 *  - 大字展示角色名 + 一句话动机
 *  - 内核字段（动机/恐惧/执念/信条）独立高亮卡片
 *  - 经典台词居中斜体展示
 *  - 顶部右侧保存/删按钮清晰可达
 */

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { fetchJson } from "@/hooks/use-api";
import {
  Save,
  Loader2,
  User,
  Sparkles,
  Quote,
  Heart,
  Skull,
  Anchor,
  Compass,
  Users,
  MapPin,
  ScrollText,
  Activity,
  Clock3,
  GitBranch,
  PackageOpen,
  ShieldAlert,
  RefreshCw,
} from "lucide-react";

import type { JingweiEntryData, JingweiEntrySavePayload, RelatedEntryItem } from "./JingweiEntryEditor";

// ─── Types ──────────────────────────────────────────────────────────────

export interface EvolutionStep {
  chapter: number;
  eventType: string;
  description: string;
  timestamp?: string;
}

interface NarrativeFactRecord {
  id?: string;
  subject?: string;
  predicate?: string;
  object?: string;
  category?: string;
  validFromChapter?: number;
  sourceChapter?: number;
  evidenceText?: string;
}

interface NarrativeEventRecord {
  chapterNumber?: number;
  eventType?: string;
  subject?: string;
  predicate?: string;
  object?: string;
  evidenceText?: string;
  createdAt?: string;
  appliedAt?: string;
}

interface NarrativeGraphResponse {
  facts?: NarrativeFactRecord[];
  events?: NarrativeEventRecord[];
}

interface DynamicRelationship {
  subject: string;
  object: string;
  label: string;
  chapter?: number;
  timestamp?: string;
}

interface DynamicState {
  realm?: NarrativeFactRecord;
  resources: NarrativeFactRecord[];
  injury?: NarrativeFactRecord;
  other: NarrativeFactRecord[];
}

interface CharacterDevelopmentSnapshot {
  evolution: EvolutionStep[];
  state: DynamicState;
  relationships: DynamicRelationship[];
}

type CharacterDevelopmentLoadState =
  | { status: "idle" | "loading" }
  | { status: "ready"; snapshot: CharacterDevelopmentSnapshot }
  | { status: "error"; message: string };

const DEVELOPMENT_CACHE_TTL_MS = 30_000;
const developmentCache = new Map<string, { expiresAt: number; snapshot: CharacterDevelopmentSnapshot }>();
const developmentRequests = new Map<string, Promise<CharacterDevelopmentSnapshot>>();

function narrativeMemoryBase(bookId: string): string {
  return `/api/books/${encodeURIComponent(bookId)}/narrative-memory`;
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function eventDescription(event: NarrativeEventRecord): string {
  const evidence = stringOrUndefined(event.evidenceText);
  if (evidence) return evidence;
  return [stringOrUndefined(event.subject), stringOrUndefined(event.predicate), stringOrUndefined(event.object)]
    .filter(Boolean)
    .join(" ") || "叙事记忆记录了一次角色状态变化。";
}

function factText(fact: NarrativeFactRecord): string {
  return [stringOrUndefined(fact.predicate), stringOrUndefined(fact.object)]
    .filter(Boolean)
    .join("：") || stringOrUndefined(fact.evidenceText) || "已记录动态事实";
}

function hasFactKeyword(fact: NarrativeFactRecord, keywords: readonly string[]): boolean {
  const haystack = [fact.category, fact.predicate, fact.object, fact.evidenceText]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function extractDynamicState(facts: NarrativeFactRecord[]): DynamicState {
  const realm = facts.find((fact) => hasFactKeyword(fact, ["修为", "境界", "实力", "realm", "rank", "职级"]));
  const resources = facts.filter((fact) => hasFactKeyword(fact, ["持有", "物品", "资源", "装备", "法宝", "道具", "灵石", "item", "resource"]));
  const injury = facts.find((fact) => hasFactKeyword(fact, ["伤势", "受伤", "伤口", "病", "中毒", "health", "injury"]));
  const used = new Set([realm, injury, ...resources]);
  return {
    realm,
    resources,
    injury,
    other: facts.filter((fact) => !used.has(fact)).slice(0, 6),
  };
}

function relationshipFromRecord(record: NarrativeFactRecord | NarrativeEventRecord): DynamicRelationship | null {
  const subject = stringOrUndefined(record.subject);
  const object = stringOrUndefined(record.object);
  if (!subject || !object) return null;
  const label = [stringOrUndefined(record.predicate), stringOrUndefined(record.evidenceText)]
    .filter(Boolean)
    .join("：") || "关系发生变化";
  return {
    subject,
    object,
    label,
    chapter: numberOrUndefined(
      "sourceChapter" in record
        ? record.sourceChapter
        : "chapterNumber" in record
          ? record.chapterNumber
          : undefined,
    ),
    timestamp: stringOrUndefined(
      "createdAt" in record
        ? record.createdAt
        : "appliedAt" in record
          ? record.appliedAt
          : undefined,
    ),
  };
}

function relationshipKey(relationship: DynamicRelationship): string {
  return `${relationship.subject}::${relationship.object}::${relationship.label}`;
}

/** 从 Narrative Memory event_chain 读取角色最近的关键发展节点。 */
export async function loadEvolution(
  bookId: string,
  characterName: string,
  uptoChapter?: number,
): Promise<EvolutionStep[]> {
  if (!bookId.trim() || !characterName.trim()) return [];
  const params = new URLSearchParams({ view: "event_chain", focusEntity: characterName.trim() });
  if (uptoChapter !== undefined && Number.isFinite(uptoChapter)) params.set("chapterTo", String(uptoChapter));
  const payload = await fetchJson<NarrativeGraphResponse>(`${narrativeMemoryBase(bookId)}/graph?${params.toString()}`);
  return (payload.events ?? [])
    .map((event): EvolutionStep | null => {
      const chapter = numberOrUndefined(event.chapterNumber);
      const eventType = stringOrUndefined(event.eventType);
      if (chapter === undefined || !eventType) return null;
      return {
        chapter,
        eventType,
        description: eventDescription(event),
        ...(stringOrUndefined(event.appliedAt ?? event.createdAt) ? { timestamp: stringOrUndefined(event.appliedAt ?? event.createdAt) } : {}),
      };
    })
    .filter((step): step is EvolutionStep => step !== null)
    .sort((left, right) => left.chapter - right.chapter)
    .slice(-10);
}

async function loadCharacterDevelopment(
  bookId: string,
  characterName: string,
  uptoChapter?: number,
  force = false,
): Promise<CharacterDevelopmentSnapshot> {
  const cacheKey = `${bookId}::${characterName}::${uptoChapter ?? "latest"}`;
  const cached = developmentCache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.snapshot;
  if (!force) {
    const existing = developmentRequests.get(cacheKey);
    if (existing) return existing;
  }

  const request = Promise.all([
    loadEvolution(bookId, characterName, uptoChapter),
    fetchJson<{ groups?: Array<{ entity?: string; facts?: NarrativeFactRecord[] }> }>(
      `${narrativeMemoryBase(bookId)}/facts/by-entity?entity=${encodeURIComponent(characterName.trim())}${uptoChapter !== undefined ? `&asOfChapter=${encodeURIComponent(String(uptoChapter))}` : ""}`,
    ),
    fetchJson<NarrativeGraphResponse>(
      `${narrativeMemoryBase(bookId)}/graph?view=relationship&focusEntity=${encodeURIComponent(characterName.trim())}${uptoChapter !== undefined ? `&chapterTo=${encodeURIComponent(String(uptoChapter))}` : ""}`,
    ),
  ]).then(([evolution, factsPayload, relationshipPayload]) => {
    const groups = factsPayload.groups ?? [];
    const facts = groups.flatMap((group) => group.facts ?? []);
    const relationships = [
      ...(relationshipPayload.facts ?? []).map(relationshipFromRecord),
      ...(relationshipPayload.events ?? []).map(relationshipFromRecord),
    ]
      .filter((item): item is DynamicRelationship => item !== null)
      .sort((left, right) => (right.chapter ?? 0) - (left.chapter ?? 0))
      .filter((item, index, all) => all.findIndex((candidate) => relationshipKey(candidate) === relationshipKey(item)) === index)
      .slice(0, 8);
    return { evolution, state: extractDynamicState(facts), relationships };
  });

  developmentRequests.set(cacheKey, request);
  try {
    const snapshot = await request;
    developmentCache.set(cacheKey, { expiresAt: Date.now() + DEVELOPMENT_CACHE_TTL_MS, snapshot });
    return snapshot;
  } finally {
    developmentRequests.delete(cacheKey);
  }
}

function SpaceDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1" role="separator" aria-label={label}>
      <Separator className="flex-1" />
      <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <Separator className="flex-1" />
    </div>
  );
}

// ─── Helper: read string field from entry.fields ────────────────────────

export interface CharacterCardPageProps {
  entry: JingweiEntryData;
  bookId?: string;
  saving: boolean;
  onSave: (entryId: string, payload: JingweiEntrySavePayload) => Promise<void>;
  /** 关联条目（暂时不展示，保留接口预留） */
  relatedEntries?: RelatedEntryItem[];
}

// ─── Helper: read string field from entry.fields ────────────────────────

function readString(fields: Record<string, unknown> | undefined, key: string): string {
  if (!fields) return "";
  const v = fields[key];
  return typeof v === "string" ? v : "";
}

function readStringArray(fields: Record<string, unknown> | undefined, key: string): string[] {
  if (!fields) return [];
  const v = fields[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.trim()) {
    // 兼容："A, B, C" 或 "A\nB\nC"
    return v.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// 中文"别名"字段 → string[] aliases
function normalizeAliases(input: string): string[] {
  if (!input.trim()) return [];
  return input
    .split(/[\/、,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatAliases(aliases?: string[]): string {
  return (aliases ?? []).join(" / ");
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

function useCharacterDevelopment(bookId: string | undefined, characterName: string, uptoChapter?: number) {
  const [loadState, setLoadState] = useState<CharacterDevelopmentLoadState>({ status: "idle" });
  const requestIdRef = useRef(0);
  const debouncedName = useDebouncedValue(characterName.trim(), 300);
  const load = useCallback(async (force = false) => {
    const requestId = ++requestIdRef.current;
    if (!bookId?.trim() || !debouncedName) {
      if (requestId === requestIdRef.current) {
        setLoadState({ status: "ready", snapshot: { evolution: [], state: { resources: [], other: [] }, relationships: [] } });
      }
      return;
    }
    setLoadState({ status: "loading" });
    try {
      const snapshot = await loadCharacterDevelopment(bookId, debouncedName, uptoChapter, force);
      if (requestId !== requestIdRef.current) return;
      setLoadState({ status: "ready", snapshot });
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setLoadState({ status: "error", message: cause instanceof Error ? cause.message : "动态人物数据加载失败" });
    }
  }, [bookId, debouncedName, uptoChapter]);

  useEffect(() => () => {
    requestIdRef.current += 1;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, refresh: () => void load(true) };
}

function ChapterBadge({ chapter }: { chapter?: number }) {
  return chapter === undefined ? null : <Badge variant="outline" className="shrink-0 text-[10px]">第 {chapter} 章</Badge>;
}

function FactLine({ fact, icon: Icon }: { fact: NarrativeFactRecord; icon: typeof Activity }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/50 bg-background/70 px-2.5 py-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium leading-relaxed">{factText(fact)}</p>
        {fact.sourceChapter !== undefined ? <p className="mt-0.5 text-[10px] text-muted-foreground">第 {fact.sourceChapter} 章结算</p> : null}
      </div>
    </div>
  );
}

function DevelopmentSection({
  bookId,
  characterName,
  uptoChapter,
}: {
  bookId?: string;
  characterName: string;
  uptoChapter?: number;
}) {
  const { loadState, refresh } = useCharacterDevelopment(bookId, characterName, uptoChapter);
  const snapshot = loadState.status === "ready" ? loadState.snapshot : undefined;
  const state = snapshot?.state;

  return (
    <>
      <SpaceDivider label="发展历程 · Narrative Memory" />
      <Card className="border-emerald-500/30 bg-emerald-500/[0.035]" data-testid="character-development-section">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="size-4 text-emerald-600" />
                发展历程
                <Badge variant="secondary" className="text-[10px] font-normal">动态数据</Badge>
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">按章节读取最近的状态变化、关键节点和关系演化；只读，不改经纬设定。</p>
            </div>
            {bookId ? (
              <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={refresh} aria-label="刷新人物发展历程">
                <RefreshCw className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadState.status === "loading" ? (
            <div className="flex items-center gap-2 rounded-md border border-dashed border-border/70 px-3 py-5 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />正在读取叙事记忆……
            </div>
          ) : loadState.status === "error" ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/[0.04] px-3 py-3 text-xs text-destructive">
              <span>动态数据暂时不可用：{loadState.message}</span>
              <Button variant="outline" size="sm" onClick={refresh}>重试</Button>
            </div>
          ) : (
            <>
              {/*
               * 空数据诚实诊断：当三路请求全部返回空时，明确告知用户原因——
               * 该角色从未被章后结算器记录过（未出场/未被识别），不是功能故障。
               * 同时给出有数据的角色作为对照，让用户能立即自证功能是好的。
               */}
              {!snapshot?.evolution.length && !state?.realm && !state?.injury && !state?.resources.length && !snapshot?.relationships.length ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/[0.05] px-4 py-5 text-center space-y-2" data-testid="character-development-empty-diagnosis">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">该角色暂无任何章后结算记录</p>
                  <p className="text-xs leading-relaxed text-muted-foreground max-w-md mx-auto">
                    叙事记忆只收录<strong>正文中实际出场</strong>并经章后结算的角色动态。
                    「{characterName.trim() || "该角色"}」可能尚未正式登场，或结算器未从正文识别到 TA 的状态变化。
                    经纬静态设定不受影响，写作召回仍会携带本卡的内核字段。
                  </p>
                  <p className="text-[10px] text-muted-foreground/80">
                    想验证动态功能？打开一位已出场主角（如「薛行之」）即可看到发展历程与关系演化。
                  </p>
                </div>
              ) : null}
              <section className="space-y-2" aria-labelledby="character-current-state-title">
                <div className="flex items-center gap-2">
                  <Clock3 className="size-3.5 text-emerald-600" />
                  <h3 id="character-current-state-title" className="text-xs font-semibold tracking-wide">当前状态</h3>
                  <span className="text-[10px] text-muted-foreground">来自当前 open facts</span>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <div className="space-y-2 rounded-md border border-border/50 bg-background/55 p-2.5">
                    <p className="text-[10px] font-medium text-muted-foreground">修为 / 境界</p>
                    {state?.realm ? <FactLine fact={state.realm} icon={Sparkles} /> : <p className="text-xs text-muted-foreground">暂无动态记录</p>}
                  </div>
                  <div className="space-y-2 rounded-md border border-border/50 bg-background/55 p-2.5">
                    <p className="text-[10px] font-medium text-muted-foreground">持有物品 / 资源</p>
                    {state && state.resources.length > 0 ? state.resources.slice(0, 3).map((fact, index) => <FactLine key={fact.id ?? `resource-${index}`} fact={fact} icon={PackageOpen} />) : <p className="text-xs text-muted-foreground">暂无动态记录</p>}
                  </div>
                  <div className="space-y-2 rounded-md border border-border/50 bg-background/55 p-2.5">
                    <p className="text-[10px] font-medium text-muted-foreground">伤势状态</p>
                    {state?.injury ? <FactLine fact={state.injury} icon={ShieldAlert} /> : <p className="text-xs text-muted-foreground">暂无动态记录</p>}
                  </div>
                </div>
                {state && state.other.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {state.other.map((fact, index) => <Badge key={fact.id ?? `other-${index}`} variant="outline" className="text-[10px] font-normal">{factText(fact)}</Badge>)}
                  </div>
                ) : null}
              </section>

              <Separator />

              <section className="space-y-2" aria-labelledby="character-evolution-title">
                <div className="flex items-center gap-2">
                  <GitBranch className="size-3.5 text-emerald-600" />
                  <h3 id="character-evolution-title" className="text-xs font-semibold tracking-wide">关键发展节点</h3>
                  <span className="text-[10px] text-muted-foreground">最近 10 条</span>
                </div>
                {snapshot?.evolution.length ? (
                  <ol className="space-y-2 border-l border-emerald-500/25 pl-3">
                    {snapshot.evolution.map((step, index) => (
                      <li key={`${step.chapter}-${step.eventType}-${index}`} className="relative rounded-md border border-border/50 bg-background/60 px-3 py-2 before:absolute before:-left-[1.05rem] before:top-3 before:size-2 before:rounded-full before:border-2 before:border-emerald-500 before:bg-background">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <ChapterBadge chapter={step.chapter} />
                          <Badge variant="secondary" className="text-[10px] font-normal">{step.eventType}</Badge>
                          {step.timestamp ? <span className="text-[10px] text-muted-foreground">{step.timestamp}</span> : null}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-foreground/90">{step.description}</p>
                      </li>
                    ))}
                  </ol>
                ) : <p className="rounded-md border border-dashed border-border/70 px-3 py-4 text-xs text-muted-foreground">还没有检索到该角色的章节发展节点。</p>}
              </section>

              <Separator />

              <section className="space-y-2" aria-labelledby="character-relationship-evolution-title">
                <div className="flex items-center gap-2">
                  <Users className="size-3.5 text-emerald-600" />
                  <h3 id="character-relationship-evolution-title" className="text-xs font-semibold tracking-wide">关系演化</h3>
                  <span className="text-[10px] text-muted-foreground">当前关系 + 最近变化</span>
                </div>
                {snapshot?.relationships.length ? (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {snapshot.relationships.map((relationship, index) => (
                      <div key={`${relationshipKey(relationship)}-${index}`} className="rounded-md border border-border/50 bg-background/60 px-3 py-2">
                        <div className="flex items-center gap-2 text-xs font-medium">
                          <span className="truncate">{relationship.subject}</span>
                          <span className="text-muted-foreground">↔</span>
                          <span className="truncate">{relationship.object}</span>
                          <ChapterBadge chapter={relationship.chapter} />
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{relationship.label}</p>
                      </div>
                    ))}
                  </div>
                ) : <p className="rounded-md border border-dashed border-border/70 px-3 py-4 text-xs text-muted-foreground">暂未发现与该角色相关的动态关系。</p>}
              </section>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export function CharacterCardPage(props: CharacterCardPageProps) {
  const { entry, saving, onSave } = props;

  // 标题（角色名）
  const [title, setTitle] = useState(entry.title);
  // 顶部一句话动机（快捷展示）
  const [tagline, setTagline] = useState(() => readString(entry.fields, "core_motive"));
  // 元信息
  const [roleType, setRoleType] = useState(() => readString(entry.fields, "roleType"));
  const [realm, setRealm] = useState(() => readString(entry.fields, "realm"));
  const [firstChapter, setFirstChapter] = useState(() => readString(entry.fields, "firstChapter"));
  const [aliasesInput, setAliasesInput] = useState(() =>
    formatAliases(readStringArray(entry.fields, "aliases") ?? entry.aliases ?? [])
  );

  // 角色内核四件套
  const [coreMotive, setCoreMotive] = useState(() => readString(entry.fields, "core_motive"));
  const [coreFear, setCoreFear] = useState(() => readString(entry.fields, "core_fear"));
  const [coreObsession, setCoreObsession] = useState(() => readString(entry.fields, "core_obsession"));
  const [coreBelief, setCoreBelief] = useState(() => readString(entry.fields, "core_belief"));

  // 经典台词（每行一句）
  const [quotesInput, setQuotesInput] = useState(() => {
    const arr = readStringArray(entry.fields, "classic_quotes");
    return arr.join("\n");
  });

  // 羁绊摘要
  const [relationshipSummary, setRelationshipSummary] = useState(() =>
    readString(entry.fields, "relationship_summary")
  );

  // 性格和目标（用 textarea）
  const [personality, setPersonality] = useState(() => readString(entry.fields, "personality"));
  const [goal, setGoal] = useState(() => readString(entry.fields, "goal"));

  // tipTap 编辑器（详细背景）
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "在这里写角色的详细背景、外貌、经历……" }),
      Markdown.configure({
        html: false,
        tightLists: true,
        transformPastedText: true,
      }),
    ],
    content: entry.contentMd ?? "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[220px] px-3 py-2 focus:outline-none",
      },
    },
  });

  // 同步 entry 切换（外部换条目时重置）
  const entryIdRef = useMemo(() => entry.id, []);
  useEffect(() => {
    if (entry.id === entryIdRef) return;
    // 切换到另一个条目时刷新所有输入
    setTitle(entry.title);
    setTagline(readString(entry.fields, "core_motive"));
    setRoleType(readString(entry.fields, "roleType"));
    setRealm(readString(entry.fields, "realm"));
    setFirstChapter(readString(entry.fields, "firstChapter"));
    setAliasesInput(formatAliases(entry.aliases ?? readStringArray(entry.fields, "aliases")));
    setCoreMotive(readString(entry.fields, "core_motive"));
    setCoreFear(readString(entry.fields, "core_fear"));
    setCoreObsession(readString(entry.fields, "core_obsession"));
    setCoreBelief(readString(entry.fields, "core_belief"));
    setQuotesInput(readStringArray(entry.fields, "classic_quotes").join("\n"));
    setRelationshipSummary(readString(entry.fields, "relationship_summary"));
    setPersonality(readString(entry.fields, "personality"));
    setGoal(readString(entry.fields, "goal"));
    if (editor) {
      editor.commands.setContent(entry.contentMd ?? "");
    }
  }, [entry, editor]);

  // ─── 摘要作用域：台词数组、别名 ─────────────────────────────
  const quotes = quotesInput
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const aliasesParsed = normalizeAliases(aliasesInput);

  // ─── 保存 ──────────────────────────────────────────────────
  const handleSave = async () => {
    if (!editor) return;
    const contentMd = (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ?? editor.getText();

    // 合并保存：原有 fields + 新增覆盖
    const mergedFields: Record<string, unknown> = {
      ...(entry.fields ?? {}),
      roleType,
      realm,
      firstChapter,
      aliases: aliasesParsed,
      core_motive: coreMotive,
      core_fear: coreFear,
      core_obsession: coreObsession,
      core_belief: coreBelief,
      classic_quotes: quotes,
      relationship_summary: relationshipSummary,
      personality,
      goal,
    };

    await onSave(entry.id, {
      title,
      contentMd,
      category: entry.category ?? "characters",
      aliases: aliasesParsed,
      priorityTier: entry.priorityTier,
      layer: entry.layer,
      status: entry.status,
      relatedEntryIds: entry.relatedEntryIds,
      visibility: entry.visibility,
      visibleAfterChapter: entry.visibleAfterChapter ?? null,
      visibleUntilChapter: entry.visibleUntilChapter ?? null,
      // @ts-expect-error - fields 不在官方类型里,但后端接受
      fields: mergedFields,
    });
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      {/* ─── 1️️⃣ 顶部：角色名 + 一句话动机 + 保存按钮 ─── */}
      <header className="border-b border-border/40 bg-muted/30 px-8 py-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex items-center gap-3">
              {/* 头像占位（未来可加图片） */}
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <User className="w-8 h-8 text-primary/60" />
              </div>

              <div className="flex-1 min-w-0">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="角色名"
                  className="text-3xl font-bold border-none bg-transparent p-0 focus-visible:ring-0 h-auto"
                  style={{ boxShadow: "none" }}
                />
                <Input
                  value={tagline}
                  onChange={(e) => {
                    setTagline(e.target.value);
                    setCoreMotive(e.target.value); // 同步进内核卡
                  }}
                  placeholder="「用一句话概括这个角色的灵魂」"
                  className="text-lg italic text-muted-foreground border-none bg-transparent p-0 focus-visible:ring-0 h-auto mt-1"
                  style={{ boxShadow: "none" }}
                />
              </div>
            </div>

            {/* 元信息标签 */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {roleType && (
                <Badge variant="secondary" className="text-xs">
                  <Sparkles className="w-3 h-3 mr-1" />
                  {roleType}
                </Badge>
              )}
              {realm && (
                <Badge variant="outline" className="text-xs">
                  {realm}
                </Badge>
              )}
              {firstChapter && (
                <Badge variant="outline" className="text-xs">
                  初登场 {firstChapter}
                </Badge>
              )}
              {aliasesParsed.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  别名: {aliasesParsed.slice(0, 3).join(" / ")}
                  {aliasesParsed.length > 3 && " …"}
                </span>
              )}
            </div>
          </div>

          {/* 保存按钮 */}
          <div className="flex gap-2 flex-shrink-0">
            <Button
              size="sm"
              className="gap-2"
              onClick={handleSave}
              disabled={saving || !editor}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              保存
            </Button>
          </div>
        </div>
      </header>

      {/* ─── 主区域滚动 body ─── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-6 space-y-6">

          {/* ─── 2️⃣ 角色内核四件套（核心卡片） ─── */}
          <Card className="border-primary/30 bg-primary/[0.03]">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                角色内核 — AI 写作时永远不会忘记的"魂"
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Heart className="w-3 h-3" />
                    核心动机
                  </label>
                  <Input
                    value={coreMotive}
                    onChange={(e) => setCoreMotive(e.target.value)}
                    placeholder="这个角色最想要什么？(eg: 复仇 / 守护)"
                    className="bg-background"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Skull className="w-3 h-3" />
                    最深恐惧
                  </label>
                  <Input
                    value={coreFear}
                    onChange={(e) => setCoreFear(e.target.value)}
                    placeholder="他最害怕失去什么？"
                    className="bg-background"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Anchor className="w-3 h-3" />
                    执念
                  </label>
                  <Input
                    value={coreObsession}
                    onChange={(e) => setCoreObsession(e.target.value)}
                    placeholder="什么让他也无法放下？"
                    className="bg-background"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Compass className="w-3 h-3" />
                    信奉
                  </label>
                  <Input
                    value={coreBelief}
                    onChange={(e) => setCoreBelief(e.target.value)}
                    placeholder="他相信什么？世界观信条"
                    className="bg-background"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ─── 3️⃣ 经典台词 ─── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Quote className="w-4 h-4" />
                经典台词
              </CardTitle>
            </CardHeader>
            <CardContent>
              {quotes.length > 0 && (
                <div className="space-y-2 mb-3 p-3 rounded-md bg-muted/40 border border-border/50">
                  {quotes.map((q, i) => (
                    <p key={i} className="text-base italic text-muted-foreground">
                      "{q}"
                    </p>
                  ))}
                </div>
              )}
              <Textarea
                value={quotesInput}
                onChange={(e) => setQuotesInput(e.target.value)}
                placeholder={"每行一句台词\n示例：\n我命由我不由天\n我若成佛，魔奈我何"}
                className="min-h-[100px] font-mono text-sm"
              />
            </CardContent>
          </Card>

          <DevelopmentSection bookId={props.bookId} characterName={title} />

          {/* ─── 4️⃣ 羁绊 ─── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4" />
                羁绊关系
              </CardTitle>
            </CardHeader>
            <CardContent>
              {relationshipSummary.trim() && (
                <div className="mb-3 p-3 rounded-md bg-muted/40 border border-border/50">
                  <p className="text-sm font-medium">{relationshipSummary}</p>
                </div>
              )}
              <Textarea
                value={relationshipSummary}
                onChange={(e) => setRelationshipSummary(e.target.value)}
                placeholder="描述作为核心的人物羁绊（示例：父亲=仇敌 / 白起=亦敌亦友）"
                className="min-h-[80px]"
              />
            </CardContent>
          </Card>

          {/* ─── 5️⃣ 基础信息（表单） ─── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                基础档案
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">角色定位</label>
                  <Input
                    value={roleType}
                    onChange={(e) => setRoleType(e.target.value)}
                    placeholder="主角 / 反派 / 配角"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">修为 / 职级</label>
                  <Input
                    value={realm}
                    onChange={(e) => setRealm(e.target.value)}
                    placeholder="金丹期 / 紫极仙尊"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">首次出场</label>
                  <Input
                    value={firstChapter}
                    onChange={(e) => setFirstChapter(e.target.value)}
                    placeholder="第3章"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">别名（用 / 、 , 或换行分隔）</label>
                <Input
                  value={aliasesInput}
                  onChange={(e) => setAliasesInput(e.target.value)}
                  placeholder="薛小爷 / 北帝"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">性格特征</label>
                <Textarea
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                  placeholder="冷静理性、重诺、沉默寡言……"
                  className="min-h-[80px]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">人生目标</label>
                <Textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="为家族复仇 / 守护平民百姓……"
                  className="min-h-[80px]"
                />
              </div>
            </CardContent>
          </Card>

          {/* ─── 6️⃣ 详细背景（tipTap） ─── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ScrollText className="w-4 h-4" />
                详细背景
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-border bg-background">
                <EditorContent editor={editor} />
              </div>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
