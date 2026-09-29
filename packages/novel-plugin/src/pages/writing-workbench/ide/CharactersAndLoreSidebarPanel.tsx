/**
 * 角色与设定（Characters & Lore）侧栏面板 —— 酒馆（SillyTavern）风格卡片流。
 *
 * 彻底颠覆传统的文件夹树结构：
 * 1. 【角色册 (Characters)】：以角色为第一公民的卡片流，直观展示图标徽章、姓名、门派/阵营、当前最新时态（位置/伤势）；
 * 2. 【世界录 (World Lore)】：门派势力、力量体系、法则规则、地理场景等设定词条卡；
 * 3. 顶部支持实时搜索、分类过滤与「新建角色 / 导入酒馆预设与角色卡」。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Eye,
  HeartHandshake,
  MapPin,
  Network,
  Plus,
  Search,
  Shield,
  Sparkles,
  Upload,
  UserPlus,
  UserRound,
  Users,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/hooks/use-api";
import { fetchCharacterKernels, type CharacterKernelSummary } from "../character-kernel-client";
import { useWritingProgressRefresh } from "../use-writing-progress-refresh";
import { CATEGORY_META, normalizeCategory, type JingweiCategory } from "../../../engine/jingwei/unified-categories";
import { workspaceForCategory } from "../lore-workspace-split";
import { type ResourceTreeAction } from "../WorkbenchResourceTree";
import { createLoreTreesNode, type WorkbenchResourceNode } from "../useWorkbenchResources";

export interface EntityFactLite {
  id?: string;
  subject: string;
  predicate: string;
  object: string;
  category?: string;
  evidenceText?: string;
  sourceId?: string;
  /** 事实来源章节（narrative-memory facts API 返回），用于「最后出场」推算。 */
  sourceChapter?: number;
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

type MainTab = "characters" | "world";
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

  // 角色当前内核（每个角色的当前动机/情绪一行摘要），来自结算后写入的 character_kernel。
  // 这个角色册面板就是作者查「这个角色现在是谁」的地方——顺带把内核贴上来，不必再翻叙事记忆面板。
  const [kernelsByCharacterId, setKernelsByCharacterId] = useState<ReadonlyMap<string, CharacterKernelSummary>>(new Map());
  const kernelGenerationRef = useRef(0);
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

  const showKernel = useCallback((characterId: string): CharacterKernelSummary | undefined => {
    return kernelsByCharacterId.get(characterId);
  }, [kernelsByCharacterId]);

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

  const factsBySubject = useMemo(() => {
    const map = new Map<string, EntityFactLite[]>();
    for (const fact of facts) {
      const subject = fact.subject.trim();
      if (!subject) continue;
      // 时态有效性过滤（如果传入了当前章节）
      if (currentChapter !== undefined && Number.isFinite(currentChapter)) {
        // 如果 fact 携带了时态信息，则过滤不在当前章节区间的事实
        // @ts-expect-error validFromChapter/validUntilChapter may exist on fact
        const from = typeof fact.validFromChapter === "number" ? fact.validFromChapter : 0;
        // @ts-expect-error validFromChapter/validUntilChapter may exist on fact
        const until = typeof fact.validUntilChapter === "number" ? fact.validUntilChapter : null;
        if (from > currentChapter || (until !== null && until <= currentChapter)) {
          continue;
        }
      }
      const bucket = map.get(subject);
      if (bucket) bucket.push(fact);
      else map.set(subject, [fact]);
    }
    return map;
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

  // 新建角色/条目
  const handleCreateEntry = async () => {
    if (!newCharName.trim() || creatingBusy) return;
    setCreatingBusy(true);
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
    } catch {
      // ignore
    } finally {
      setCreatingBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card text-xs" data-testid="characters-and-lore-panel">
      {/* 顶部轻量工具条：导入设定 + AI 注入预览 */}
      <div className="shrink-0 flex items-center justify-between border-b border-border px-2 py-1.5 bg-muted/20">
        <div className="flex items-center gap-1">
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
          className="h-6 px-1.5 gap-1 text-primary hover:text-primary/90 font-medium"
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
        </div>
      )}

      {/* 主视图 Tab：【角色册】 vs 【世界录】 */}
      <div className="shrink-0 flex items-center border-b border-border px-2 pt-1.5 gap-1 bg-muted/10">
        <button
          type="button"
          onClick={() => setActiveTab("characters")}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-t-md text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "characters"
              ? "border-primary text-primary bg-background shadow-xs"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="size-3.5" />
          <span>角色册 ({charactersList.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("world")}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-t-md text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "world"
              ? "border-primary text-primary bg-background shadow-xs"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <BookOpen className="size-3.5" />
          <span>世界录 ({worldList.length})</span>
        </button>
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
            placeholder={activeTab === "characters" ? "搜索角色名、性格、口癖..." : "搜索世界设定、门派、体系..."}
            className="w-full bg-transparent text-2xs outline-none placeholder:text-muted-foreground/60"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery("")} className="text-muted-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* 卡片流展示区 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {filteredList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground space-y-1.5">
            <UserRound className="size-8 opacity-25" />
            <p className="text-xs font-medium">
              {searchQuery ? "没有找到匹配的条目" : activeTab === "characters" ? "暂无角色卡" : "暂无世界设定"}
            </p>
            <p className="text-2xs text-muted-foreground/80 max-w-xs">
              {activeTab === "characters" ? "点击右上角「新角色」或「导入」快速建立人物册" : "点击右上角「新设定」添加世界观与规则"}
            </p>
          </div>
        ) : (
          filteredList.map((entry) => (
            <CharacterOrLoreCard
              key={entry.id}
              node={entry}
              activeTab={activeTab}
              facts={factsForNode(entry, factsBySubject)}
              isSelected={selectedNodeId === entry.id}
              kernel={activeTab === "characters" ? showKernel(entry.title) : undefined}
              currentChapter={currentChapter}
              onClick={() => onOpen(entry)}
            />
          ))
        )}
      </div>
    </div>
  );
}

