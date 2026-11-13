import { useId, useMemo, useState } from "react";
import {
  BookOpen,
  CheckSquare,
  Compass,
  Feather,
  FileText,
  Filter,
  Layers,
  Loader2,
  Search,
  Square,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface DistillLocalFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly updatedAt?: string;
}

export interface DistillIndexedChapter {
  readonly number: number;
  readonly title: string;
  readonly charCount: number;
  readonly dialogueRatio: number;
  readonly dominantFeatures: readonly string[];
  readonly featureScores?: {
    readonly bill?: number;
    readonly combat?: number;
    readonly ancient?: number;
    readonly banter?: number;
  };
}

export interface DistillFileIndexResult {
  readonly sourceName: string;
  readonly filePath: string;
  readonly encoding: string;
  readonly byteLength: number;
  readonly totalChars: number;
  readonly chapterCount: number;
  readonly recommendedChapters: {
    readonly chapterNumbers: readonly number[];
    readonly rationale: Readonly<Record<string, string>>;
  };
  readonly chapters: readonly DistillIndexedChapter[];
}

export type FeatureFilterKey =
  | "all"
  | "recommended"
  | "dialogue_banter"
  | "bill_inventory"
  | "combat_counter"
  | "ancient_scripture"
  | "institution_rule";

const FEATURE_FILTERS: readonly { key: FeatureFilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "recommended", label: "推荐高能章" },
  { key: "dialogue_banter", label: "互损对白密集" },
  { key: "bill_inventory", label: "算账流水" },
  { key: "combat_counter", label: "生克斗法" },
  { key: "ancient_scripture", label: "古籍道藏" },
  { key: "institution_rule", label: "制度合同" },
];

const FEATURE_BADGE_LABELS: Readonly<Record<string, string>> = {
  dialogue_banter: "互损对白",
  bill_inventory: "算账流水",
  combat_counter: "生克斗法",
  ancient_scripture: "古籍道藏",
  institution_rule: "制度合同",
  narrative: "叙事推进",
};

function formatInt(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function inferSourceTitleFromPath(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  return base.replace(/\.[^.]+$/, "").trim() || base;
}

export function normaliseFileIndexResult(value: unknown): DistillFileIndexResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("章节机械索引返回格式异常，请稍后重试。");
  }
  const record = value as Record<string, unknown>;
  const recommendedObj =
    record.recommendedChapters && typeof record.recommendedChapters === "object" && !Array.isArray(record.recommendedChapters)
      ? (record.recommendedChapters as Record<string, unknown>)
      : {};
  const chapterNumbers = Array.isArray(recommendedObj.chapterNumbers)
    ? recommendedObj.chapterNumbers.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    : [];
  const rawRationale =
    recommendedObj.rationale && typeof recommendedObj.rationale === "object" && !Array.isArray(recommendedObj.rationale)
      ? (recommendedObj.rationale as Record<string, unknown>)
      : {};
  const rationale: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawRationale)) {
    if (typeof v === "string" && v.trim()) rationale[k] = v.trim();
  }

  const rawChapters = Array.isArray(record.chapters) ? record.chapters : [];
  const chapters: DistillIndexedChapter[] = rawChapters.flatMap((item, idx) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const ch = item as Record<string, unknown>;
    const num = typeof ch.number === "number" && Number.isFinite(ch.number)
      ? ch.number
      : typeof ch.chapterNumber === "number" && Number.isFinite(ch.chapterNumber)
        ? ch.chapterNumber
        : idx + 1;
    const title = typeof ch.title === "string" && ch.title.trim() ? ch.title.trim() : `第 ${num} 章`;
    const charCount = typeof ch.charCount === "number" && Number.isFinite(ch.charCount)
      ? ch.charCount
      : typeof ch.characters === "number" && Number.isFinite(ch.characters)
        ? ch.characters
        : 0;
    const dialogueRatio = typeof ch.dialogueRatio === "number" && Number.isFinite(ch.dialogueRatio)
      ? Math.max(0, Math.min(1, ch.dialogueRatio))
      : 0;
    const dominantFeatures = Array.isArray(ch.dominantFeatures)
      ? ch.dominantFeatures.filter((f): f is string => typeof f === "string")
      : [];
    const scoresObj =
      ch.featureScores && typeof ch.featureScores === "object" && !Array.isArray(ch.featureScores)
        ? (ch.featureScores as Record<string, unknown>)
        : null;
    return [{
      number: num,
      title,
      charCount,
      dialogueRatio,
      dominantFeatures,
      ...(scoresObj
        ? {
            featureScores: {
              ...(typeof scoresObj.bill === "number" ? { bill: scoresObj.bill } : {}),
              ...(typeof scoresObj.combat === "number" ? { combat: scoresObj.combat } : {}),
              ...(typeof scoresObj.ancient === "number" ? { ancient: scoresObj.ancient } : {}),
              ...(typeof scoresObj.banter === "number" ? { banter: scoresObj.banter } : {}),
            },
          }
        : {}),
    }];
  });

  const filePath = typeof record.filePath === "string" ? record.filePath : "";
  return {
    sourceName: typeof record.sourceName === "string" && record.sourceName.trim()
      ? record.sourceName.trim()
      : inferSourceTitleFromPath(filePath) || "未命名来源",
    filePath,
    encoding: typeof record.encoding === "string" && record.encoding.trim() ? record.encoding : "utf-8",
    byteLength: typeof record.byteLength === "number" && Number.isFinite(record.byteLength) ? record.byteLength : 0,
    totalChars: typeof record.totalChars === "number" && Number.isFinite(record.totalChars)
      ? record.totalChars
      : chapters.reduce((sum, ch) => sum + ch.charCount, 0),
    chapterCount: typeof record.chapterCount === "number" && Number.isFinite(record.chapterCount)
      ? record.chapterCount
      : chapters.length,
    recommendedChapters: { chapterNumbers, rationale },
    chapters,
  };
}

