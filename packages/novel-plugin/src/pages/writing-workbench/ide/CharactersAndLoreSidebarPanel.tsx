/**
 * 作品基础侧栏面板：角色册 / 世界录 / 草案三个 tab，下面是条目卡片。
 *
 * 卡面纪律（docs/design/novelfork-frontend-final-board.html 屏 4）：每张卡只放
 * 1. 名称；2. 唯一一个角标（角色取「角色定位」，设定取分类）；3. 一行状态；4. 关键进度
 * （角色：声线确认数、最近出场章、久未出场标「冷」）。
 * 只用已有的结构化数据，缺哪项就不显示哪项；正文碎句、别名、长标签、条目正文一律不上卡面，点开详情才看。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Eye,
  Network,
  Search,
  Snowflake,
  Upload,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/hooks/use-api";
import { SidebarPageHead } from "./SidebarPageHead";
import { fetchCharacterKernels, type CharacterKernelSummary } from "../character-kernel-client";
import { DissectDraftPanel } from "../DissectDraftPanel";
import { useNarrativeStructure } from "../useNarrativeStructure";
import { useWritingProgressRefresh } from "../use-writing-progress-refresh";
import { CATEGORY_META, normalizeCategory, type JingweiCategory } from "../../../engine/jingwei/unified-categories";
import type { NarrativeEntityInfo } from "../../../engine/narrative-taxonomy/narrative-structure";
import {
  CHARACTER_VOICE_FIELD_KEYS,
  parseCharacterVoice,
  type CharacterVoiceFieldStatus,
} from "../../../engine/writing-layers/character-voice";
import { workspaceForCategory } from "../lore-workspace-split";
import { type ResourceTreeAction } from "../WorkbenchResourceTree";
import { createLoreTreesNode, type WorkbenchResourceNode } from "../useWorkbenchResources";

/** `/narrative-memory/facts` 当前台账里的一条事实；只声明卡面用到的字段。 */
export interface EntityFactLite {
  id?: string;
  subject: string;
  predicate: string;
  object: string;
  category?: string;
  evidenceText?: string;
  sourceId?: string;
  /** 事实来源章节；结算产生的事实可作为「出场」证据。 */
  sourceChapter?: number;
  /** 结算回填的经纬条目 id（实体身份链），比按名字匹配可靠。 */
  subjectEntryId?: string;
  validFromChapter?: number;
  validUntilChapter?: number | null;
  /** event=章后结算 / 事件归约；manual=作者手填（不算出场证据）。 */
  sourceType?: string;
}

export interface CharactersAndLoreSidebarPanelProps {
  bookId: string;
  nodes: readonly WorkbenchResourceNode[];
  facts?: readonly EntityFactLite[];
  selectedNodeId: string | null;
  currentChapter?: number;
  onOpen: (node: WorkbenchResourceNode) => void;
  onAction?: (action: ResourceTreeAction) => void;
  onChanged?: () => void;
}

type MainTab = "characters" | "world" | "draft";
type WorldCategoryFilter = JingweiCategory | "all";

const WORLD_CREATE_CATEGORY_META = CATEGORY_META.filter(
  (meta) => workspaceForCategory(meta.id) === "settings" && meta.allowCanon && meta.id !== "characters",
);

function entryCategory(node: WorkbenchResourceNode): JingweiCategory {
  return normalizeCategory(String(node.metadata?.category ?? "unclassified")).category;
}