const TEMPORAL_PREDICATE_PRIORITY = new Map([
  ["位置", 0],
  ["所在", 0],
  ["所在地", 0],
  ["地点", 0],
  ["伤势", 0],
  ["伤情", 0],
  ["境界", 0],
  ["状态", 0],
  ["当前状态", 0],
  ["处境", 0],
]);

function factsForNode(
  node: WorkbenchResourceNode,
  factsBySubject: ReadonlyMap<string, readonly EntityFactLite[]>,
): readonly EntityFactLite[] {
  const title = node.title.trim();
  const titleFacts = factsBySubject.get(title);
  if (titleFacts && titleFacts.length > 0) return selectTemporalFacts(titleFacts);

  const aliases = Array.isArray(node.metadata?.aliases)
    ? node.metadata.aliases.filter((alias): alias is string => typeof alias === "string")
    : [];
  for (const alias of aliases) {
    const aliasFacts = factsBySubject.get(alias.trim());
    if (aliasFacts && aliasFacts.length > 0) return selectTemporalFacts(aliasFacts);
  }
  return [];
}

function selectTemporalFacts(facts: readonly EntityFactLite[]): readonly EntityFactLite[] {
  return [...facts]
    .sort((a, b) => (TEMPORAL_PREDICATE_PRIORITY.get(a.predicate.trim()) ?? 1) - (TEMPORAL_PREDICATE_PRIORITY.get(b.predicate.trim()) ?? 1))
    .slice(0, 3);
}

