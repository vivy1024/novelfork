import { BookOpenText, GitBranch, MonitorCog, Rocket, Sparkles } from "lucide-react";

import { useApi } from "@/hooks/use-api";
import type { StudioReleaseSnapshot } from "@/shared/release-manifest";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface ReleaseOverviewProps {
  readonly variant?: "status" | "about";
}

export function ReleaseOverview({ variant = "about" }: ReleaseOverviewProps) {
  const { data, loading, error } = useApi<StudioReleaseSnapshot>("/settings/release");

  if (loading) {
    return <div className="text-sm text-muted-foreground">正在整理当前版本与更新节奏…</div>;
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
        {error ? `暂时无法读取版本信息：${error}` : "暂时无法读取版本信息。"}
      </div>
    );
  }

  const intro = variant === "status"
    ? "先确认你手上的工作台来自哪套构建、适合走哪个更新节奏，再决定要不要升级。"
    : data.summary;

  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Rocket className="size-5 text-primary" />
                {data.appName}
              </CardTitle>
              <CardDescription>{intro}</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {data.channels.map((channel) => (
                <Badge key={channel.id} variant={channel.current ? "default" : "outline"}>
                  {channel.label}
                </Badge>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FactCard
              icon={Sparkles}
              label="当前版本"
              value={`v${data.version}`}
              description="用于确认你正在使用哪一版写作工作台。"
            />
            <FactCard
              icon={MonitorCog}
              label="运行时"
              value={data.runtimeLabel}
              description={`底层标识：${data.runtime}`}
            />
            <FactCard
              icon={Rocket}
              label="构建来源"
              value={data.buildLabel}
              description={`来源标识：${data.buildSource}`}
            />
            <FactCard
              icon={GitBranch}
              label="构建摘要"
              value={data.commit ? data.commit : "未写入"}
              description={data.commit ? "可用于和日志、发布记录对照。" : "当前构建没有安全可读的 commit 信息。"}
            />
          </div>

          <Separator />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <Card size="sm" className="border-dashed">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpenText className="size-4 text-primary" />
                  作者向更新日志
                </CardTitle>
                <CardDescription>重点解释这版会影响什么写作体验，而不只是底层技术字段。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                {data.changelog.map((entry, index) => (
                  <div key={entry.title} className="space-y-2">
                    <div>
                      <p className="font-medium text-foreground">{entry.title}</p>
                      <p className="text-sm text-muted-foreground">{entry.summary}</p>
                    </div>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {entry.highlights.map((highlight) => (
                        <li key={highlight}>{highlight}</li>
                      ))}
                    </ul>
                    {index < data.changelog.length - 1 && <Separator className="mt-4" />}
                  </div>
                ))}
                <div>
                  <a
                    href={data.changelogUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 items-center justify-center rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    查看完整 changelog
                  </a>
                </div>
              </CardContent>
            </Card>

            <Card size="sm" className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">更新通道</CardTitle>
                <CardDescription>先把节奏讲清楚，后续再把自动更新策略正式接上。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {data.channels.map((channel) => (
                  <div key={channel.id} className="rounded-xl border border-border/70 bg-muted/20 px-3 py-3">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{channel.label}</p>
                      <Badge variant={channel.current ? "default" : "outline"}>
                        {channel.current ? "当前" : channel.available ? "可选" : "占位"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{channel.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FactCard({
  icon: Icon,
  label,
  value,
  description,
}: {
  readonly icon: typeof Sparkles;
  readonly label: string;
  readonly value: string;
  readonly description: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4 text-primary" />
        <span>{label}</span>
      </div>
      <p className="mt-3 text-base font-semibold text-foreground break-all">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
