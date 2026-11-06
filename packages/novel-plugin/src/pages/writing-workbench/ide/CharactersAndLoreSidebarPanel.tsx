/**
 * 作品基础侧栏面板：角色册 / 人物表 / 设定条目 / 草案四个 tab。
 *
 * - 角色册：角色卡片流；
 * - 人物表：全部角色一张表（当前境界 / 位置 / 立场 / 最近出场 / 存亡），数据取已载入的章后事实与角色内核；
 * - 设定条目：按分类分页（世界 / 势力 / 地点 / 道具 / 能力体系 / 本书规则 / 故事基线 / 参考资料），
 *   分类是否属于这里只看 CATEGORY_META.defaultLayer（见 lore-workspace-split）；随剧情变化的分类在「故事推进」。
 *
 * 卡面纪律（docs/design/novelfork-frontend-final-board.html 屏 4）：每张卡只放
 * 1. 名称；2. 唯一一个角标（角色取「角色定位」，设定取分类）；3. 一行状态；4. 关键进度
 * （角色：声线确认数、最近出场章、久未出场标「冷」）。
 * 只用已有的结构化数据，缺哪项就不显示哪项；正文碎句、别名、长标签、条目正文一律不上卡面，点开详情才看。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
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
import { SidebarTabs, sidebarTabPanelProps } from "./SidebarTabs";
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
import {
  AFFILIATION_SLOT,
  DEPARTURE_LEFT,
  DEPARTURE_SLOT,
  LIFE_DEAD,
  LIFE_SLOT,
  LOCATION_SLOT,
  REALM_SLOT,
  canonicalizeStatePredicate,
} from "../../../engine/narrative-memory/state-predicate";
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

type MainTab = "characters" | "cast" | "settings" | "draft";
type SettingsCategoryFilter = JingweiCategory | "all";

const WORLD_CREATE_CATEGORY_META = CATEGORY_META.filter(
  (meta) => workspaceForCategory(meta.id) === "settings" && meta.allowCanon && meta.id !== "characters",
);

/**
 * 「设定条目」的分类页签：顺序按作者查设定的习惯排，侧栏用短名。
 * 哪些分类属于作品基础仍只由 CATEGORY_META.defaultLayer 决定；这里只管顺序和短名，
 * 不在名单里的设定分类（如未分类）有条目时排在最后、用 CATEGORY_META 的名字。
 */
