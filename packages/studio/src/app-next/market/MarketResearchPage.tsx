import { useMemo, useState } from "react";
import { LoaderCircle, TrendingUp } from "lucide-react";

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
import { fetchJson } from "@/lib/api-client";
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

const PLATFORM_LABEL: Record<string, string> = {
  qidian: "起点",
  fanqie: "番茄",
  all: "起点 + 番茄",
};

export function MarketResearchPage() {
  const [platform, setPlatform] = useState<"all" | "qidian" | "fanqie">("qidian");
  const ranksQuery = useApi<{ qidian: RankConfig[]; fanqie: RankConfig[] }>("/market/ranks");
  const snapshotsQuery = useApi<SnapshotQuery>("/market/snapshots?analyze=true");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSummary, setScanSummary] = useState<string | null>(null);

  const rankOptions = useMemo(() => {
    const qidian = ranksQuery.data?.qidian ?? [];
    const fanqie = ranksQuery.data?.fanqie ?? [];
    if (platform === "qidian") return qidian;
    if (platform === "fanqie") return fanqie;
    return [...qidian, ...fanqie];
  }, [platform, ranksQuery.data]);

  const [rankKeys, setRankKeys] = useState<string[]>(["newbook"]);

  const ranks = snapshotsQuery.data?.ranks ?? [];
  const latestSnapshots = snapshotsQuery.data?.latest ?? [];
  const healthByKey = useMemo(() => {
    const map = new Map<string, RankScanReport>();
    for (const rank of ranks) map.set(`${rank.platform}-${rank.rankType}`, rank);
    return map;
  }, [ranks]);
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
          .map((record) => ({ ...record, source }));
      })
      .sort((a, b) => a.rank - b.rank);
  }, [healthByKey, latestSnapshots]);
  const failedRanks = ranks.filter((rank) => rank.health !== "ok");

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
          maxPages: 1,
        }),
      });
      if (result.ok === false) {
        setScanError(result.summary ?? result.error ?? "这次没有扫到有效榜。");
      } else {
        setScanSummary(result.summary ?? "扫榜完成，已写入本机快照。");
      }
      await snapshotsQuery.refetch();
    } catch (error) {
      setScanError(error instanceof Error ? error.message : String(error));
    } finally {
      setScanning(false);
    }
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

      <Card>
        <CardHeader>
          <CardTitle>扫哪些榜</CardTitle>
          <CardDescription>每次每平台最多 2 个榜，公开数据，不登录。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {(["qidian", "fanqie", "all"] as const).map((item) => (
              <Button
                key={item}
                size="sm"
                variant={platform === item ? "default" : "outline"}
                onClick={() => {
                  setPlatform(item);
                  setRankKeys(item === "fanqie" ? ["male_read"] : ["newbook"]);
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

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
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
                    <TableHead>来源</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latestRecords.slice(0, 40).map((record) => (
                    <TableRow key={`${record.platform}-${record.rank_type}-${record.book_id}-${record.rank}`}>
                      <TableCell>{record.rank}</TableCell>
                      <TableCell className="font-medium">{record.title}</TableCell>
                      <TableCell>{record.author || "—"}</TableCell>
                      <TableCell>{record.category || "未分类"}</TableCell>
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
