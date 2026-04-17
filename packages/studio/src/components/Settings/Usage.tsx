import { useEffect, useState } from "react";
import { BarChart3, TrendingUp, Clock } from "lucide-react";

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
    // 模拟统计数据（实际应从 API 获取）
    setStats({
      totalWords: 125000,
      totalChapters: 42,
      avgWordsPerDay: 3500,
      totalEditTime: 86400,
    });
  }, []);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-xl font-semibold mb-4 text-foreground">使用统计</h3>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* 总字数 */}
        <div className="p-4 rounded-lg border border-border bg-background/50">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">总字数</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{stats.totalWords.toLocaleString()}</p>
        </div>

        {/* 总章节数 */}
        <div className="p-4 rounded-lg border border-border bg-background/50">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">总章节</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{stats.totalChapters}</p>
        </div>

        {/* 日均字数 */}
        <div className="p-4 rounded-lg border border-border bg-background/50">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">日均字数</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{stats.avgWordsPerDay.toLocaleString()}</p>
        </div>

        {/* 总编辑时长 */}
        <div className="p-4 rounded-lg border border-border bg-background/50">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">编辑时长</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{formatTime(stats.totalEditTime)}</p>
        </div>
      </div>
    </div>
  );
}