const SETTINGS_CATEGORY_TABS: ReadonlyArray<{ readonly id: JingweiCategory; readonly label: string }> = [
  { id: "world-model", label: "世界" },
  { id: "factions", label: "势力" },
  { id: "locations", label: "地点" },
  { id: "props", label: "道具" },
  { id: "power-system", label: "能力体系" },
  { id: "rules", label: "本书规则" },
  { id: "premise", label: "故事基线" },
  { id: "reference", label: "参考资料" },
];

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
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategoryFilter>("all");
  const [castSortDirection, setCastSortDirection] = useState<"desc" | "asc">("desc");
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

  // 设定条目的分类页签：固定分类始终在（空的也能点进去新建），名单外的设定分类有条目时追加在后面。
  const settingsCategoryTabs = useMemo(() => {
    const counts = new Map<JingweiCategory, number>();
    for (const entry of worldList) {
      const category = entryCategory(entry);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    const fixed = SETTINGS_CATEGORY_TABS.map((tab) => ({ id: tab.id, label: tab.label, count: counts.get(tab.id) ?? 0 }));
    const fixedIds = new Set<JingweiCategory>(SETTINGS_CATEGORY_TABS.map((tab) => tab.id));
    const extra = CATEGORY_META
      .filter((meta) => !fixedIds.has(meta.id) && (counts.get(meta.id) ?? 0) > 0)
      .map((meta) => ({ id: meta.id, label: meta.name, count: counts.get(meta.id) ?? 0 }));
    return [{ id: "all" as const, label: "全部", count: worldList.length }, ...fixed, ...extra];
  }, [worldList]);
  const settingsCategoryLabel = settingsCategoryTabs.find((tab) => tab.id === settingsCategory)?.label;

  const selectSettingsCategory = (category: SettingsCategoryFilter) => {
    setSettingsCategory(category);
    // 新建设定时默认落在正在看的分类
    if (category !== "all" && WORLD_CREATE_CATEGORY_META.some((meta) => meta.id === category)) setNewCharCategory(category);
  };

  const matchesSearch = useCallback((item: WorkbenchResourceNode) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const titleMatch = item.title.toLowerCase().includes(q);
    const contentMatch = (item.content ?? "").toLowerCase().includes(q);
    const summaryMatch = String(item.metadata?.summary ?? "").toLowerCase().includes(q);
    return titleMatch || contentMatch || summaryMatch;
  }, [searchQuery]);

  // 搜索 + 设定分类过滤
  const filteredList = useMemo(() => {
    const source = activeTab === "characters" || activeTab === "cast"
      ? charactersList
      : worldList.filter((entry) => settingsCategory === "all" || entryCategory(entry) === settingsCategory);
    return source.filter(matchesSearch);
  }, [activeTab, charactersList, worldList, settingsCategory, matchesSearch]);

  // 人物表：每个角色一行，数据与卡面同源（章后事实 + 实体索引），按最近出场排序。
  const castRows = useMemo(() => {
    if (activeTab !== "cast") return [];
    const rows = filteredList.map((node) => {
      const entryId = typeof node.metadata?.entryId === "string" ? node.metadata.entryId : undefined;
      return {
        node,
        row: deriveCastRow({
          facts: factsForNode(node, entryId, factIndex),
          ...(entryId && entityByEntryId.get(entryId) ? { entity: entityByEntryId.get(entryId) } : {}),
        }),
      };
    });
    return sortCastRows(rows, castSortDirection);
  }, [activeTab, filteredList, factIndex, entityByEntryId, castSortDirection]);

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

  // 角色册与人物表新建的都是角色；设定条目与草案页新建设定。
  const isCharacterTab = activeTab === "characters" || activeTab === "cast";

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
          category: isCharacterTab ? "characters" : newCharCategory,
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
          {isCharacterTab ? "新角色" : "新设定"}
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
              {isCharacterTab ? "新建角色卡" : "新建设定条目"}
            </span>
            <Button size="xs" variant="ghost" aria-label="取消新建" onClick={() => setCreatingChar(false)} className="h-4 w-4 p-0">
              <X className="size-3" />
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              value={newCharName}
              onChange={(e) => setNewCharName(e.target.value)}
              placeholder={isCharacterTab ? "输入角色名（如：韩立）" : "输入设定名称"}
              className="h-7 text-xs flex-1"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreateEntry(); }}
            />
            {!isCharacterTab && (
              <select
                aria-label="设定分类"
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
            <p role="alert" className="text-xs text-destructive" data-testid="lore-create-error">{createError}</p>
          ) : null}
        </div>
      )}

      {/* 主视图 Tab：角色册 / 人物表 / 设定条目 / 草案。窄侧栏下换行，不藏页签 */}
      <SidebarTabs<MainTab>
        ariaLabel="作品基础视图"
        idPrefix="lore-main"
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: "characters", label: "角色册", count: charactersList.length },
          { id: "cast", label: "人物表", title: "全部角色一张表：境界、位置、立场、最近出场、存亡" },
          { id: "settings", label: "设定条目", count: worldList.length },
          { id: "draft", label: "草案", count: draftCount, title: "拆书找到的候选条目，确认后才存入设定" },
        ]}
      />

      {/* 页签对应的整块内容（分类子页签 + 搜索 + 列表）是一个 tabpanel */}
      <div className="flex min-h-0 flex-1 flex-col" {...sidebarTabPanelProps("lore-main", activeTab)}>
      {activeTab === "settings" && (
        <SidebarTabs<SettingsCategoryFilter>
          ariaLabel="设定分类"
          idPrefix="lore-settings"
          size="sm"
          testId="settings-category-tabs"
          active={settingsCategory}
          onChange={selectSettingsCategory}
          tabs={settingsCategoryTabs}
        />
      )}

      {/* 搜索框 */}
      {activeTab !== "draft" && (
      <div className="shrink-0 p-2 border-b border-border/60">
        <div className="flex items-center gap-1.5 rounded-md border border-input bg-background px-2 h-7">
          <Search className="size-3 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isCharacterTab ? "搜索角色名、性格、口癖…" : "搜索设定、门派、体系…"}
            aria-label={isCharacterTab ? "搜索角色" : "搜索设定条目"}
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery("")} aria-label="清空搜索" className="text-muted-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>
      )}

      {/* 卡片流展示区：草案 tab 时替换为拆书草案确认面板；人物表 tab 时换成表格 */}
      {activeTab === "draft" ? (
        <div className="flex-1 min-h-0">
          <DissectDraftPanel bookId={bookId} onChanged={loadDraftCount} />
        </div>
      ) : activeTab === "cast" ? (
        <div className="flex-1 min-h-0 overflow-auto p-2">
          {castRows.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-xs font-medium text-foreground">{searchQuery ? "没有找到匹配的角色" : "还没有角色卡。"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {searchQuery ? "换个关键词，或清空搜索后重试。" : "点「新角色」建立人物卡；写完一章并结算后，这里会填上境界、位置和出场。"}
              </p>
            </div>
          ) : (
            <CastTable
              rows={castRows}
              selectedNodeId={selectedNodeId}
              sortDirection={castSortDirection}
              onToggleSort={() => setCastSortDirection((value) => (value === "desc" ? "asc" : "desc"))}
              onOpen={onOpen}
            />
          )}
        </div>
      ) : (
      <div
        className="flex-1 min-h-0 overflow-y-auto p-2"
        {...(activeTab === "settings" ? sidebarTabPanelProps("lore-settings", settingsCategory) : {})}
      >
        {cards.list.length === 0 ? (
          // 空态模板（设计板 emptybox）：还没有 X。做 Y 即可 Z。+ 一个主按钮
          <div className="flex flex-col items-center justify-center gap-1.5 py-12 text-center space-y-1.5">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserRound className="size-5" strokeWidth={1.8} />
            </span>
            <p className="text-xs font-medium text-foreground">
              {searchQuery
                ? "没有找到匹配的条目"
                : activeTab === "characters"
                  ? "还没有角色卡。"
                  : settingsCategory === "all" ? "还没有设定条目。" : `还没有「${settingsCategoryLabel ?? ""}」条目。`}
            </p>
            <p className="text-xs text-muted-foreground max-w-xs">
              {searchQuery
                ? "换个关键词，或清空搜索后重试。"
                : activeTab === "characters"
                  ? "点「新角色」即可建立第一张人物卡；也可以从「导入」批量建。"
                  : "点「新设定」即可添加第一条；也可以从「导入」批量建。"}
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
    </div>
  );
}

// ─── 人物表：每个角色一行，列取受控状态槽（境界 / 所在 / 所属 / 生死 / 去向） ─────────────

export interface CastRow {
  readonly realm?: string;
  readonly location?: string;
  readonly stance?: string;
  readonly lastChapter?: number;
  /** 存亡：生死槽的归一取值（存活 / 死亡 / 复活），或去向槽的「离场」。 */
  readonly life?: string;
}

const CAST_CELL_MAX_CHARS = 16;

/**
 * 人物表一行：每列取同槽最新一章的事实；谓词经结算时同一套受控槽归一（state-predicate），
 * 所以「修为」「当前境界」都落在「境界」列。认不出的谓词不进表，留给角色卡详情。
 */
export function deriveCastRow(input: {
  readonly facts: readonly EntityFactLite[];
  readonly entity?: NarrativeEntityInfo;
}): CastRow {
  const best = new Map<string, { chapter: number; value: string }>();
  const consider = (slot: string, value: string, chapter: number) => {
    const previous = best.get(slot);
    if (!previous || chapter >= previous.chapter) best.set(slot, { chapter, value });
  };
  for (const fact of input.facts) {
    const canonical = canonicalizeStatePredicate({
      // 没写类别或旧的通用 state 类按人物状态归一；位置类谓词在两类下都能命中
      category: !fact.category || fact.category === "state" ? "character_state" : fact.category,
      predicate: fact.predicate,
      object: fact.object,
    });
    if (!canonical) continue;
    const value = cardReadableText(canonical.value, CAST_CELL_MAX_CHARS);
    if (!value) continue;
    consider(canonical.slot, value, factChapter(fact));
  }
  const life = best.get(LIFE_SLOT);
  const departure = best.get(DEPARTURE_SLOT);
  // 死亡优先于离场；离场晚于最近一次生死记录时显示「离场」
  const lifeValue = life?.value === LIFE_DEAD
    ? LIFE_DEAD
    : departure?.value === DEPARTURE_LEFT && (!life || departure.chapter >= life.chapter)
      ? DEPARTURE_LEFT
      : life?.value;
  const lastChapter = lastAppearance(input.entity, input.facts);
  return {
    ...(best.get(REALM_SLOT) ? { realm: best.get(REALM_SLOT)!.value } : {}),
    ...(best.get(LOCATION_SLOT) ? { location: best.get(LOCATION_SLOT)!.value } : {}),
    ...(best.get(AFFILIATION_SLOT) ? { stance: best.get(AFFILIATION_SLOT)!.value } : {}),
    ...(lastChapter !== undefined ? { lastChapter } : {}),
    ...(lifeValue ? { life: lifeValue } : {}),
  };
}

/** 按最近出场排序；没有出场记录的始终排在最后，同章按名字。 */
export function sortCastRows<T extends { readonly node: WorkbenchResourceNode; readonly row: CastRow }>(
  rows: readonly T[],
  direction: "desc" | "asc",
): T[] {
  return [...rows].sort((left, right) => {
    const a = left.row.lastChapter;
    const b = right.row.lastChapter;
    if (a === undefined && b !== undefined) return 1;
    if (b === undefined && a !== undefined) return -1;
    if (a !== undefined && b !== undefined && a !== b) return direction === "desc" ? b - a : a - b;
    return left.node.title.localeCompare(right.node.title, "zh-CN");
  });
}

function CastTable({
  rows,
  selectedNodeId,
  sortDirection,
  onToggleSort,
  onOpen,
}: {
  rows: ReadonlyArray<{ readonly node: WorkbenchResourceNode; readonly row: CastRow }>;
  selectedNodeId: string | null;
  sortDirection: "desc" | "asc";
  onToggleSort: () => void;
  onOpen: (node: WorkbenchResourceNode) => void;
}) {
  const cell = (value: string | undefined) => value
    ? <span className="block max-w-[8rem] truncate" title={value}>{value}</span>
    : <span className="text-muted-foreground/60" aria-label="未记录">—</span>;
  return (
    <table className="w-full min-w-[22rem] border-collapse text-2xs" data-testid="cast-table">
      <caption className="sr-only">人物表：每个角色的当前境界、位置、立场、最近出场章与存亡，点角色名打开人物卡</caption>
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th scope="col" className="py-1 pr-2 font-medium">角色</th>
          <th scope="col" className="py-1 pr-2 font-medium">当前境界</th>
          <th scope="col" className="py-1 pr-2 font-medium">位置</th>
          <th scope="col" className="py-1 pr-2 font-medium">立场</th>
          <th scope="col" className="py-1 pr-2 font-medium" aria-sort={sortDirection === "desc" ? "descending" : "ascending"}>
            <button
              type="button"
              onClick={onToggleSort}
              className="inline-flex items-center gap-0.5 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={sortDirection === "desc" ? "现在按最近出场从近到远，点一下反过来" : "现在按最近出场从远到近，点一下反过来"}
              data-testid="cast-sort-last-chapter"
            >
              最近出场
              {sortDirection === "desc" ? <ArrowDown className="size-3" aria-hidden="true" /> : <ArrowUp className="size-3" aria-hidden="true" />}
            </button>
          </th>
          <th scope="col" className="py-1 font-medium">存亡</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ node, row }) => {
          const selected = selectedNodeId === node.id;
          return (
            <tr key={node.id} className={`border-b border-border/50 ${selected ? "bg-primary/5" : "hover:bg-muted/40"}`} data-testid="cast-row">
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                <button
                  type="button"
                  onClick={() => onOpen(node)}
                  aria-current={selected ? "true" : undefined}
                  className={`max-w-[7rem] truncate rounded text-left font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "text-primary" : "text-foreground"}`}
                  title={`打开「${node.title}」的人物卡`}
                >
                  {node.title}
                </button>
              </th>
              <td className="py-1 pr-2">{cell(row.realm)}</td>
              <td className="py-1 pr-2">{cell(row.location)}</td>
              <td className="py-1 pr-2">{cell(row.stance)}</td>
              <td className="py-1 pr-2 tabular-nums">{row.lastChapter !== undefined ? `第 ${row.lastChapter} 章` : cell(undefined)}</td>
              <td className={`py-1 ${row.life === LIFE_DEAD ? "text-destructive" : ""}`}>{cell(row.life)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
        <Button size="xs" variant="ghost" aria-label="关闭" onClick={onClose} className="h-5 w-5 p-0"><X className="size-3" /></Button>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
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
        <option value="timeline">前史时间线（在「故事推进 › 时间线」查看）</option>
      </select>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-24 font-mono text-xs"
        placeholder={"粘贴 Markdown 文本，或酒馆角色卡 JSON（{\"name\": \"...\", \"personality\": \"...\"}）..."}
      />
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-2xs text-muted-foreground">
          {text.trim().startsWith("{") ? "识别为角色卡格式" : "Markdown 格式"}
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
          className={`text-xs font-medium ${result.kind === "error" ? "text-destructive" : "text-success"}`}
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
        <Button size="xs" variant="ghost" aria-label="关闭" onClick={onClose} className="h-5 w-5 p-0"><X className="size-3" /></Button>
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
