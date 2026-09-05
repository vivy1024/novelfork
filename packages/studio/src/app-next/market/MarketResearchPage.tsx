import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronUp,
  Columns2,
  ExternalLink,
  Eye,
  Filter,
  LoaderCircle,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { fetchJson } from "@/lib/api-client";
import { notify } from "@/lib/notify";
import { useApi } from "@/hooks/use-api";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface RankConfig {
  readonly key: string;
  readonly name: string;
}

interface CustomRankConfig extends RankConfig {
  readonly platform: "qidian" | "fanqie";
  readonly url: string;
}

interface RankRegistryPayload {
  readonly qidian: RankConfig[];
  readonly fanqie: RankConfig[];
  readonly custom?: CustomRankConfig[];
}

interface RankRecord {
  readonly platform: "qidian" | "fanqie";
  readonly book_id: string;
  readonly rank_type: string;
  readonly category: string;
  readonly rank: number;
  readonly title: string;
  readonly author: string;
  readonly observed_at: string;
  readonly source_status: "ok" | "parse_fail" | "empty";
  readonly word_count?: number;
  readonly intro?: string;
  readonly source?: string;
}

interface BookSnapshot {
  readonly snapshot_id: string;
  readonly platform: "qidian" | "fanqie";
  readonly rank_type: string;
  readonly observed_at: string;
  readonly records: readonly RankRecord[];
}

interface AnalysisReport {
  readonly platform: string;
  readonly generated_at: string;
  readonly summary: {
    readonly total_books: number;
    readonly total_snapshots: number;
    readonly top_categories: readonly string[];
  };
  readonly markdown: string;
}

interface RankScanReport {
  readonly platform: "qidian" | "fanqie";
  readonly rankType: string;
  readonly source: string;
  readonly observedAt: string;
  readonly health: "ok" | "stale" | "parse_fail" | "empty";
  readonly bookCount: number;
  readonly reason: string;
}

interface SnapshotQuery {
  readonly snapshots: readonly BookSnapshot[];
  readonly latest?: readonly BookSnapshot[];
  readonly ranks?: readonly RankScanReport[];
  readonly analysis?: AnalysisReport;
}

interface MarketLexicon {
  readonly aliases: Readonly<Record<string, readonly string[]>>;
}

interface ServerScanPrefs {
  readonly platform?: "all" | "qidian" | "fanqie";
  readonly rankTypes?: readonly string[];
  readonly categories?: readonly string[];
  readonly limit?: number;
}

interface PublicChapterSample {
  readonly book_id: string;
  readonly chapter_id: string;
  readonly title: string;
  readonly chapter_word_count: number;
  readonly paragraph_count: number;
  readonly dialogue_ratio: number;
  readonly question_mark_count: number;
  readonly exclamation_mark_count: number;
  readonly system_word_hits: number;
  readonly conflict_word_hits: number;
  readonly golden_finger_hits: number;
  readonly structural_summary: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  qidian: "起点",
  fanqie: "番茄",
  all: "起点 + 番茄",
};

const MARKET_SCAN_PREFS_KEY = "novelfork.market.scan-prefs";
const MARKET_SPLIT_RATIO_KEY = "novelfork.market.split-ratio";
const MAX_SCAN_LIMIT = 200;
const DEFAULT_SCAN_LIMIT = 20;
const GENRE_PRESETS = [
  "玄幻",
  "仙侠",
  "都市",
  "历史",
  "科幻",
  "游戏",
  "悬疑",
  "诸天",
  "无限",
  "现实",
  "武侠",
  "奇幻",
  "末世",
  "重生",
  "穿越",
] as const;

interface MarketScanPrefs {
  readonly platform: "all" | "qidian" | "fanqie";
  readonly rankKeys: string[];
  readonly categories: string[];
  readonly limit: number;
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SCAN_LIMIT;
  return Math.min(MAX_SCAN_LIMIT, Math.max(1, Math.trunc(value)));
}

function pagesForLimit(limit: number): number {
  return Math.min(5, Math.max(1, Math.ceil(limit / 20)));
}

function expandMatchTerms(categories: readonly string[], lexicon?: MarketLexicon): string[] {
  const terms = new Set<string>();
  for (const item of categories) {
    const term = item.trim();
    if (!term) continue;
    terms.add(term);
    if (!lexicon) continue;
    const direct = lexicon.aliases[term];
    if (direct) for (const alias of direct) terms.add(alias);
    for (const [canonical, aliases] of Object.entries(lexicon.aliases)) {
      if (canonical === term || aliases.includes(term)) {
        terms.add(canonical);
        for (const alias of aliases) terms.add(alias);
      }
    }
  }
  return [...terms];
}

