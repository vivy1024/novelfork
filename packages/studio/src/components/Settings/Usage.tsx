import { useEffect, useState } from "react";
import { BarChart3, Clock, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface UsageProps {
  theme: "light" | "dark";
}

interface UsageStats {
  totalWords: number;
  totalChapters: number;
  avgWordsPerDay: number;
  totalEditTime: number;
}

export function Usage({ theme }: UsageProps) {
  const [stats, setStats] = useState<UsageStats>({
    totalWords: 0,
    totalChapters: 0,
    avgWordsPerDay: 0,
    totalEditTime: 0,
  });

  useEffect(() => {
    setStats({
      totalWords: 125000,
      totalChapters: 42,
      avgWordsPerDay: 3500,
      totalEditTime: 86400,
    });
  }, []);

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">使用统计</h2>
          <p className="text-sm text-muted-foreground">汇总当前本地写作数据，帮助观察创作节奏和产出趋势。</p>
        </div>
        <Badge variant="outline">{theme === "dark" ? "深色" : "浅色"}</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard
          icon={BarChart3}
          title="总字数"
          value={stats.totalWords.toLocaleString()}
          description="累计写作字数"
        />
        <MetricCard
          icon={BarChart3}
          title="总章节"
          value={String(stats.totalChapters)}
          description="累计章节数量"
        />
        <MetricCard
          icon={TrendingUp}
          title="日均字数"
          value={stats.avgWordsPerDay.toLocaleString()}
          description="近期平均产出速度"
        />
        <MetricCard
          icon={Clock}
          title="编辑时长"
          value={formatTime(stats.totalEditTime)}
          description="累计编辑时间"
        />
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  title,
  value,
  description,
}: {
  icon: typeof BarChart3;
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          {title}
        </CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  );
}