export interface DistillFileIndexPickerProps {
  files: readonly DistillLocalFile[];
  selectedFilePath: string;
  onSelectFilePath: (filePath: string) => void;
  sourceName: string;
  onSourceNameChange: (name: string) => void;
  splitPattern: string;
  onSplitPatternChange: (pattern: string) => void;
  indexResult: DistillFileIndexResult | null;
  indexing: boolean;
  busy: boolean;
  extractingMechanisms: boolean;
  selectedChapters: readonly number[];
  onSelectedChaptersChange: (chapterNumbers: number[]) => void;
  onBuildIndex: () => void;
  onPreviewSelection: () => void;
  onStartStyleDistill: () => void;
  onStartMechanismExtract: () => void;
}

export function DistillFileIndexPicker({
  files,
  selectedFilePath,
  onSelectFilePath,
  sourceName,
  onSourceNameChange,
  splitPattern,
  onSplitPatternChange,
  indexResult,
  indexing,
  busy,
  extractingMechanisms,
  selectedChapters,
  onSelectedChaptersChange,
  onBuildIndex,
  onPreviewSelection,
  onStartStyleDistill,
  onStartMechanismExtract,
}: DistillFileIndexPickerProps) {
  const splitHintId = useId();
  const [activeFilter, setActiveFilter] = useState<FeatureFilterKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");

  const selectedSet = useMemo(() => new Set(selectedChapters), [selectedChapters]);
  const recommendedSet = useMemo(
    () => new Set(indexResult?.recommendedChapters.chapterNumbers ?? []),
    [indexResult],
  );

  const filterCounts = useMemo(() => {
    const chapters = indexResult?.chapters ?? [];
    const counts: Record<FeatureFilterKey, number> = {
      all: chapters.length,
      recommended: chapters.filter((ch) => recommendedSet.has(ch.number)).length,
      dialogue_banter: 0,
      bill_inventory: 0,
      combat_counter: 0,
      ancient_scripture: 0,
      institution_rule: 0,
    };
    for (const ch of chapters) {
      for (const feat of ch.dominantFeatures) {
        if (feat in counts && feat !== "all" && feat !== "recommended") {
          counts[feat as FeatureFilterKey] += 1;
        }
      }
    }
    return counts;
  }, [indexResult, recommendedSet]);

  const filteredChapters = useMemo(() => {
    if (!indexResult) return [];
    const query = searchQuery.trim().toLowerCase();
    return indexResult.chapters.filter((ch) => {
      if (activeFilter === "recommended" && !recommendedSet.has(ch.number)) return false;
      if (activeFilter !== "all" && activeFilter !== "recommended" && !ch.dominantFeatures.includes(activeFilter)) {
        return false;
      }
      if (query) {
        const rationale = indexResult.recommendedChapters.rationale[String(ch.number)] ?? "";
        const matchTitle = ch.title.toLowerCase().includes(query);
        const matchNumber = String(ch.number) === query || `第${ch.number}章`.includes(query);
        const matchRationale = rationale.toLowerCase().includes(query);
        if (!matchTitle && !matchNumber && !matchRationale) return false;
      }
      return true;
    });
  }, [indexResult, activeFilter, recommendedSet, searchQuery]);

  const selectionSummary = useMemo(() => {
    if (!indexResult || selectedChapters.length === 0) {
      return { count: 0, totalChars: 0, estimatedBatches: 0 };
    }
    const totalChars = indexResult.chapters
      .filter((ch) => selectedSet.has(ch.number))
      .reduce((sum, ch) => sum + ch.charCount, 0);
    const estimatedBatches = Math.max(
      1,
      Math.ceil(Math.max(selectedChapters.length / 3, totalChars / 12_000)),
    );
    return { count: selectedChapters.length, totalChars, estimatedBatches };
  }, [indexResult, selectedChapters.length, selectedSet]);

  const disabled = busy || indexing || extractingMechanisms;

  function toggleChapter(chapterNumber: number) {
    if (disabled) return;
    const next = new Set(selectedSet);
    if (next.has(chapterNumber)) {
      next.delete(chapterNumber);
    } else {
      next.add(chapterNumber);
    }
    onSelectedChaptersChange([...next].sort((a, b) => a - b));
  }

  function selectRecommended() {
    if (!indexResult || disabled) return;
    const rec = indexResult.recommendedChapters.chapterNumbers;
    if (rec.length > 0) {
      onSelectedChaptersChange([...new Set(rec)].sort((a, b) => a - b));
      return;
    }
    const fallback = indexResult.chapters.slice(0, 15).map((ch) => ch.number);
    onSelectedChaptersChange(fallback);
  }

  function applyRangeSelection() {
    if (!indexResult || disabled) return;
    const start = Number.parseInt(rangeStart, 10);
    const end = Number.parseInt(rangeEnd, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    const next = new Set(selectedSet);
    for (const ch of indexResult.chapters) {
      if (ch.number >= low && ch.number <= high) {
        next.add(ch.number);
      }
    }
    onSelectedChaptersChange([...next].sort((a, b) => a - b));
  }

  function selectAllFiltered() {
    if (disabled || filteredChapters.length === 0) return;
    const next = new Set(selectedSet);
    for (const ch of filteredChapters) next.add(ch.number);
    onSelectedChaptersChange([...next].sort((a, b) => a - b));
  }

  return (
    <div className="space-y-4" data-testid="distill-file-index-picker">
      {/* 1. 本地书库文件与规则设定栏 */}
      <Card className="border-border/80 bg-card/95">
        <CardHeader className="border-b border-border/60 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <CardTitle className="flex items-center gap-2 text-base" style={{ fontFamily: "var(--font-display)" }}>
                <BookOpen className="size-4 text-primary" />
                书库本地大文件靶向采样
              </CardTitle>
              <CardDescription className="text-xs">
                先对百万字参考原著做零消耗机械切章与场景特征扫描，再只挑 12–18 章高能代表章送入模型，省去九成无效消耗。
              </CardDescription>
            </div>
            <Badge variant="secondary" className="tabular-nums">
              已发现 {files.length} 份本地书稿
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">选择本地参考书稿</span>
              <select
                aria-label="选择本地参考书稿"
                value={selectedFilePath}
                disabled={disabled}
                onChange={(event) => {
                  const nextPath = event.target.value;
                  onSelectFilePath(nextPath);
                  if (nextPath && (!sourceName.trim() || files.some((f) => inferSourceTitleFromPath(f.path) === sourceName.trim()))) {
                    onSourceNameChange(inferSourceTitleFromPath(nextPath));
                  }
                }}
                className="flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
              >
                {files.map((file) => {
                  const baseName = file.path.split(/[\\/]/).pop() ?? file.path;
                  return (
                    <option key={file.path} value={file.path}>
                      {baseName}（{formatFileSize(file.sizeBytes)}）
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">来源名称</span>
              <Input
                aria-label="来源名称"
                value={sourceName}
                onChange={(event) => onSourceNameChange(event.target.value)}
                placeholder="例如：没钱修什么仙"
                disabled={disabled}
                className="h-8 text-xs"
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">章节标题规则（可选，正则）</span>
              <Input
                aria-label="章节标题规则（可选，正则）"
                aria-describedby={splitHintId}
                value={splitPattern}
                onChange={(event) => onSplitPatternChange(event.target.value)}
                placeholder="^【\d+】(.*)"
                spellCheck={false}
                autoComplete="off"
                disabled={disabled}
                className="h-8 font-mono text-xs"
              />
              <span id={splitHintId} className="block text-2xs text-muted-foreground">
                留空则自动识别『第X章』『Chapter X』等标题；只支持简单规则
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-xs text-muted-foreground">
              机械索引在本地即时扫描对白密度、算账清单、斗法博弈、古籍文言与契约规章分布，不调用大模型。
            </p>
            <Button
              type="button"
              variant={indexResult ? "outline" : "default"}
              size="sm"
              disabled={disabled || !selectedFilePath}
              onClick={onBuildIndex}
              className="gap-1.5"
            >
              {indexing ? <Loader2 className="size-3.5 animate-spin" /> : <Compass className="size-3.5" />}
              {indexing ? "正在扫描机械索引…" : "生成章节机械索引（0 Token）"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 2. 机械索引结果：统计横幅 + 特征筛选条 + 紧凑可勾选章节表 */}
      {indexResult && (
        <Card className="border-border/80 bg-card" aria-label="章节机械索引面板">
          <CardHeader className="space-y-3 border-b border-border/60 pb-3">
            {/* 清爽统计横幅 */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/25 px-3.5 py-2.5">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground">来源书目：</span>
                  <span className="font-semibold text-foreground">{indexResult.sourceName}</span>
                </div>
                <div className="tabular-nums">
                  <span className="text-muted-foreground">总章数：</span>
                  <span className="font-semibold text-foreground">{formatInt(indexResult.chapterCount)} 章</span>
                </div>
                <div className="tabular-nums">
                  <span className="text-muted-foreground">总字数：</span>
                  <span className="font-semibold text-foreground">{formatInt(indexResult.totalChars)} 字</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">文本编码：</span>
                  <Badge variant="outline" className="font-mono uppercase">
                    {indexResult.encoding}
                  </Badge>
                </div>
                {recommendedSet.size > 0 && (
                  <div className="tabular-nums">
                    <span className="text-muted-foreground">高能代表章：</span>
                    <span className="font-semibold text-primary">{recommendedSet.size} 章</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  disabled={disabled || indexResult.chapters.length === 0}
                  onClick={selectRecommended}
                >
                  <CheckSquare className="size-3 text-primary" />
                  一键勾选推荐代表章（{recommendedSet.size || Math.min(15, indexResult.chapters.length)} 章）
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={disabled || filteredChapters.length === 0}
                  onClick={selectAllFiltered}
                >
                  全选当前筛选
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={disabled || selectedChapters.length === 0}
                  onClick={() => onSelectedChaptersChange([])}
                >
                  <Square className="size-3" />
                  清空已选
                </Button>
              </div>
            </div>

            {/* 特征筛选条 + 按区间选择与标题检索 */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="章节特征筛选">
                <Filter className="mr-0.5 size-3.5 text-muted-foreground" />
                {FEATURE_FILTERS.map((item) => {
                  const active = activeFilter === item.key;
                  const count = filterCounts[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      disabled={disabled}
                      onClick={() => setActiveFilter(item.key)}
                      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                        active
                          ? "border-primary/50 bg-primary text-primary-foreground font-medium"
                          : "border-border/70 bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      }`}
                    >
                      <span>{item.label}</span>
                      <span className={`tabular-nums text-2xs ${active ? "text-primary-foreground/85" : "text-muted-foreground/80"}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex items-center gap-1 rounded-md border border-border/70 bg-background px-2 py-0.5">
                  <span className="text-2xs text-muted-foreground">章号区间</span>
                  <input
                    type="number"
                    min={1}
                    aria-label="起始章号"
                    placeholder="起"
                    value={rangeStart}
                    onChange={(event) => setRangeStart(event.target.value)}
                    disabled={disabled}
                    className="w-12 bg-transparent text-center text-xs tabular-nums outline-none"
                  />
                  <span className="text-muted-foreground">–</span>
                  <input
                    type="number"
                    min={1}
                    aria-label="结束章号"
                    placeholder="止"
                    value={rangeEnd}
                    onChange={(event) => setRangeEnd(event.target.value)}
                    disabled={disabled}
                    className="w-12 bg-transparent text-center text-xs tabular-nums outline-none"
                  />
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={disabled || !rangeStart.trim() || !rangeEnd.trim()}
                    onClick={applyRangeSelection}
                    className="h-5 px-1.5 text-2xs"
                  >
                    勾选区间
                  </Button>
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="搜索章节标题或编号"
                    placeholder="搜章号 / 标题…"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    disabled={disabled}
                    className="h-7 w-40 pl-6 text-xs"
                  />
                </div>
              </div>
            </div>
          </CardHeader>

          {/* 紧凑可勾选章节表 */}
          <CardContent className="space-y-3 pt-3">
            {filteredChapters.length > 0 ? (
              <div className="max-h-80 overflow-y-auto rounded-lg border border-border/70">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 border-b border-border bg-muted/90 backdrop-blur-xs">
                    <tr className="text-muted-foreground">
                      <th scope="col" className="w-10 px-3 py-2 font-medium">选</th>
                      <th scope="col" className="w-20 px-2 py-2 font-medium">章号</th>
                      <th scope="col" className="px-2 py-2 font-medium">章节标题与采样依据</th>
                      <th scope="col" className="w-24 px-2 py-2 text-right font-medium">字数</th>
                      <th scope="col" className="w-32 px-3 py-2 font-medium">对白占比</th>
                      <th scope="col" className="w-48 px-3 py-2 font-medium">主导特征</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {filteredChapters.map((chapter) => {
                      const checked = selectedSet.has(chapter.number);
                      const isRec = recommendedSet.has(chapter.number);
                      const rationale = indexResult.recommendedChapters.rationale[String(chapter.number)];
                      const dialoguePct = Math.round(chapter.dialogueRatio * 100);
                      return (
                        <tr
                          key={chapter.number}
                          onClick={() => toggleChapter(chapter.number)}
                          className={`cursor-pointer transition-colors ${
                            checked ? "bg-primary/8 hover:bg-primary/12" : "hover:bg-muted/40"
                          }`}
                        >
                          <td className="px-3 py-2 align-middle" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`选择第 ${chapter.number} 章`}
                              checked={checked}
                              disabled={disabled}
                              onChange={() => toggleChapter(chapter.number)}
                              className="size-3.5 cursor-pointer accent-primary"
                            />
                          </td>
                          <td className="px-2 py-2 align-middle font-mono text-muted-foreground tabular-nums">
                            第 {chapter.number} 章
                          </td>
                          <td className="px-2 py-2 align-middle">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium text-foreground">{chapter.title}</span>
                              {isRec && (
                                <Badge variant="secondary" className="h-4 px-1.5 text-2xs text-primary">
                                  推荐代表章
                                </Badge>
                              )}
                            </div>
                            {rationale && (
                              <p className="mt-0.5 text-2xs text-muted-foreground">{rationale}</p>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right align-middle tabular-nums text-muted-foreground">
                            {formatInt(chapter.charCount)}
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-primary/75"
                                  style={{ width: `${dialoguePct}%` }}
                                />
                              </div>
                              <span className="w-8 text-right text-2xs tabular-nums text-muted-foreground">
                                {dialoguePct}%
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <div className="flex flex-wrap gap-1">
                              {chapter.dominantFeatures.length > 0 ? (
                                chapter.dominantFeatures.map((feat) => (
                                  <Badge
                                    key={feat}
                                    variant={feat === "narrative" ? "outline" : "secondary"}
                                    className="h-4 px-1.5 text-2xs font-normal"
                                  >
                                    {FEATURE_BADGE_LABELS[feat] ?? feat}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-2xs text-muted-foreground">—</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                当前特征筛选下没有匹配章节，可切换至「全部」查看。
              </p>
            )}

            {/* 底部实时统计与一键双轨启动栏 */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3.5 py-2.5">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="font-medium text-foreground tabular-nums">
                  已选 {selectionSummary.count} 章
                </span>
                <span className="text-muted-foreground tabular-nums">
                  送入约 {formatInt(selectionSummary.totalChars)} 字
                </span>
                <Badge variant="outline" className="tabular-nums">
                  预计消耗 {selectionSummary.estimatedBatches} 批次
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled || selectionSummary.count === 0}
                  onClick={onPreviewSelection}
                  className="gap-1"
                >
                  <FileText className="size-3.5" />
                  预览所选范围
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled || selectionSummary.count === 0}
                  onClick={onStartMechanismExtract}
                  className="gap-1.5"
                >
                  {extractingMechanisms ? <Loader2 className="size-3.5 animate-spin" /> : <Layers className="size-3.5 text-primary" />}
                  {extractingMechanisms ? "正在抽取机制卡…" : "抽剧情机制卡"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={disabled || selectionSummary.count === 0}
                  onClick={onStartStyleDistill}
                  className="gap-1.5"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Feather className="size-3.5" />}
                  {busy ? "正在启动蒸馏…" : "抽文风 DNA"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