function recordMatchesCategories(
  category: string,
  categories: readonly string[],
  lexicon?: MarketLexicon,
): boolean {
  if (categories.length === 0) return true;
  const haystack = category.trim();
  if (!haystack) return false;
  return expandMatchTerms(categories, lexicon).some((item) => haystack.includes(item) || item.includes(haystack));
}

function bookUrl(platform: "qidian" | "fanqie", bookId: string): string | null {
  if (!bookId) return null;
  if (platform === "qidian") return `https://www.qidian.com/info/${bookId}`;
  if (platform === "fanqie") return `https://fanqienovel.com/page/${bookId}`;
  return null;
}

function loadLocalScanPrefs(): Partial<MarketScanPrefs> {
  try {
    const raw = globalThis.localStorage?.getItem(MARKET_SCAN_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<MarketScanPrefs>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalScanPrefs(prefs: MarketScanPrefs): void {
  try {
    globalThis.localStorage?.setItem(MARKET_SCAN_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

function loadSplitRatio(): number {
  try {
    const raw = globalThis.localStorage?.getItem(MARKET_SPLIT_RATIO_KEY);
    if (raw) {
      const val = Number(raw);
      if (Number.isFinite(val) && val >= 30 && val <= 75) return val;
    }
  } catch {
    // ignore
  }
  return 60;
}

function saveSplitRatio(val: number): void {
  try {
    globalThis.localStorage?.setItem(MARKET_SPLIT_RATIO_KEY, String(val));
  } catch {
    // ignore
  }
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function defaultRankKeys(platform: "all" | "qidian" | "fanqie"): string[] {
  return platform === "fanqie" ? ["male_read"] : ["newbook"];
}

export function MarketResearchPage() {
  const storedPrefs = useMemo(() => loadLocalScanPrefs(), []);
  const [platform, setPlatform] = useState<"all" | "qidian" | "fanqie">(storedPrefs.platform ?? "qidian");
  const ranksQuery = useApi<RankRegistryPayload>("/market/ranks");
  const snapshotsQuery = useApi<SnapshotQuery>("/market/snapshots?analyze=true");
  const prefsQuery = useApi<{ ok: boolean; prefs: ServerScanPrefs | null }>("/market/scan-prefs");
  const lexiconQuery = useApi<{ ok: boolean; lexicon: MarketLexicon }>("/market/lexicon");

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const [rankKeys, setRankKeys] = useState<string[]>(storedPrefs.rankKeys?.length ? storedPrefs.rankKeys : ["newbook"]);
  const [categories, setCategories] = useState<string[]>(storedPrefs.categories ?? []);
  const [limit, setLimit] = useState(clampLimit(storedPrefs.limit ?? DEFAULT_SCAN_LIMIT));
  const [customGenre, setCustomGenre] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIntros, setExpandedIntros] = useState<Record<string, boolean>>({});

  // 拖动分栏宽度比（左侧百分比，30 - 75）
  const [splitRatio, setSplitRatio] = useState<number>(() => loadSplitRatio());
  const isDraggingSplitter = useRef(false);
  const splitterContainerRef = useRef<HTMLDivElement | null>(null);

  // 自定义榜单表单与探测
  const [rankForm, setRankForm] = useState({
    platform: "qidian" as "qidian" | "fanqie",
    key: "",
    name: "",
    url: "",
  });
  const [rankBusy, setRankBusy] = useState(false);
  const [rankError, setRankError] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<{ ok: boolean; sampleBooks?: RankRecord[]; error?: string } | null>(null);
  const [probing, setProbing] = useState(false);

  // 词库状态
  const [lexiconCanonical, setLexiconCanonical] = useState("");
  const [lexiconAlias, setLexiconAlias] = useState("");
  const [lexiconBusy, setLexiconBusy] = useState(false);
  const [lexiconError, setLexiconError] = useState<string | null>(null);

  // 公开章节指标采样弹层
  const [sampleBookId, setSampleBookId] = useState<string | null>(null);
  const [sampleBookTitle, setSampleBookTitle] = useState("");
  const [samples, setSamples] = useState<PublicChapterSample[]>([]);
  const [sampling, setSampling] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  const hydratedFromServer = useRef(false);
  const skipNextPrefsPut = useRef(true);

  const customRanks = ranksQuery.data?.custom ?? [];
  const lexicon = lexiconQuery.data?.lexicon;

  const rankOptions = useMemo(() => {
    const qidian = ranksQuery.data?.qidian ?? [];
    const fanqie = ranksQuery.data?.fanqie ?? [];
    const decorate = (builtin: RankConfig[], plat: "qidian" | "fanqie"): RankConfig[] => [
      ...builtin,
      ...customRanks
        .filter((rank) => rank.platform === plat)
        .map((rank) => ({ key: rank.key, name: `${rank.name}（自定义）` })),
    ];
    if (platform === "qidian") return decorate(qidian, "qidian");
    if (platform === "fanqie") return decorate(fanqie, "fanqie");
    return [...decorate(qidian, "qidian"), ...decorate(fanqie, "fanqie")];
  }, [customRanks, platform, ranksQuery.data]);

  const ranks = snapshotsQuery.data?.ranks ?? [];
  const latestSnapshots = snapshotsQuery.data?.latest ?? [];
  const healthByKey = useMemo(() => {
    const map = new Map<string, RankScanReport>();
    for (const rank of ranks) map.set(`${rank.platform}-${rank.rankType}`, rank);
    return map;
  }, [ranks]);

  const snapshotCategories = useMemo(() => {
    const seen = new Set<string>();
    for (const snapshot of latestSnapshots) {
      for (const record of snapshot.records) {
        const category = record.category.trim();
        if (category) seen.add(category);
      }
    }
    return [...seen].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [latestSnapshots]);

  const genreOptions = useMemo(() => {
    const seen = new Set<string>([
      ...GENRE_PRESETS,
      ...Object.keys(lexicon?.aliases ?? {}),
      ...snapshotCategories,
      ...categories,
    ]);
    return [...seen];
  }, [categories, lexicon, snapshotCategories]);

  const latestRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return latestSnapshots
      .filter((snapshot) => {
        const health = healthByKey.get(`${snapshot.platform}-${snapshot.rank_type}`)?.health;
        if (!health) {
          return snapshot.records.some((record) => record.source_status === "ok" && record.book_id);
        }
        return health === "ok";
      })
      .flatMap((snapshot) => {
        const source = healthByKey.get(`${snapshot.platform}-${snapshot.rank_type}`)?.source
          ?? `${PLATFORM_LABEL[snapshot.platform] ?? snapshot.platform} · ${snapshot.rank_type}`;
        return snapshot.records
          .filter((record) => record.source_status === "ok" && record.book_id)
          .filter((record) => recordMatchesCategories(record.category, categories, lexicon))
          .filter((record) => {
            if (!q) return true;
            return (
              record.title.toLowerCase().includes(q)
              || record.author.toLowerCase().includes(q)
              || (record.intro?.toLowerCase().includes(q) ?? false)
              || record.category.toLowerCase().includes(q)
            );
          })
          .map((record) => ({ ...record, source }));
      })
      .sort((a, b) => a.rank - b.rank)
      .slice(0, limit);
  }, [categories, healthByKey, latestSnapshots, lexicon, limit, searchQuery]);

  const failedRanks = ranks.filter((rank) => rank.health !== "ok");
  const lexiconEntries = useMemo(() => (
    Object.entries(lexicon?.aliases ?? {}).sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
  ), [lexicon]);

  // 从服务端同步偏好
  useEffect(() => {
    const prefs = prefsQuery.data?.prefs;
    if (!prefs || hydratedFromServer.current) return;
    hydratedFromServer.current = true;
    skipNextPrefsPut.current = true;
    if (prefs.platform) setPlatform(prefs.platform);
    if (prefs.rankTypes?.length) setRankKeys([...prefs.rankTypes]);
    if (prefs.categories) setCategories([...prefs.categories]);
    if (typeof prefs.limit === "number") setLimit(clampLimit(prefs.limit));
  }, [prefsQuery.data]);

  // 本地持久化与服务端防抖更新
  useEffect(() => {
    saveLocalScanPrefs({ platform, rankKeys, categories, limit });
  }, [categories, limit, platform, rankKeys]);

  useEffect(() => {
    if (skipNextPrefsPut.current) {
      skipNextPrefsPut.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void fetchJson("/api/market/scan-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          rankTypes: rankKeys,
          categories,
          limit,
        }),
      }).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [categories, limit, platform, rankKeys]);

  // 拖动分栏宽度控制
  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplitter.current = true;
    const container = splitterContainerRef.current;
    if (!container) return;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingSplitter.current) return;
      const rect = container.getBoundingClientRect();
      const clientX = moveEvent.clientX;
      const newLeftPct = Math.round(((clientX - rect.left) / rect.width) * 100);
      const clamped = Math.min(75, Math.max(30, newLeftPct));
      setSplitRatio(clamped);
      saveSplitRatio(clamped);
    };

    const onMouseUp = () => {
      isDraggingSplitter.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  function toggleCategory(category: string) {
    setCategories((current) => (
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    ));
  }

  function selectAllCategories() {
    setCategories([...genreOptions]);
  }

  function clearAllCategories() {
    setCategories([]);
  }

  function invertCategories() {
    setCategories((current) => genreOptions.filter((g) => !current.includes(g)));
  }

  function addCustomGenre() {
    const value = customGenre.trim();
    if (!value) return;
    setCategories((current) => current.includes(value) ? current : [...current, value]);
    setCustomGenre("");
  }

  function toggleIntro(key: string) {
    setExpandedIntros((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function scanNow() {
    setScanning(true);
    setScanError(null);
    setScanSummary(null);
    try {
      const result = await fetchJson<{ ok: boolean; summary?: string; error?: string }>("/api/market/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          rankTypes: rankKeys.slice(0, 2),
          maxPages: pagesForLimit(limit),
          categories: categories.length > 0 ? categories : undefined,
          limit,
        }),
      });
      if (result.ok === false) {
        setScanError(result.summary ?? result.error ?? "这次没有扫到有效榜。");
      } else {
        setScanSummary(result.summary ?? "扫榜完成，已写入本机快照。");
      }
      await snapshotsQuery.refetch();
    } catch (error) {
      setScanError(errorText(error));
    } finally {
      setScanning(false);
    }
  }

  async function probeCustomRank() {
    if (!rankForm.url.trim()) {
      setRankError("请先输入榜单 URL 再探测");
      return;
    }
    setProbing(true);
    setProbeResult(null);
    setRankError(null);
    try {
      const res = await fetchJson<{ ok: boolean; sampleBooks?: RankRecord[]; error?: string }>("/api/market/ranks/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: rankForm.platform,
          url: rankForm.url.trim(),
        }),
      });
      setProbeResult(res);
      if (res.ok) {
        notify.success("探测成功", { description: `已解析出前 ${res.sampleBooks?.length ?? 0} 本书` });
      } else {
        notify.warning("探测未通过", { description: res.error });
      }
    } catch (error) {
      setRankError(errorText(error));
    } finally {
      setProbing(false);
    }
  }

  async function addCustomRank() {
    setRankBusy(true);
    setRankError(null);
    try {
      await fetchJson("/api/market/ranks/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: rankForm.platform,
          key: rankForm.key.trim(),
          name: rankForm.name.trim(),
          url: rankForm.url.trim(),
        }),
      });
      setRankForm({ platform: rankForm.platform, key: "", name: "", url: "" });
      setProbeResult(null);
      notify.success("自定义榜已保存");
      await ranksQuery.refetch();
    } catch (error) {
      setRankError(errorText(error));
    } finally {
      setRankBusy(false);
    }
  }

  async function removeCustomRank(key: string) {
    setRankBusy(true);
    setRankError(null);
    try {
      await fetchJson(`/api/market/ranks/custom/${encodeURIComponent(key)}`, { method: "DELETE" });
      setRankKeys((current) => current.filter((item) => item !== key));
      notify.success("已删除自定义榜");
      await ranksQuery.refetch();
    } catch (error) {
      setRankError(errorText(error));
    } finally {
      setRankBusy(false);
    }
  }

  async function persistLexicon(next: Record<string, string[]>) {
    setLexiconBusy(true);
    setLexiconError(null);
    try {
      await fetchJson("/api/market/lexicon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aliases: next }),
      });
      await lexiconQuery.refetch();
    } catch (error) {
      setLexiconError(errorText(error));
    } finally {
      setLexiconBusy(false);
    }
  }

  async function addLexiconAlias() {
    const canonical = lexiconCanonical.trim();
    const alias = lexiconAlias.trim();
    if (!canonical || !alias) return;
    const next: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(lexicon?.aliases ?? {})) next[key] = [...values];
    next[canonical] = [...new Set([...(next[canonical] ?? [canonical]), alias])];
    setLexiconAlias("");
    await persistLexicon(next);
  }

  async function removeLexiconAlias(canonical: string, alias: string) {
    const next: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(lexicon?.aliases ?? {})) {
      next[key] = key === canonical ? values.filter((item) => item !== alias) : [...values];
    }
    await persistLexicon(next);
  }

  async function sampleChapters(record: RankRecord) {
    setSampleBookId(record.book_id);
    setSampleBookTitle(record.title);
    setSampling(true);
    setSampleError(null);
    setSamples([]);
    try {
      const res = await fetchJson<{ ok: boolean; samples: PublicChapterSample[]; error?: string }>("/api/market/sample-public-chapters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fanqieBookId: record.book_id, maxChapters: 3 }),
      });
      if (res.ok) {
        setSamples(res.samples ?? []);
        notify.success(`《${record.title}》采样完成`, { description: `已提取 ${res.samples.length} 章黄金节奏指标` });
      } else {
        setSampleError(res.error || "采样失败");
      }
    } catch (error) {
      setSampleError(errorText(error));
    } finally {
      setSampling(false);
    }
  }

  const analysis = snapshotsQuery.data?.analysis;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4 overflow-auto p-6" data-testid="market-research-page">
      {/* 顶部标题栏 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <TrendingUp className="size-5 text-primary" />
            市场研究工作台
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            采集起点/番茄公开榜单，原始快照整批落盘于本地 `~/.novelfork/market/snapshots/`。支持题材自由配置、列宽拖拽、下钻外链与深度数据分析。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void scanNow()} disabled={scanning}>
            {scanning ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
            {scanning ? "正在扫榜…" : "扫一次并留存"}
          </Button>
        </div>
      </div>

      {/* 1. 扫榜配置卡片 */}
      <Card className="shrink-0">
        <CardHeader>
          <CardTitle>扫哪些榜与参数配置</CardTitle>
          <CardDescription>
            每次每平台最多 2 个榜。题材和保留数量在读取/导出时生效，原始抓取数据始终完整保存在本机，换题材随时看。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* 平台选择 */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">目标平台：</span>
            <div className="flex flex-wrap gap-2">
              {(["qidian", "fanqie", "all"] as const).map((item) => (
                <Button
                  key={item}
                  size="sm"
                  variant={platform === item ? "default" : "outline"}
                  onClick={() => {
                    setPlatform(item);
                    setRankKeys(defaultRankKeys(item));
                  }}
                >
                  {PLATFORM_LABEL[item]}
                </Button>
              ))}
            </div>
          </div>

          {/* 榜单选择 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">抓取榜单（至多选 2 个）：</span>
            {rankOptions.map((rank) => {
              const active = rankKeys.includes(rank.key);
              return (
                <Button
                  key={rank.key}
                  size="sm"
                  variant={active ? "secondary" : "ghost"}
                  onClick={() => {
                    setRankKeys((current) => {
                      if (current.includes(rank.key)) return current.filter((key) => key !== rank.key);
                      return [...current, rank.key].slice(-2);
                    });
                  }}
                >
                  {active ? <Check className="mr-1 size-3.5" /> : null}
                  {rank.name}
                </Button>
              );
            })}
          </div>

          {/* 题材自由配置 */}
          <div className="space-y-2 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">关注题材</span>
                <span className="text-xs text-muted-foreground">
                  （已选中 {categories.length} 个；空选为全题材）
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <Button type="button" size="xs" variant="ghost" onClick={selectAllCategories}>全选</Button>
                <Button type="button" size="xs" variant="ghost" onClick={clearAllCategories}>清空</Button>
                <Button type="button" size="xs" variant="ghost" onClick={invertCategories}>反选</Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5" data-testid="market-genre-options">
              {genreOptions.map((genre) => {
                const active = categories.includes(genre);
                return (
                  <Button
                    key={genre}
                    size="sm"
                    variant={active ? "secondary" : "outline"}
                    aria-pressed={active}
                    className="h-7 text-xs"
                    onClick={() => toggleCategory(genre)}
                  >
                    {active ? <Check className="mr-1 size-3" /> : null}
                    {genre}
                  </Button>
                );
              })}
            </div>

            {/* 自定义题材添加输入 */}
            <div className="flex max-w-md items-center gap-2 pt-1">
              <Input
                aria-label="自定义题材"
                value={customGenre}
                placeholder="输入任意自定义题材（回车快速加入）"
                onChange={(event) => setCustomGenre(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCustomGenre();
                  }
                }}
              />
              <Button type="button" size="sm" variant="outline" onClick={addCustomGenre}>
                <Plus className="mr-1 size-3.5" />
                添加
              </Button>
            </div>
          </div>

          {/* 条数配置快捷选择 */}
          <div className="flex flex-wrap items-center gap-4 border-t pt-3">
            <Field className="max-w-[200px]">
              <FieldLabel htmlFor="market-scan-limit">每榜保留本数：</FieldLabel>
              <Input
                id="market-scan-limit"
                aria-label="每个榜保留多少本"
                type="number"
                min={1}
                max={MAX_SCAN_LIMIT}
                value={limit}
                onChange={(event) => setLimit(clampLimit(Number(event.target.value)))}
              />
              <FieldDescription>1–{MAX_SCAN_LIMIT} 本，写入本机快照。</FieldDescription>
            </Field>

            <div className="flex items-center gap-1 self-end pb-3 text-xs">
              <span className="text-muted-foreground">快捷档位：</span>
              {[10, 20, 50, 100, 200].map((num) => (
                <Button
                  key={num}
                  type="button"
                  size="xs"
                  variant={limit === num ? "default" : "outline"}
                  onClick={() => setLimit(num)}
                >
                  {num} 本
                </Button>
              ))}
            </div>
          </div>

          {scanSummary ? <Alert data-testid="market-scan-summary"><AlertTitle>扫榜已完成</AlertTitle><AlertDescription>{scanSummary}</AlertDescription></Alert> : null}
          {scanError ? <Alert className="border-destructive/40" data-testid="market-scan-error"><AlertTitle>扫榜出现问题</AlertTitle><AlertDescription>{scanError}</AlertDescription></Alert> : null}
          {failedRanks.length > 0 ? (
            <Alert data-testid="market-rank-health">
              <AlertTitle>来源与时效状态</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 list-disc pl-5">
                  {failedRanks.map((rank) => (
                    <li key={`${rank.platform}-${rank.rankType}`}>{rank.reason}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {/* 2. 榜单管理与自定义探测 */}
      <Card className="shrink-0" data-testid="market-rank-manager">
        <CardHeader>
          <CardTitle>自定义榜单管理与链接探测</CardTitle>
          <CardDescription>内置榜为基座；可登记自己的榜单 URL（必须为起点或番茄同域）。保存前可随时点击「探测链接」验证解析正确性。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">内置官方榜：</span>
            {(ranksQuery.data?.qidian ?? []).map((rank) => (
              <Badge key={`qidian-${rank.key}`} variant="outline">起点 · {rank.name}</Badge>
            ))}
            {(ranksQuery.data?.fanqie ?? []).map((rank) => (
              <Badge key={`fanqie-${rank.key}`} variant="outline">番茄 · {rank.name}</Badge>
            ))}
          </div>

          <div className="grid gap-2 md:grid-cols-[120px_1fr_1fr_1.8fr_auto_auto]" data-testid="market-custom-rank-form">
            <select
              aria-label="自定义榜平台"
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              value={rankForm.platform}
              onChange={(event) => {
                const next = event.target.value as "qidian" | "fanqie";
                setRankForm((current) => ({ ...current, platform: next }));
              }}
            >
              <option value="qidian">起点 (qidian.com)</option>
              <option value="fanqie">番茄 (fanqienovel.com)</option>
            </select>
            <Input
              aria-label="自定义榜 key"
              placeholder="key（字母/数字/下划线）"
              value={rankForm.key}
              onChange={(event) => {
                const key = event.target.value;
                setRankForm((current) => ({ ...current, key }));
              }}
            />
            <Input
              aria-label="自定义榜名称"
              placeholder="榜单显示名"
              value={rankForm.name}
              onChange={(event) => {
                const name = event.target.value;
                setRankForm((current) => ({ ...current, name }));
              }}
            />
            <Input
              aria-label="自定义榜 URL"
              placeholder="https://www.qidian.com/rank/..."
              value={rankForm.url}
              onChange={(event) => {
                const url = event.target.value;
                setRankForm((current) => ({ ...current, url }));
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={probing || !rankForm.url.trim()}
              onClick={() => void probeCustomRank()}
            >
              {probing ? <LoaderCircle className="mr-1 size-3.5 animate-spin" /> : <Eye className="mr-1 size-3.5" />}
              探测链接
            </Button>
            <Button type="button" size="sm" disabled={rankBusy} onClick={() => void addCustomRank()}>
              <Plus className="mr-1 size-4" />
              添加榜
            </Button>
          </div>

          {/* 探测结果实时预览 */}
          {probeResult ? (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="flex items-center justify-between font-medium">
                <span>探测结果：{probeResult.ok ? "解析成功 ✅" : "解析未命中 ⚠️"}</span>
                {probeResult.error ? <span className="text-destructive">{probeResult.error}</span> : null}
              </div>
              {probeResult.sampleBooks && probeResult.sampleBooks.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {probeResult.sampleBooks.map((b, i) => (
                    <li key={b.book_id || i} className="text-muted-foreground">
                      第 {i + 1} 本：《{b.title}》· 作者：{b.author || "未知"} · 题材：{b.category || "未分类"}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {rankError ? <Alert className="border-destructive/40"><AlertTitle>榜单操作失败</AlertTitle><AlertDescription>{rankError}</AlertDescription></Alert> : null}

          {customRanks.length === 0 ? (
            <p className="text-xs text-muted-foreground">当前还没有自定义榜。添加并通过探测后，可直接在上方勾选抓取。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>平台</TableHead>
                  <TableHead>key</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>抓取 URL</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {customRanks.map((rank) => (
                  <TableRow key={rank.key}>
                    <TableCell><Badge variant="outline">{PLATFORM_LABEL[rank.platform]}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{rank.key}</TableCell>
                    <TableCell className="font-medium">{rank.name}</TableCell>
                    <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground" title={rank.url}>{rank.url}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        disabled={rankBusy}
                        aria-label={`删除自定义榜 ${rank.name}`}
                        onClick={() => void removeCustomRank(rank.key)}
                      >
                        <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 3. 题材词库管理 */}
      <Card className="shrink-0" data-testid="market-lexicon-manager">
        <CardHeader>
          <CardTitle>题材词库归一与别名管理</CardTitle>
          <CardDescription>
            三段式匹配规则：精确命中 &gt; 别名命中 &gt; 子串兜底。为标准题材扩充别名，防止因平台叫法不同漏算统计。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex max-w-2xl flex-wrap items-center gap-2">
            <Input
              aria-label="词库标准类目"
              placeholder="标准类目（如 诸天）"
              value={lexiconCanonical}
              onChange={(event) => setLexiconCanonical(event.target.value)}
            />
            <Input
              aria-label="词库别名"
              placeholder="新增别名（如 无限流）"
              value={lexiconAlias}
              onChange={(event) => setLexiconAlias(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addLexiconAlias();
                }
              }}
            />
            <Button type="button" size="sm" variant="outline" disabled={lexiconBusy} onClick={() => void addLexiconAlias()}>
              <Plus className="mr-1 size-3.5" />
              添加别名
            </Button>
          </div>

          {lexiconError ? <Alert className="border-destructive/40"><AlertTitle>词库未保存</AlertTitle><AlertDescription>{lexiconError}</AlertDescription></Alert> : null}

          <div className="flex flex-col gap-2.5">
            {lexiconEntries.map(([canonical, aliases]) => (
              <div key={canonical} className="flex flex-wrap items-center gap-1.5">
                <Badge className="font-medium">{canonical}</Badge>
                {aliases.filter((alias) => alias !== canonical).map((alias) => (
                  <Badge key={`${canonical}-${alias}`} variant="secondary" className="gap-1 pl-2 pr-1">
                    {alias}
                    <button
                      type="button"
                      disabled={lexiconBusy}
                      aria-label={`删除别名 ${alias}`}
                      className="rounded-full p-0.5 hover:bg-muted"
                      onClick={() => void removeLexiconAlias(canonical, alias)}
                    >
                      <Trash2 className="size-2.5 text-muted-foreground hover:text-destructive" />
                    </button>
                  </Badge>
                ))}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 4. 可拖拽分割布局：左侧快照列表 vs 右侧完整深度分析 */}
      <div
        ref={splitterContainerRef}
        className="relative flex min-h-[600px] w-full items-stretch overflow-hidden rounded-xl border bg-card shadow-sm"
        data-testid="market-splitter-container"
      >
        {/* 左栏：快照书单 */}
        <div
          className="flex min-w-[300px] flex-col overflow-auto p-4"
          style={{ width: `${splitRatio}%` }}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">最新公开榜单快照</h2>
              <p className="text-xs text-muted-foreground">
                共 {latestRecords.length} 本书{latestRecords[0] ? `（最近观察日 ${latestRecords[0].observed_at}）` : ""}
              </p>
            </div>

            {/* 即时搜索框 */}
            <div className="flex items-center gap-2">
              <div className="relative w-48">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  className="h-8 pl-8 text-xs"
                  placeholder="快速搜书名/作者/简介..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          </div>

          {latestRecords.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>未找到匹配的书籍快照</EmptyTitle>
                <EmptyDescription>
                  {searchQuery ? "可尝试清空搜索关键词或重置题材筛选" : "点右上角扫一次，结果会留在本机，下次打开还能看。"}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">排名</TableHead>
                    <TableHead className="w-44">作品名（点击直达官方）</TableHead>
                    <TableHead className="w-24">作者</TableHead>
                    <TableHead className="w-20">题材</TableHead>
                    <TableHead>简介（点击可展开全文）</TableHead>
                    <TableHead className="w-24">来源</TableHead>
                    <TableHead className="w-20">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latestRecords.map((record) => {
                    const rowKey = `${record.platform}-${record.rank_type}-${record.book_id}-${record.rank}`;
                    const targetUrl = bookUrl(record.platform, record.book_id);
                    const isExpanded = expandedIntros[rowKey] ?? false;

                    return (
                      <TableRow key={rowKey} className="group">
                        <TableCell className="font-mono text-xs font-semibold">{record.rank}</TableCell>
                        <TableCell>
                          {targetUrl ? (
                            <a
                              href={targetUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="flex items-center gap-1 font-medium text-primary hover:underline"
                              title={`去 ${PLATFORM_LABEL[record.platform]} 官方主页查看`}
                            >
                              <span className="truncate">{record.title}</span>
                              <ExternalLink className="size-3 shrink-0 opacity-60 group-hover:opacity-100" />
                            </a>
                          ) : (
                            <span className="font-medium">{record.title}</span>
                          )}
                          {record.word_count ? (
                            <span className="text-[10px] text-muted-foreground">
                              {record.word_count > 10000 ? `${(record.word_count / 10000).toFixed(1)}万字` : `${record.word_count}字`}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">{record.author || "—"}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-[10px]">{record.category || "未分类"}</Badge></TableCell>
                        <TableCell className="text-xs">
                          {record.intro?.trim() ? (
                            <div
                              role="button"
                              tabIndex={0}
                              className="cursor-pointer select-text rounded p-1 hover:bg-muted/50"
                              onClick={() => toggleIntro(rowKey)}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleIntro(rowKey); }}
                              title="点击展开/收起完整简介"
                            >
                              <p className={isExpanded ? "whitespace-pre-wrap leading-relaxed" : "line-clamp-2 text-muted-foreground"}>
                                {record.intro}
                              </p>
                              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-primary">
                                {isExpanded ? (
                                  <><span>收起</span><ChevronUp className="size-3" /></>
                                ) : (
                                  <><span>展开完整简介</span><ChevronDown className="size-3" /></>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">{record.source}</Badge>
                        </TableCell>
                        <TableCell>
                          {record.platform === "fanqie" ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              className="h-6 gap-1 px-1.5 text-[10px]"
                              title="采样分析公开前 3 章结构指标"
                              onClick={() => void sampleChapters(record)}
                            >
                              <Sparkles className="size-3 text-amber-500" />
                              采样
                            </Button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* 自由拖动 Divider 分割线手柄 */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={splitRatio}
          tabIndex={0}
          title="左右拖动调整宽度；双击重置为 60:40"
          className="group relative flex w-2.5 cursor-col-resize select-none items-center justify-center bg-border/40 hover:bg-primary/20 active:bg-primary/40"
          onMouseDown={handleSplitterMouseDown}
          onDoubleClick={() => {
            setSplitRatio(60);
            saveSplitRatio(60);
          }}
        >
          <div className="h-8 w-1 rounded-full bg-muted-foreground/40 transition-colors group-hover:bg-primary" />
        </div>

        {/* 右栏：真实完整 Markdown 深度市场分析 */}
        <div
          className="flex min-w-[280px] flex-1 flex-col overflow-auto bg-muted/10 p-4"
          data-testid="market-analysis-panel"
        >
          <div className="mb-3 flex items-center justify-between border-b pb-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="size-4 text-primary" />
              <h2 className="text-base font-semibold">市场深度分析报告</h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{analysis?.summary.total_books ?? 0} 本书</span>
              <span>·</span>
              <span>{analysis?.summary.total_snapshots ?? 0} 份快照</span>
            </div>
          </div>

          {analysis?.markdown ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <MarkdownRenderer content={analysis.markdown} />
            </div>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
              <BarChart3 className="size-8 stroke-1 opacity-40" />
              <p className="text-xs">暂无深度分析数据。请先执行一次有效扫榜。</p>
            </div>
          )}
        </div>
      </div>

      {/* 5. 快速采样弹层抽屉（番茄前 3 章结构指标） */}
      {sampleBookId ? (
        <Card className="shrink-0 border-primary/40 bg-card/95 shadow-md">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base">《{sampleBookTitle}》公开前 3 章结构采样</CardTitle>
              <CardDescription>提取对话比例、问句感叹句频次、金手指/系统词命中与黄金节奏</CardDescription>
            </div>
            <Button size="xs" variant="outline" onClick={() => setSampleBookId(null)}>关闭</Button>
          </CardHeader>
          <CardContent>
            {sampling ? (
              <div className="flex items-center justify-center p-8 text-xs text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                正在采样公开免费前 3 章结构指标，请稍候…
              </div>
            ) : sampleError ? (
              <Alert className="border-destructive/40"><AlertTitle>采样失败</AlertTitle><AlertDescription>{sampleError}</AlertDescription></Alert>
            ) : samples.length === 0 ? (
              <p className="text-xs text-muted-foreground">未提取到章节采样数据</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                {samples.map((s, idx) => (
                  <div key={s.chapter_id || idx} className="rounded-lg border bg-muted/20 p-3 text-xs">
                    <p className="font-semibold text-foreground">第 {idx + 1} 章：{s.title}</p>
                    <div className="mt-2 space-y-1 text-muted-foreground">
                      <div>字数：{s.chapter_word_count} 字 · 段落：{s.paragraph_count}</div>
                      <div>对话比：{(s.dialogue_ratio * 100).toFixed(1)}%</div>
                      <div>问叹句：问号 {s.question_mark_count} / 感叹号 {s.exclamation_mark_count}</div>
                      <div>金手指命中：{s.golden_finger_hits} 次 · 冲突词：{s.conflict_word_hits} 次</div>
                      {s.structural_summary ? (
                        <p className="mt-2 rounded bg-background p-1.5 text-[11px] leading-relaxed text-foreground">
                          {s.structural_summary}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
