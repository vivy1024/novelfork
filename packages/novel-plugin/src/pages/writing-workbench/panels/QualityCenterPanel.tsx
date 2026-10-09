/**
 * F2 · 质量中心 —— 质量类面板的单一权威入口（IA 收敛）。
 *
 * 各分区回答一个问题，互不重叠：
 * - 📈 趋势：近 20 章质量/AI味/漂移走势（/quality-trend，唯一图表区）
 * - 📊 指标：全书四项健康指标卡（/health 唯一挂载点，原「全书健康」并入）
 * - 🩺 一致性体检：经纬设定 ↔ 叙事记忆纰漏（原「叙事体检」并入）
 *
 * 编辑收敛纪律不适用本面板——三个分区都是只读展示/主动检测，无写操作。
 *
 * 「文风检测」分区已下线：检测需要真实正文输入，此入口没有正文源，
 * 挂载 StyleDriftPanel 时展示的是空文本算出的伪造对比。组件文件保留，
 * 等能接上当前章正文（chapterContent）的入口再恢复。
 */

import { useState } from "react";
import { BarChart3, Gauge, Stethoscope, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { QualityPanel } from "./QualityPanel";
import { BookHealthSummary } from "../BookHealthSummary";
import { NarrativeConsistencyPanel } from "../NarrativeConsistencyPanel";

export interface QualityCenterPanelProps {
  readonly bookId: string;
  /** 只体检到这一章为止（透传一致性体检）。 */
  readonly currentChapter?: number;
  /** 一致性体检 findings 点击跳章。 */
  readonly onJumpToChapter?: (chapterNumber: number) => void;
  /** 一致性体检条目点击跳经纬卡。 */
  readonly onOpenJingweiEntry?: (entryId: string) => boolean;
}

type QualityTabId = "trend" | "metrics" | "consistency";

interface QualityTabDef {
  readonly id: QualityTabId;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

const QUALITY_TABS: readonly QualityTabDef[] = [
  { id: "trend", label: "趋势", description: "近 20 章质量与 AI 味走势", icon: BarChart3 },
  { id: "metrics", label: "指标", description: "全书健康四指标", icon: Gauge },
  { id: "consistency", label: "一致性体检", description: "设定与记忆的纰漏排查", icon: Stethoscope },
];

export function QualityCenterPanel({ bookId, currentChapter, onJumpToChapter, onOpenJingweiEntry }: QualityCenterPanelProps) {
  const [activeTab, setActiveTab] = useState<QualityTabId>("trend");

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="quality-center-panel">
      <nav
        className="flex flex-wrap items-center gap-1 border-b px-3 py-2"
        role="tablist"
        aria-label="质量中心分区"
      >
        {QUALITY_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <Button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              title={tab.description}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "h-7 gap-1 rounded px-2 text-xs transition-colors",
                active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3" /> {tab.label}
            </Button>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === "trend" && (
          <div data-testid="quality-center-trend">
            <QualityPanel bookId={bookId} />
          </div>
        )}
        {activeTab === "metrics" && (
          <div data-testid="quality-center-metrics">
            <BookHealthSummary bookId={bookId} />
          </div>
        )}
        {activeTab === "consistency" && (
          <div data-testid="quality-center-consistency">
            <NarrativeConsistencyPanel
              bookId={bookId}
              currentChapter={currentChapter}
              onJumpToChapter={onJumpToChapter}
              onOpenJingweiEntry={onOpenJingweiEntry}
            />
          </div>
        )}
      </div>
    </div>
  );
}