export function CharactersAndLoreSidebarPanel({
  bookId,
  nodes,
  facts = [],
  selectedNodeId,
  currentChapter,
  onOpen,
  onAction,
  onChanged,
}: CharactersAndLoreSidebarPanelProps) {
  const [activeTab, setActiveTab] = useState<MainTab>("characters");
  const [worldCategoryFilter, setWorldCategoryFilter] = useState<WorldCategoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [creatingChar, setCreatingChar] = useState(false);
  const [newCharName, setNewCharName] = useState("");
  const [newCharCategory, setNewCharCategory] = useState<string>(WORLD_CREATE_CATEGORY_META[0]?.id ?? "world-model");
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // 角色当前内核（每个角色的当前动机/情绪一行摘要），来自结算后写入的 character_kernel。
  // 这个角色册面板就是作者查「这个角色现在是谁」的地方——顺带把内核贴上来，不必再翻叙事记忆面板。
  const [kernelsByCharacterId, setKernelsByCharacterId] = useState<ReadonlyMap<string, CharacterKernelSummary>>(new Map());
  const kernelGenerationRef = useRef(0);
  // 拆书草案计数：只在「作品基础」侧面提示「拆了没处理过的新草案还有几条」。
  const [draftCount, setDraftCount] = useState(0);
  const draftGenerationRef = useRef(0);
  const loadDraftCount = useCallback(async () => {
    if (!bookId) return;
    const generation = ++draftGenerationRef.current;
    try {
      const data = await fetchJson<{ total?: number; count?: number }>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/staging?limit=1`,
      );
      if (generation === draftGenerationRef.current) setDraftCount(data.total ?? data.count ?? 0);
    } catch {
      if (generation === draftGenerationRef.current) setDraftCount(0);
    }
  }, [bookId]);

  useEffect(() => {
    void loadDraftCount();
    return () => { draftGenerationRef.current += 1; };
  }, [loadDraftCount]);
  useWritingProgressRefresh(bookId, loadDraftCount);

  const loadKernels = useCallback(() => {
    if (!bookId) return;
    const generation = ++kernelGenerationRef.current;
    void fetchCharacterKernels(bookId)
      .then((list) => {
        if (generation !== kernelGenerationRef.current) return;
        const map = new Map<string, CharacterKernelSummary>();
        for (const item of list) {
          if (item.entryStatus === "active") map.set(item.characterId, item);
        }
        setKernelsByCharacterId(map);
      })
      .catch(() => {
        if (generation === kernelGenerationRef.current) setKernelsByCharacterId(new Map());
      });
  }, [bookId]);
  useEffect(() => {
    loadKernels();
    return () => { kernelGenerationRef.current += 1; };
  }, [loadKernels]);
  useWritingProgressRefresh(bookId, loadKernels);

  // 叙事结构快照：实体索引里的首末出场章（结算写入的本章出场名单 + 事件章号），以及全书当前章。
  const { state: structureState, reload: reloadStructure } = useNarrativeStructure(bookId || undefined);
  useWritingProgressRefresh(bookId, reloadStructure);
  const structure = structureState.status === "ready" ? structureState.data : null;
  const entityByEntryId = useMemo(() => {
    const map = new Map<string, NarrativeEntityInfo>();
    for (const entity of structure?.entities ?? []) {
      if (entity.entryId) map.set(entity.entryId, entity);
    }
    return map;
  }, [structure]);
  // 「冷」要和当前章比：上层传了就用上层的，否则用叙事结构里已定稿的最大章号。
  const effectiveCurrentChapter = currentChapter ?? (structure && structure.currentChapter > 0 ? structure.currentChapter : undefined);

  // 递归提取全部实体叶子节点
  const allEntries = useMemo(() => {
    const list: WorkbenchResourceNode[] = [];
    const walk = (items: readonly WorkbenchResourceNode[]) => {
      for (const item of items) {
        if (item.kind === "jingwei-entry") {
          list.push(item);
        }
        if (item.children) walk(item.children);
      }
    };
    walk(nodes);
    return list;
  }, [nodes]);

  const factIndex = useMemo(() => {
    const byEntryId = new Map<string, EntityFactLite[]>();
    const bySubject = new Map<string, EntityFactLite[]>();
    for (const fact of facts) {
      // 上层传了当前章时，只看在该章仍然有效的事实
      if (currentChapter !== undefined && Number.isFinite(currentChapter)) {
        const from = typeof fact.validFromChapter === "number" ? fact.validFromChapter : 0;
        const until = typeof fact.validUntilChapter === "number" ? fact.validUntilChapter : null;
        if (from > currentChapter || (until !== null && until <= currentChapter)) continue;
      }
      if (fact.subjectEntryId) pushTo(byEntryId, fact.subjectEntryId, fact);
      const subject = fact.subject.trim();
      if (subject) pushTo(bySubject, subject, fact);
    }
    return { byEntryId, bySubject };
  }, [facts, currentChapter]);

  // 只把静态设定送进作品基础；动态推进条目归故事推进，不在这里混合展示。
  const { charactersList, worldList } = useMemo(() => {
    const chars: WorkbenchResourceNode[] = [];
    const world: WorkbenchResourceNode[] = [];

    for (const entry of allEntries) {
      const category = entryCategory(entry);
      if (workspaceForCategory(category) !== "settings") continue;
      if (category === "characters") chars.push(entry);
      else world.push(entry);
    }
    return { charactersList: chars, worldList: world };
  }, [allEntries]);

  const worldCategoryOptions = useMemo(
    () => CATEGORY_META.filter((meta) => worldList.some((entry) => entryCategory(entry) === meta.id)),
    [worldList],
  );

  // 搜索 + 世界录分类过滤
  const filteredList = useMemo(() => {
    const source = activeTab === "characters"
      ? charactersList
      : worldList.filter((entry) => worldCategoryFilter === "all" || entryCategory(entry) === worldCategoryFilter);
    if (!searchQuery.trim()) return source;
    const q = searchQuery.toLowerCase().trim();
    return source.filter((item) => {
      const titleMatch = item.title.toLowerCase().includes(q);
      const contentMatch = (item.content ?? "").toLowerCase().includes(q);
      const summaryMatch = String(item.metadata?.summary ?? "").toLowerCase().includes(q);
      return titleMatch || contentMatch || summaryMatch;
    });
  }, [activeTab, charactersList, worldList, worldCategoryFilter, searchQuery]);

  // 每张卡的卡面只在这里推导一次；同一 tab 里只要有一张卡有某一行，所有卡都留出这一行，保证等高。
  const cards = useMemo(() => {
    const isCharacter = activeTab === "characters";
    const list = filteredList.map((node) => {
      const entryId = typeof node.metadata?.entryId === "string" ? node.metadata.entryId : undefined;
      return {
        node,
        face: deriveLoreCardFace({
          node,
          isCharacter,
          facts: factsForNode(node, entryId, factIndex),
          kernel: isCharacter ? kernelsByCharacterId.get(node.title.trim()) : undefined,
          entity: entryId ? entityByEntryId.get(entryId) : undefined,
          currentChapter: effectiveCurrentChapter,
        }),
      };
    });
    return {
      list,
      showStatusRow: list.some((card) => card.face.status !== undefined),
      showProgressRow: list.some((card) => card.face.voice !== undefined || card.face.lastChapter !== undefined),
    };
  }, [activeTab, filteredList, factIndex, kernelsByCharacterId, entityByEntryId, effectiveCurrentChapter]);

  // 新建角色/条目
  const handleCreateEntry = async () => {
    if (!newCharName.trim() || creatingBusy) return;
    setCreatingBusy(true);
    setCreateError(null);
    try {
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newCharName.trim(),
          category: activeTab === "characters" ? "characters" : newCharCategory,
          contentMd: "",
        }),
      });
      setNewCharName("");
      setCreatingChar(false);
      onChanged?.();
    } catch (cause) {
      setCreateError(`创建失败：${cause instanceof Error ? cause.message : "未知错误"}`);
    } finally {
      setCreatingBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card text-xs" data-testid="characters-and-lore-panel">
      {/* 页头模具（设计板 sd-head）：这本书的骨头——人物、设定、待确认的草案 */}
      <SidebarPageHead
        icon={BookOpen}
        title="作品基础"
        purpose="这本书的骨头：人物、设定、待确认的草案"
        status={`角色 ${charactersList.length} · 设定 ${worldList.length} · 待确认 ${draftCount}`}
      />

      {/* 顶部工具条：导入、AI 注入预览、设定图谱；窄侧栏下整体换行，「新角色」始终靠右 */}
      <div className="shrink-0 flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5 bg-muted/20">
        <div className="contents">
          <Button
            size="xs"
            variant={showImport ? "secondary" : "outline"}
            onClick={() => { setShowPreview(false); setShowImport((v) => !v); }}
            className="h-6 text-xs gap-1"
          >
            <Upload className="size-3" />
            导入
          </Button>
          <Button
            size="xs"
            variant={showPreview ? "secondary" : "outline"}
            onClick={() => { setShowImport(false); setShowPreview((v) => !v); }}
            className="h-6 text-xs gap-1"
          >
            <Eye className="size-3" />
            AI注入预览
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => onOpen(createLoreTreesNode(bookId))}
            className="h-6 text-xs gap-1"
            title="在中央打开世界观树与人物关系网"
            data-testid="characters-lore-open-trees"
          >
            <Network className="size-3" />
            设定图谱
          </Button>
        </div>

        <Button
          size="xs"
          variant="ghost"
          className="ml-auto h-6 px-1.5 gap-1 text-primary hover:text-primary/90 font-medium"
          onClick={() => setCreatingChar(true)}
        >
          <UserPlus className="size-3" />
          {activeTab === "characters" ? "新角色" : "新设定"}
        </Button>
      </div>

      {/* 导入抽屉 */}
      {showImport && (
        <ImportSection
          bookId={bookId}
          onClose={() => setShowImport(false)}
          onImported={() => {
            setShowImport(false);
            onChanged?.();
          }}
        />
      )}

      {/* AI 注入预览 */}
      {showPreview && (
        <InjectionPreviewSection bookId={bookId} onClose={() => setShowPreview(false)} />
      )}

      {/* 快速新建卡片栏 */}
      {creatingChar && (
        <div className="border-b border-primary/30 bg-primary/5 p-2 space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-2xs font-semibold text-foreground">
              {activeTab === "characters" ? "新建角色卡" : "新建世界设定词条"}
            </span>
            <Button size="xs" variant="ghost" onClick={() => setCreatingChar(false)} className="h-4 w-4 p-0">
              <X className="size-3" />
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              value={newCharName}
              onChange={(e) => setNewCharName(e.target.value)}
              placeholder={activeTab === "characters" ? "输入角色名（如：韩立）" : "输入设定名称"}
              className="h-7 text-xs flex-1"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreateEntry(); }}
            />
            {activeTab === "world" && (
              <select
                className="h-7 text-xs border border-border rounded px-1.5 bg-background text-muted-foreground"
                value={newCharCategory}
                onChange={(e) => setNewCharCategory(e.target.value)}
              >
                {WORLD_CREATE_CATEGORY_META.map((meta) => (
                  <option key={meta.id} value={meta.id}>{meta.name}</option>
                ))}
              </select>
            )}
            <Button size="xs" onClick={() => void handleCreateEntry()} disabled={!newCharName.trim() || creatingBusy}>
              创建
            </Button>
          </div>
          {createError ? (
            <p role="alert" className="text-2xs text-destructive" data-testid="lore-create-error">{createError}</p>
          ) : null}
        </div>
      )}

      {/* 主视图 Tab：角色册 / 世界录 / 草案。窄侧栏下不折行，放不下时横向滚动 */}
      <div className="shrink-0 flex items-center gap-0.5 overflow-x-auto border-b border-border px-2 pt-1.5 bg-muted/10">
        {([
          { id: "characters", label: "角色册", count: charactersList.length, title: undefined },
          { id: "world", label: "世界录", count: worldList.length, title: undefined },
          { id: "draft", label: "草案", count: draftCount, title: "拆书抽出的角色、地点与伏笔候选；确认后才写入设定" },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            aria-pressed={activeTab === tab.id}
            title={tab.title}
            className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-t-md border-b-2 px-2 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              activeTab === tab.id
                ? "border-primary bg-background text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            <span className={`tabular-nums font-normal ${activeTab === tab.id ? "text-primary/80" : "text-muted-foreground"}`}>{tab.count}</span>
          </button>
        ))}
      </div>

      {activeTab === "world" && worldCategoryOptions.length > 0 && (
        <div className="shrink-0 flex gap-1 overflow-x-auto border-b border-border/60 px-2 py-1.5" data-testid="world-category-filter">
          <button
            type="button"
            onClick={() => setWorldCategoryFilter("all")}
            className={`shrink-0 rounded-full px-2 py-0.5 text-2xs transition-colors ${
              worldCategoryFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            全部 ({worldList.length})
          </button>
          {worldCategoryOptions.map((meta) => {
            const count = worldList.filter((entry) => entryCategory(entry) === meta.id).length;
            return (
              <button
                key={meta.id}
                type="button"
                onClick={() => setWorldCategoryFilter(meta.id)}
                className={`shrink-0 rounded-full px-2 py-0.5 text-2xs transition-colors ${
                  worldCategoryFilter === meta.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {meta.name} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* 搜索框 */}
      <div className="shrink-0 p-2 border-b border-border/60">
        <div className="flex items-center gap-1.5 rounded-md border border-input bg-background px-2 h-7">
          <Search className="size-3 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={activeTab === "characters" ? "搜索角色名、性格、口癖…" : "搜索世界设定、门派、体系…"}
            aria-label={activeTab === "characters" ? "搜索角色" : "搜索世界设定"}
            className="w-full bg-transparent text-2xs outline-none placeholder:text-muted-foreground/60"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery("")} className="text-muted-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* 卡片流展示区：草案 tab 时替换为拆书草案确认面板，不动卡片流逻辑 */}
      {activeTab === "draft" ? (
        <div className="flex-1 min-h-0">
          <DissectDraftPanel bookId={bookId} onChanged={loadDraftCount} />
        </div>
      ) : (
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {cards.list.length === 0 ? (
          // 空态模板（设计板 emptybox）：还没有 X。做 Y 即可 Z。+ 一个主按钮
          <div className="flex flex-col items-center justify-center gap-1.5 py-12 text-center space-y-1.5">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserRound className="size-5" strokeWidth={1.8} />
            </span>
            <p className="text-xs font-medium text-foreground">
              {searchQuery ? "没有找到匹配的条目" : activeTab === "characters" ? "还没有角色卡。" : "还没有世界设定。"}
            </p>
            <p className="text-2xs text-muted-foreground max-w-xs">
              {searchQuery
                ? "换个关键词，或清空搜索后重试。"
                : activeTab === "characters"
                  ? "点「新角色」即可建立第一张人物卡；也可以从「导入」批量建。"
                  : "点「新设定」即可添加第一条世界观与规则。"}
            </p>
            {!searchQuery && (
              <Button size="sm" className="mt-1" onClick={() => setCreatingChar(true)} data-testid="lore-empty-create">
                {activeTab === "characters" ? "新角色" : "新设定"}
              </Button>
            )}
          </div>
        ) : (
          // 侧栏拉宽时自动排成多列；每列等宽、每张卡等高
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-1.5" data-testid="lore-card-grid">
            {cards.list.map(({ node, face }) => (
              <li key={node.id} className="min-w-0">
                <LoreCard
                  node={node}
                  face={face}
                  isCharacter={activeTab === "characters"}
                  isSelected={selectedNodeId === node.id}
                  showStatusRow={cards.showStatusRow}
                  showProgressRow={cards.showProgressRow}
                  onClick={() => onOpen(node)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      )}
    </div>
  );
}

// ─── 卡面推导：只用结构化数据，缺哪项就不给哪项 ─────────────────────────────

/** 久未出场的阈值（章）：与改版前卡面「N 章未出场」的口径一致。 */
const COLD_CHAPTER_GAP = 15;
/** 状态值超过这个长度就不是「状态」而是一句话，留给详情页。 */
const STATUS_VALUE_MAX_CHARS = 24;
/** 角标只放短词（主角 / 反派 / 师尊）；写成一句话的定位不上卡面。 */
const BADGE_MAX_CHARS = 6;
const PREDICATE_LABEL_MAX_CHARS = 6;

/** 状态类谓词的先后：当前状态 → 位置 → 伤势 → 境界；数字越小越靠前。 */
const STATUS_PREDICATE_RANK = new Map<string, number>([
  ["状态", 0],
  ["当前状态", 0],
  ["处境", 0],
  ["位置", 1],
  ["所在", 1],
  ["所在地", 1],
  ["地点", 1],
  ["伤势", 2],
  ["伤情", 2],
  ["境界", 3],
]);
/** 结算归约出的状态 / 位置槽位；谓词不在上表时排在最后。 */
const STATUS_FACT_CATEGORIES = new Set(["character_state", "location"]);
/** 这些来源不代表角色在那一章出场（作者手填、设定导入）。 */
const NON_APPEARANCE_SOURCE_TYPES = new Set(["manual", "jingwei", "import", "runtime-state"]);

const BRACKET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["（", "）"], ["(", ")"], ["【", "】"], ["[", "]"], ["「", "」"], ["『", "』"], ["《", "》"], ["“", "”"], ["‘", "’"],
];

export interface LoreCardFace {
  /** 唯一角标：角色的「角色定位」，设定的分类名。 */
  readonly badge?: string;
  /** 一行状态。 */
  readonly status?: { readonly label: string; readonly value: string };
  /** 声线逐项状态，按字段定义顺序。 */
  readonly voice?: { readonly confirmed: number; readonly total: number; readonly statuses: readonly CharacterVoiceFieldStatus[] };
  readonly lastChapter?: number;
  /** 距当前章的未出场章数；只在达到阈值时给。 */
  readonly coldGap?: number;
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

function nodeAliases(node: WorkbenchResourceNode): string[] {
  return Array.isArray(node.metadata?.aliases)
    ? node.metadata.aliases.filter((alias): alias is string => typeof alias === "string" && alias.trim().length > 0)
    : [];
}

/** 实体身份链命中的事实，加上按标题与别名命中的事实（去重）。 */
function factsForNode(
  node: WorkbenchResourceNode,
  entryId: string | undefined,
  index: { readonly byEntryId: ReadonlyMap<string, readonly EntityFactLite[]>; readonly bySubject: ReadonlyMap<string, readonly EntityFactLite[]> },
): readonly EntityFactLite[] {
  const seen = new Set<EntityFactLite>();
  const add = (list: readonly EntityFactLite[] | undefined) => {
    for (const fact of list ?? []) seen.add(fact);
  };
  if (entryId) add(index.byEntryId.get(entryId));
  add(index.bySubject.get(node.title.trim()));
  for (const alias of nodeAliases(node)) add(index.bySubject.get(alias.trim()));
  return [...seen];
}

function bracketsBalanced(text: string): boolean {
  for (const [open, close] of BRACKET_PAIRS) {
    let depth = 0;
    for (const char of text) {
      if (char === open) depth += 1;
      else if (char === close) depth -= 1;
      if (depth < 0) return false;
    }
    if (depth !== 0) return false;
  }
  return true;
}

/**
 * 能独立读懂的一行短文本才上卡面；从正文截下来的半句（括号不配对、以标点或省略号起止、
 * 一格里塞了几句话）和超长文本返回 null，留给详情页。
 */
export function cardReadableText(raw: unknown, maxChars: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/gu, " ").trim().replace(/[。.]$/u, "");
  if (!text) return null;
  if (Array.from(text).length > maxChars) return null;
  if (/[。！？；!?;]/u.test(text)) return null;
  if (/^[，、。；：,.;:！？!?）)\]】」』》”’…—\-·]/u.test(text)) return null;
  if (/(?:[，、,：:；;（(【[「『《“‘—\-]|…|\.\.)$/u.test(text)) return null;
  if (!bracketsBalanced(text)) return null;
  return text;
}

function factChapter(fact: EntityFactLite): number {
  return fact.validFromChapter ?? fact.sourceChapter ?? 0;
}

function statusFromFacts(facts: readonly EntityFactLite[]): LoreCardFace["status"] {
  let best: { rank: number; chapter: number; label: string; value: string } | null = null;
  for (const fact of facts) {
    const predicate = fact.predicate.trim();
    const rank = STATUS_PREDICATE_RANK.get(predicate)
      ?? (fact.category && STATUS_FACT_CATEGORIES.has(fact.category) ? STATUS_PREDICATE_RANK.size : undefined);
    if (rank === undefined) continue;
    const value = cardReadableText(fact.object, STATUS_VALUE_MAX_CHARS);
    if (!value) continue;
    const label = cardReadableText(predicate, PREDICATE_LABEL_MAX_CHARS) ?? (fact.category === "location" ? "位置" : "状态");
    const chapter = factChapter(fact);
    if (!best || rank < best.rank || (rank === best.rank && chapter > best.chapter)) {
      best = { rank, chapter, label, value };
    }
  }
  return best ? { label: best.label, value: best.value } : undefined;
}

function kernelText(kernel: CharacterKernelSummary | undefined, key: string): string | null {
  const value = kernel?.fields[key];
  return typeof value === "string" ? cardReadableText(value, STATUS_VALUE_MAX_CHARS) : null;
}

/** 声线权威源是角色条目 fields.voice；没有声线记录或数据损坏时不显示进度。 */
function voiceProgress(fields: unknown): LoreCardFace["voice"] {
  if (!fields || typeof fields !== "object") return undefined;
  const raw = (fields as Record<string, unknown>).voice;
  if (raw === undefined || raw === null) return undefined;
  try {
    const voice = parseCharacterVoice(raw);
    const statuses = CHARACTER_VOICE_FIELD_KEYS.map((key) => voice.fields[key].status);
    return { confirmed: statuses.filter((status) => status === "confirmed").length, total: statuses.length, statuses };
  } catch {
    return undefined;
  }
}

function lastAppearance(entity: NarrativeEntityInfo | undefined, facts: readonly EntityFactLite[]): number | undefined {
  let last = entity?.lastChapter ?? 0;
  for (const fact of facts) {
    if (fact.sourceType && NON_APPEARANCE_SOURCE_TYPES.has(fact.sourceType)) continue;
    if (typeof fact.sourceChapter === "number" && fact.sourceChapter > last) last = fact.sourceChapter;
  }
  return last > 0 ? last : undefined;
}

export function deriveLoreCardFace(input: {
  readonly node: WorkbenchResourceNode;
  readonly isCharacter: boolean;
  readonly facts: readonly EntityFactLite[];
  readonly kernel?: CharacterKernelSummary;
  readonly entity?: NarrativeEntityInfo;
  readonly currentChapter?: number;
}): LoreCardFace {
  const { node, isCharacter, facts, kernel, entity, currentChapter } = input;
  const fields = node.metadata?.fields && typeof node.metadata.fields === "object"
    ? node.metadata.fields as Record<string, unknown>
    : undefined;

  const badge = isCharacter
    ? cardReadableText(fields?.roleType, BADGE_MAX_CHARS) ?? undefined
    : CATEGORY_META.find((meta) => meta.id === entryCategory(node))?.name;

  let status = statusFromFacts(facts);
  if (!status && isCharacter) {
    const summary = kernelText(kernel, "stateSummary");
    const mood = kernelText(kernel, "emotionalCenter");
    if (summary) status = { label: "状态", value: summary };
    else if (mood) status = { label: "心境", value: mood };
  }
  if (!status && !isCharacter) {
    // 设定条目自己的状态字段；只认中文短语，内部状态码（confirmed 之类）不上界面
    const raw = cardReadableText(fields?.state, STATUS_VALUE_MAX_CHARS) ?? cardReadableText(fields?.status, STATUS_VALUE_MAX_CHARS);
    if (raw && /\p{Script=Han}/u.test(raw)) status = { label: "状态", value: raw };
  }

  const lastChapter = lastAppearance(entity, facts);
  const gap = isCharacter && lastChapter !== undefined && currentChapter !== undefined ? currentChapter - lastChapter : undefined;

  return {
    ...(badge ? { badge } : {}),
    ...(status ? { status } : {}),
    ...(isCharacter ? { voice: voiceProgress(fields) } : {}),
    ...(lastChapter !== undefined ? { lastChapter } : {}),
    ...(gap !== undefined && gap >= COLD_CHAPTER_GAP ? { coldGap: gap } : {}),
  };
}

const VOICE_STATUS_LABEL: Record<CharacterVoiceFieldStatus, string> = {
  confirmed: "已确认",
  "needs-review": "待审",
  missing: "待补充",
};

function voiceTitle(voice: NonNullable<LoreCardFace["voice"]>): string {
  const count = (status: CharacterVoiceFieldStatus) => voice.statuses.filter((item) => item === status).length;
  return `声线 ${voice.total} 项：${VOICE_STATUS_LABEL.confirmed} ${count("confirmed")}，${VOICE_STATUS_LABEL["needs-review"]} ${count("needs-review")}，${VOICE_STATUS_LABEL.missing} ${count("missing")}`;
}

/** 作品基础的单张卡：名称 / 唯一角标 / 一行状态 / 关键进度，行高固定。 */
function LoreCard({
  node,
  face,
  isCharacter,
  isSelected,
  showStatusRow,
  showProgressRow,
  onClick,
}: {
  node: WorkbenchResourceNode;
  face: LoreCardFace;
  /** 角色说「出场」，地点、势力、道具说「出现」。 */
  isCharacter: boolean;
  isSelected: boolean;
  showStatusRow: boolean;
  showProgressRow: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isSelected ? "true" : undefined}
      data-testid="lore-card"
      className={`flex w-full min-w-0 flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        isSelected
          ? "border-primary/60 bg-primary/5"
          : "border-border/70 bg-card hover:border-border hover:bg-muted/40"
      }`}
    >
      <span className="flex h-5 min-w-0 items-center gap-1.5">
        <span className={`min-w-0 flex-1 truncate text-xs font-semibold ${isSelected ? "text-primary" : "text-foreground"}`} title={node.title}>
          {node.title}
        </span>
        {face.badge && (
          <span className="shrink-0 rounded-sm bg-secondary px-1 text-2xs leading-4 text-secondary-foreground" data-testid="lore-card-badge">
            {face.badge}
          </span>
        )}
      </span>

      {showStatusRow && (
        <span className="flex h-4 min-w-0 items-center gap-1 text-2xs" data-testid={face.status ? "lore-card-status" : undefined}>
          {face.status && (
            <>
              <span className="shrink-0 text-muted-foreground">{face.status.label}</span>
              <span className="min-w-0 truncate text-foreground/85" title={`${face.status.label}：${face.status.value}`}>{face.status.value}</span>
            </>
          )}
        </span>
      )}

      {showProgressRow && (
        <span className="flex h-4 min-w-0 items-center justify-between gap-2 text-2xs text-muted-foreground">
          {face.voice ? (
            <span className="min-w-0 truncate tabular-nums" title={voiceTitle(face.voice)} data-testid="lore-card-voice">
              声线 <span className={face.voice.confirmed > 0 ? "text-foreground/85" : undefined}>{face.voice.confirmed}/{face.voice.total}</span>
            </span>
          ) : <span />}
          {face.lastChapter !== undefined && (
            <span className="flex shrink-0 items-center gap-1 tabular-nums" data-testid="lore-card-last-chapter">
              {face.coldGap !== undefined && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-sm bg-destructive/10 px-1 leading-4 text-destructive"
                  title={`已经 ${face.coldGap} 章没有出场`}
                  data-testid="lore-card-cold"
                >
                  <Snowflake className="size-2.5" aria-hidden="true" />冷<span className="sr-only">，已经 {face.coldGap} 章没有出场</span>
                </span>
              )}
              {isCharacter ? "最近出场" : "最近出现"} 第 {face.lastChapter} 章
            </span>
          )}
        </span>
      )}
    </button>
  );
}

function ImportSection({ bookId, onClose, onImported }: { bookId: string; onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("characters");
  const [importing, setImporting] = useState(false);
  // 结果分成功/失败两种，失败用 destructive 色，不能一律成功色误导。
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const handleImport = async () => {
    if (!text.trim() || importing) return;
    setImporting(true);
    setResult(null);

    const trimmed = text.trim();
    const entries: Array<{ title: string; contentMd: string; category: string }> = [];

    // 智能识别 1：酒馆角色卡 JSON (Character Card V2)
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const data = (parsed.data && typeof parsed.data === "object" ? parsed.data : parsed) as Record<string, unknown>;
        const charName = typeof data.name === "string" ? data.name.trim() : "";
        if (charName) {
          const personality = typeof data.personality === "string" ? data.personality.trim() : "";
          const desc = typeof data.description === "string" ? data.description.trim() : "";
          const scenario = typeof data.scenario === "string" ? data.scenario.trim() : "";
          const mesExample = typeof data.mes_example === "string" ? data.mes_example.trim() : "";
          const firstMes = typeof data.first_mes === "string" ? data.first_mes.trim() : "";

          const sections = [
            desc ? `## 外貌与身份\n${desc}` : "",
            personality ? `## 性格与行事\n${personality}` : "",
            scenario ? `## 背景处境\n${scenario}` : "",
            firstMes ? `## 首发台词/开场\n${firstMes}` : "",
            mesExample ? `## 说话口癖与对话样例\n${mesExample.replace(/\{\{user\}\}/gi, "作者").replace(/\{\{char\}\}/gi, charName)}` : "",
          ].filter(Boolean);

          entries.push({
            title: charName,
            contentMd: sections.join("\n\n"),
            category: "characters",
          });
        }
      } catch {
        // 回退到普通文本解析
      }
    }

    // 智能识别 2：标准 Markdown 批量拆分
    if (entries.length === 0) {
      const sections = text.split(/^## /m).filter(Boolean);
      for (const section of sections) {
        const lines = section.split("\n");
        const title = lines[0]?.trim() ?? "未命名";
        const contentMd = lines.slice(1).join("\n").trim();
        if (contentMd) entries.push({ title, contentMd, category });
      }
      if (entries.length === 0) entries.push({ title: "导入设定", contentMd: text.trim(), category });
    }

    try {
      const data = await fetchJson<{ imported: number }>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries }),
        },
      );
      setResult({ kind: "success", message: `成功导入 ${data.imported} 条设定条目` });
      setTimeout(onImported, 600);
    } catch {
      setResult({ kind: "error", message: "导入失败，请检查格式" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b border-border p-2.5 bg-muted/30">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">导入设定 / 酒馆角色卡</span>
        <Button size="xs" variant="ghost" onClick={onClose} className="h-5 w-5 p-0"><X className="size-3" /></Button>
      </div>
      <p className="text-2xs text-muted-foreground leading-relaxed">
        支持粘贴 Markdown（按 ## 拆分）或酒馆角色卡 JSON（自动转换为多维人物档案）。
      </p>
      <select
        className="h-7 text-xs border border-border rounded px-2 bg-background"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        <option value="characters">角色</option>
        <option value="factions">势力 / 门派</option>
        <option value="world-model">世界模型</option>
        <option value="power-system">力量体系</option>
        <option value="rules">法则规则</option>
        <option value="locations">地理场景</option>
        <option value="props">重要物品</option>
        <option value="timeline">前史时间线</option>
      </select>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-24 font-mono text-xs"
        placeholder={"粘贴 Markdown 文本，或酒馆角色卡 JSON（{\"name\": \"...\", \"personality\": \"...\"}）..."}
      />
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-2xs text-muted-foreground">
          {text.trim().startsWith("{") ? "检测到 JSON 格式，将智能解析角色卡" : "Markdown 格式"}
        </span>
        <div className="flex items-center gap-1.5">
          <Button size="xs" variant="ghost" onClick={onClose}>取消</Button>
          <Button size="xs" onClick={handleImport} disabled={importing || !text.trim()}>
            {importing ? "导入中…" : "开始导入"}
          </Button>
        </div>
      </div>
      {result && (
        <p
          className={`text-2xs font-medium ${result.kind === "error" ? "text-destructive" : "text-emerald-600"}`}
          data-testid={`lore-import-result-${result.kind}`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}

function InjectionPreviewSection({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const [chapterNumber, setChapterNumber] = useState(1);
  const [content, setContent] = useState<string | null>(null);

  const fetchPreview = useCallback(async (chapterNum: number) => {
    setContent(null);
    try {
      const data = await fetchJson<{ preview?: string; context?: string }>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/injection-preview?chapterNumber=${chapterNum}`,
      );
      setContent(data.preview ?? data.context ?? JSON.stringify(data, null, 2));
    } catch {
      setContent("加载预览失败");
    }
  }, [bookId]);

  return (
    <div className="border-b border-border p-2.5 bg-muted/30">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">AI 设定注入预览</span>
        <Button size="xs" variant="ghost" onClick={onClose} className="h-5 w-5 p-0"><X className="size-3" /></Button>
      </div>
      <div className="flex items-center gap-1 mt-1.5">
        <span className="text-2xs text-muted-foreground">第</span>
        <input
          type="number"
          min={1}
          value={chapterNumber}
          onChange={(e) => {
            const num = Math.max(1, parseInt(e.target.value, 10) || 1);
            setChapterNumber(num);
            void fetchPreview(num);
          }}
          className="w-12 rounded border border-border bg-background px-1.5 text-center text-xs font-mono outline-none"
        />
        <span className="text-2xs text-muted-foreground">章写作视角</span>
        {content === null && (
          <Button size="xs" variant="outline" onClick={() => void fetchPreview(chapterNumber)} className="h-6 text-2xs ml-1">
            加载
          </Button>
        )}
      </div>
      {content !== null && (
        <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-2xs font-mono text-muted-foreground bg-muted/50 p-2 rounded">
          {content}
        </pre>
      )}
    </div>
  );
}