/** 酒馆式单张角色/设定卡片 */
function CharacterOrLoreCard({
  node,
  activeTab,
  facts,
  isSelected,
  kernel,
  currentChapter,
  onClick,
}: {
  node: WorkbenchResourceNode;
  activeTab: MainTab;
  facts: readonly EntityFactLite[];
  isSelected: boolean;
  /** 结算沉淀的"当前是谁"摘要；仅 characters tab 有值。 */
  kernel?: CharacterKernelSummary;
  currentChapter?: number;
  onClick: () => void;
}) {
  const meta = node.metadata ?? {};
  const category = entryCategory(node);
  const categoryMeta = CATEGORY_META.find((item) => item.id === category);
  const aliases = Array.isArray(meta.aliases) ? meta.aliases : [];
  const preview = String(node.content?.slice(0, 120) || meta.summary || "暂无描述");

  const isCharacter = activeTab === "characters";

  return (
    <div
      onClick={onClick}
      className={`group relative rounded-lg border p-2.5 transition-all cursor-pointer shadow-xs ${
        isSelected
          ? "border-primary bg-primary/5 ring-1 ring-primary/40"
          : "border-border/80 bg-card hover:border-border hover:shadow-sm"
      }`}
    >
      <div className="flex items-start gap-2.5">
        {/* 角色图标徽章 */}
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold shadow-2xs ${
            isCharacter
              ? "bg-primary/10 border-primary/20 text-primary"
              : "bg-muted border-border/80 text-muted-foreground"
          }`}
        >
          {isCharacter ? <UserRound className="size-4.5" /> : <BookOpen className="size-4" />}
        </div>

        {/* 核心信息与时态标签 */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between gap-1">
            <span className="font-semibold text-xs text-foreground truncate group-hover:text-primary transition-colors">
              {node.title}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {!isCharacter && categoryMeta && (
                <Badge variant="secondary" className="text-2xs px-1 h-3.5">
                  {categoryMeta.name}
                </Badge>
              )}
            </div>
          </div>

          {/* 别名标签 */}
          {aliases.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {aliases.slice(0, 2).map((alias, i) => (
                <span key={i} className="text-2xs rounded bg-muted/70 px-1 py-0.2 text-muted-foreground">
                  {alias}
                </span>
              ))}
              {aliases.length > 2 && (
                <span className="text-2xs text-muted-foreground">+{aliases.length - 2}</span>
              )}
            </div>
          )}

          {isCharacter && kernel && (
            <div className="rounded-md bg-primary/[0.04] border border-primary/20 px-1.5 py-1 space-y-0.5" data-testid="character-kernel-summary">
              {(typeof kernel.fields["motivation"] === "string" && kernel.fields["motivation"]) && (
                <p className="text-2xs text-foreground/90 leading-snug">
                  <span className="text-primary font-medium">动机</span> {kernel.fields["motivation"]}
                </p>
              )}
              {(typeof kernel.fields["emotionalCenter"] === "string" && kernel.fields["emotionalCenter"]) && (
                <p className="text-2xs text-muted-foreground leading-snug">
                  <span className="text-primary/70 font-medium">心境</span> {kernel.fields["emotionalCenter"]}
                </p>
              )}
              <p className="text-2xs text-muted-foreground">
                内核更新于第 {kernel.updatedChapter} 章
              </p>
            </div>
          )}

          {isCharacter && currentChapter !== undefined && (
            <p className="text-2xs text-muted-foreground" data-testid="character-last-appearance">
              {(() => {
                const lastCh = kernel?.updatedChapter
                  ?? (facts.length > 0 ? Math.max(...facts.map((f) => f.sourceChapter ?? 0)) : undefined);
                if (!lastCh || lastCh <= 0) return null;
                const gap = currentChapter - lastCh;
                return (
                  <>
                    最后出场 第{lastCh}章
                    {gap >= 15 && (
                      <Badge variant="destructive" className="ml-1 text-2xs px-1 py-0">⚠️ {gap}章未出场</Badge>
                    )}
                  </>
                );
              })()}
            </p>
          )}

          {facts.length > 0 && (
            <div className="flex flex-wrap gap-1" data-testid="character-temporal-facts">
              {facts.map((fact, index) => (
                <Badge
                  key={`${fact.predicate}-${fact.object}-${index}`}
                  variant="outline"
                  className="max-w-full truncate border-primary/30 bg-primary/5 px-1 text-2xs font-normal text-primary"
                  data-testid="character-temporal-fact"
                >
                  {fact.predicate}: {fact.object}
                </Badge>
              ))}
            </div>
          )}

          {/* 经典人设简述 */}
          <p className="text-2xs text-muted-foreground line-clamp-2 leading-relaxed">
            {preview}
          </p>
        </div>
      </div>
    </div>
  );
}

function ImportSection({ bookId, onClose, onImported }: { bookId: string; onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("characters");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

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
      setResult(`成功导入 ${data.imported} 条设定条目`);
      setTimeout(onImported, 600);
    } catch {
      setResult("导入失败，请检查格式");
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
        <option value="characters">角色 (Characters)</option>
        <option value="factions">势力 / 门派 (Factions)</option>
        <option value="world-model">世界模型 (World)</option>
        <option value="power-system">力量体系 (Power System)</option>
        <option value="rules">法则规则 (Rules)</option>
        <option value="locations">地理场景 (Locations)</option>
        <option value="props">重要物品 (Props)</option>
        <option value="timeline">前史时间线 (Timeline)</option>
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
      {result && <p className="text-2xs text-emerald-600 font-medium">{result}</p>}
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
