import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Plus, Trash2, TrendingUp } from "lucide-react";

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

const PLATFORM_LABEL: Record<string, string> = {
  qidian: "起点",
  fanqie: "番茄",
  all: "起点 + 番茄",
};

const MARKET_SCAN_PREFS_KEY = "novelfork.market.scan-prefs";
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
    // private mode / restricted storage
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
  const [rankForm, setRankForm] = useState({
    platform: "qidian" as "qidian" | "fanqie",
    key: "",
    name: "",
    url: "",
  });
  const [rankBusy, setRankBusy] = useState(false);
  const [rankError, setRankError] = useState<string | null>(null);
  const [lexiconCanonical, setLexiconCanonical] = useState("");
  const [lexiconAlias, setLexiconAlias] = useState("");
  const [lexiconBusy, setLexiconBusy] = useState(false);
  const [lexiconError, setLexiconError] = useState<string | null>(null);
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
          .map((record) => ({ ...record, source }));
      })
      .sort((a, b) => a.rank - b.rank)
      .slice(0, limit);
  }, [categories, healthByKey, latestSnapshots, lexicon, limit]);
  const failedRanks = ranks.filter((rank) => rank.health !== "ok");
  const lexiconEntries = useMemo(() => (
    Object.entries(lexicon?.aliases ?? {}).sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
  ), [lexicon]);

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

  function toggleCategory(category: string) {
    setCategories((current) => (
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    ));
  }

  function addCustomGenre() {
    const value = customGenre.trim();
    if (!value) return;
    setCategories((current) => current.includes(value) ? current : [...current, value]);
    setCustomGenre("");
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

  const analysis = snapshotsQuery.data?.analysis;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-auto p-6" data-testid="market-research-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <TrendingUp className="size-5" />
            市场研究
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            扫描起点/番茄公开榜单，结果会留在本机 ~/.novelfork/market/snapshots/，不写经纬。不用 Agent 也能自己看。
          </p>
        </div>
        <Button onClick={() => void scanNow()} disabled={scanning}>
          {scanning ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
          {scanning ? "扫榜中…" : "扫一次并留存"}
        </Button>
      </div>

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle>扫哪些榜</CardTitle>
          <CardDescription>每次每平台最多 2 个榜。题材和本数只过滤返回视图，原始快照整批留在本机，换偏好不必重新爬。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
          <div className="flex flex-wrap gap-2">
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
                  {rank.name}
                </Button>
              );
            })}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">题材</p>
            <p className="text-xs text-muted-foreground">不选就是全部题材。选了以后按词库精确/别名/子串过滤当前快照，不改落盘文件。</p>
            <div className="flex flex-wrap gap-2" data-testid="market-genre-options">
              {genreOptions.map((genre) => {
                const active = categories.includes(genre);
                return (
                  <Button
                    key={genre}
                    size="sm"
                    variant={active ? "secondary" : "outline"}
                    aria-pressed={active}
                    onClick={() => toggleCategory(genre)}
                  >
                    {genre}
                  </Button>
                );
              })}
            </div>
            <div className="flex max-w-md items-center gap-2">
              <Input
                aria-label="自定义题材"
                value={customGenre}
                placeholder="自定义题材，回车添加"
                onChange={(event) => setCustomGenre(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCustomGenre();
                  }
                }}
              />
              <Button type="button" size="sm" variant="outline" onClick={addCustomGenre}>
                添加
              </Button>
            </div>
          </div>
          <Field className="max-w-[220px]">
            <FieldLabel htmlFor="market-scan-limit">每个榜保留多少本</FieldLabel>
            <Input
              id="market-scan-limit"
              aria-label="每个榜保留多少本"
              type="number"
              min={1}
              max={MAX_SCAN_LIMIT}
              value={limit}
              onChange={(event) => setLimit(clampLimit(Number(event.currentTarget.value)))}
            />
            <FieldDescription>1–{MAX_SCAN_LIMIT} 本。简介会一起写入本机快照。</FieldDescription>
          </Field>
          {scanSummary ? <Alert data-testid="market-scan-summary"><AlertTitle>已留存</AlertTitle><AlertDescription>{scanSummary}</AlertDescription></Alert> : null}
          {scanError ? <Alert className="border-destructive/40" data-testid="market-scan-error"><AlertTitle>扫榜失败</AlertTitle><AlertDescription>{scanError}</AlertDescription></Alert> : null}
          {failedRanks.length > 0 ? (
            <Alert data-testid="market-rank-health">
              <AlertTitle>来源与时效</AlertTitle>
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

      <Card className="shrink-0" data-testid="market-rank-manager">
        <CardHeader>
          <CardTitle>榜单管理</CardTitle>
          <CardDescription>内置榜只读。自定义榜必须指向起点或番茄同域 URL，不能拿来抓外站。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {(ranksQuery.data?.qidian ?? []).map((rank) => (
              <Badge key={`qidian-${rank.key}`} variant="outline">起点 · {rank.name}</Badge>
            ))}
            {(ranksQuery.data?.fanqie ?? []).map((rank) => (
              <Badge key={`fanqie-${rank.key}`} variant="outline">番茄 · {rank.name}</Badge>
            ))}
          </div>
          <div className="grid gap-2 md:grid-cols-[120px_1fr_1fr_1.4fr_auto]" data-testid="market-custom-rank-form">
            <select
              aria-label="自定义榜平台"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={rankForm.platform}
              onChange={(event) => {
                const next = event.target.value as "qidian" | "fanqie";
                setRankForm((current) => ({ ...current, platform: next }));
              }}
            >
              <option value="qidian">起点</option>
              <option value="fanqie">番茄</option>
            </select>
            <Input
              aria-label="自定义榜 key"
              placeholder="key，如 male_collect"
              value={rankForm.key}
              onChange={(event) => {
                const key = event.target.value;
                setRankForm((current) => ({ ...current, key }));
              }}
            />
            <Input
              aria-label="自定义榜名称"
              placeholder="显示名"
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
            <Button type="button" size="sm" disabled={rankBusy} onClick={() => void addCustomRank()}>
              <Plus className="mr-1 size-4" />
              添加榜
            </Button>
          </div>
          {rankError ? <Alert className="border-destructive/40"><AlertTitle>榜单未保存</AlertTitle><AlertDescription>{rankError}</AlertDescription></Alert> : null}
          {customRanks.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有自定义榜。加上以后可以直接勾选去扫。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>平台</TableHead>
                  <TableHead>key</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {customRanks.map((rank) => (
                  <TableRow key={rank.key}>
                    <TableCell>{PLATFORM_LABEL[rank.platform]}</TableCell>
                    <TableCell className="font-mono text-xs">{rank.key}</TableCell>
                    <TableCell>{rank.name}</TableCell>
                    <TableCell className="max-w-[280px] truncate text-muted-foreground">{rank.url}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={rankBusy}
                        aria-label={`删除自定义榜 ${rank.name}`}
                        onClick={() => void removeCustomRank(rank.key)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="shrink-0" data-testid="market-lexicon-manager">
        <CardHeader>
          <CardTitle>题材词库</CardTitle>
          <CardDescription>精确类目和别名优先，对不上才用子串兜底。这里改完，扫榜和当前快照一起用。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex max-w-2xl flex-wrap items-center gap-2">
            <Input
              aria-label="词库标准类目"
              placeholder="标准类目，如 诸天"
              value={lexiconCanonical}
              onChange={(event) => setLexiconCanonical(event.target.value)}
            />
            <Input
              aria-label="词库别名"
              placeholder="别名，如 无限"
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
              添加别名
            </Button>
          </div>
          {lexiconError ? <Alert className="border-destructive/40"><AlertTitle>词库未保存</AlertTitle><AlertDescription>{lexiconError}</AlertDescription></Alert> : null}
          <div className="flex flex-col gap-3">
            {lexiconEntries.map(([canonical, aliases]) => (
              <div key={canonical} className="flex flex-wrap items-center gap-2">
                <Badge>{canonical}</Badge>
                {aliases.filter((alias) => alias !== canonical).map((alias) => (
                  <Button
                    key={`${canonical}-${alias}`}
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={lexiconBusy}
                    aria-label={`删除别名 ${alias}`}
                    onClick={() => void removeLexiconAlias(canonical, alias)}
                  >
                    {alias}
                    <Trash2 className="ml-1 size-3" />
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid shrink-0 gap-4 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardHeader>
            <CardTitle>最新快照</CardTitle>
            <CardDescription>
              {latestRecords.length > 0
                ? `只展示仍算最新的有效榜，共 ${latestRecords.length} 本${latestRecords[0] ? `，最近观察日 ${latestRecords[0].observed_at}` : ""}`
                : failedRanks.length > 0
                  ? "最近一次扫榜没有仍算最新的有效榜，不能拿旧快照当今天的市场结论。"
                  : `${snapshotsQuery.data?.snapshots.length ?? 0} 份历史快照`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {latestRecords.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>还没有快照</EmptyTitle>
                  <EmptyDescription>点右上角扫一次，结果会留在本机，下次打开还能看。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>排名</TableHead>
                    <TableHead>书名</TableHead>
                    <TableHead>作者</TableHead>
                    <TableHead>题材</TableHead>
                    <TableHead>简介</TableHead>
                    <TableHead>来源</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latestRecords.map((record) => (
                    <TableRow key={`${record.platform}-${record.rank_type}-${record.book_id}-${record.rank}`}>
                      <TableCell>{record.rank}</TableCell>
                      <TableCell className="font-medium">{record.title}</TableCell>
                      <TableCell>{record.author || "—"}</TableCell>
                      <TableCell>{record.category || "未分类"}</TableCell>
                      <TableCell className="max-w-[280px] text-muted-foreground">
                        <p className="line-clamp-2" title={record.intro || undefined}>
                          {record.intro?.trim() || "—"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{record.source}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>题材摘要</CardTitle>
            <CardDescription>基于仍算最新的有效快照，不是实时网页。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div>书籍 {analysis?.summary.total_books ?? 0} 本</div>
            <div>快照 {analysis?.summary.total_snapshots ?? 0} 份</div>
            <div className="flex flex-wrap gap-1">
              {(analysis?.summary.top_categories ?? []).map((category) => (
                <Badge key={category} variant="secondary">{category}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
