/**
 * RhythmChart — Tab 3: 节奏波形图
 * 占位符组件，显示"节奏分析功能开发中"
 */

import { Activity, TrendingUp, BarChart3 } from "lucide-react";

interface RhythmChartProps {
  readonly bookId: string;
}

export function RhythmChart({ bookId }: RhythmChartProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50 space-y-4">
      {/* 图标组 */}
      <div className="flex items-center gap-4">
        <Activity size={32} className="opacity-40 animate-pulse" />
        <TrendingUp size={32} className="opacity-40 animate-pulse" style={{ animationDelay: "0.2s" }} />
        <BarChart3 size={32} className="opacity-40 animate-pulse" style={{ animationDelay: "0.4s" }} />
      </div>

      {/* 主标题 */}
      <div className="text-center space-y-2">
        <h3 className="text-lg font-medium text-foreground/70">节奏分析功能开发中</h3>
        <p className="text-xs text-muted-foreground max-w-md">
          即将推出：章节节奏波形图、情绪张力曲线、场景类型分布、标题多样性分析等功能
        </p>
      </div>

      {/* 功能预告 */}
      <div className="grid grid-cols-2 gap-3 mt-6 max-w-lg">
        <FeatureCard
          icon={<Activity size={16} />}
          title="节奏波形"
          description="可视化章节节奏起伏"
        />
        <FeatureCard
          icon={<TrendingUp size={16} />}
          title="张力曲线"
          description="追踪情绪张力变化"
        />
        <FeatureCard
          icon={<BarChart3 size={16} />}
          title="场景分布"
          description="分析场景类型占比"
        />
        <FeatureCard
          icon={<Activity size={16} />}
          title="压力预警"
          description="识别节奏疲劳点"
        />
      </div>

      {/* 底部提示 */}
      <div className="text-[10px] text-muted-foreground/40 mt-8">
        Phase 3 功能 · 敬请期待
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="border border-border/40 rounded-lg p-3 bg-secondary/20">
      <div className="flex items-center gap-2 mb-1">
        <div className="text-primary/60">{icon}</div>
        <span className="text-xs font-medium text-foreground/70">{title}</span>
      </div>
      <p className="text-[10px] text-muted-foreground/60">{description}</p>
    </div>
  );
}
