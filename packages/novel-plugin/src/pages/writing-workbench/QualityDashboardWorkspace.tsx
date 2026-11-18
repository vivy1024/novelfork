/**
 * 中间全宽「质检与分析大盘」（QualityDashboardWorkspace）
 *
 * 将原本被压在左栏底部折叠抽屉里的全书级质检与分析工具升格为中间全宽工作台：
 * - 质量大盘（近 20 章趋势、全书健康四指标、一致性体检）
 * - 张力曲线（点击柱子直接跳对应章节信纸）
 * - 角色弧线
 * - 投稿风控自检
 * - 叙事治理驾驶舱
 * - 故事状态总览与协作版本
 */

import { lazy, Suspense, useState } from "react";
import {
  Activity,
  FileCheck2,
  History,
  Layers,
  Loader2,
  SlidersHorizontal,
  Stethoscope,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { GovernanceCockpitPanel } from "./GovernanceCockpitPanel";
import { QualityCenterPanel } from "./panels/QualityCenterPanel";

const TensionCurvePanel = lazy(() => import("./TensionCurvePanel").then((m) => ({ default: m.TensionCurvePanel })));
const CharacterArcsPanel = lazy(() => import("./CharacterArcsPanel").then((m) => ({ default: m.CharacterArcsPanel })));
const CompliancePanel = lazy(() => import("./CompliancePanel").then((m) => ({ default: m.CompliancePanel })));
const RuntimeStatePanel = lazy(() => import("./RuntimeStatePanel").then((m) => ({ default: m.RuntimeStatePanel })));
const CollaborationVersionPanel = lazy(() => import("./CollaborationVersionPanel").then((m) => ({ default: m.CollaborationVersionPanel })));

export type QualityDashboardTabId =
  | "quality"
  | "tension"
  | "arcs"
  | "compliance"
  | "governance"
  | "runtime"
  | "version";

export interface QualityDashboardWorkspaceProps {
  readonly bookId: string;
  readonly bookPlatform?: string;
  readonly repositoryPath?: string;
  readonly currentChapter?: number;
  readonly initialTab?: QualityDashboardTabId;
  readonly onJumpToChapter?: (chapterNumber: number) => void;
  readonly onOpenJingweiEntry?: (entryId: string) => boolean;
}

const DASHBOARD_TABS: readonly {
  readonly id: QualityDashboardTabId;
  readonly label: string;
  readonly icon: LucideIcon;
}[] = [
  { id: "quality", label: "质量中心与一致性", icon: SlidersHorizontal },
  { id: "tension", label: "张力曲线", icon: Activity },
  { id: "arcs", label: "角色弧线", icon: Waypoints },
  { id: "compliance", label: "投稿风险自检", icon: FileCheck2 },
  { id: "governance", label: "全书治理体检", icon: Stethoscope },
  { id: "runtime", label: "故事状态总览", icon: Layers },
  { id: "version", label: "协作与版本", icon: History },
];

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
      <Loader2 className="mr-2 size-4 animate-spin" />
      加载分析面板中…
    </div>
  );
}

export function QualityDashboardWorkspace({
  bookId,
  bookPlatform,
  repositoryPath,
  currentChapter,
  initialTab = "quality",
  onJumpToChapter,
  onOpenJingweiEntry,
}: QualityDashboardWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<QualityDashboardTabId>(initialTab);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="quality-dashboard-workspace">
      <nav
        className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-card/70 px-4 py-2"
        role="tablist"
        aria-label="全书质检与分析大盘"
      >
        {DASHBOARD_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`quality-dashboard-tab-${tab.id}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
                active
                  ? "bg-primary/12 font-semibold text-primary shadow-2xs"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-[1160px]">
          {activeTab === "quality" ? (
            <QualityCenterPanel
              bookId={bookId}
              currentChapter={currentChapter}
              onJumpToChapter={onJumpToChapter}
              onOpenJingweiEntry={onOpenJingweiEntry}
            />
          ) : null}
          {activeTab === "tension" ? (
            <Suspense fallback={<LoadingFallback />}>
              <TensionCurvePanel bookId={bookId} onJumpToChapter={onJumpToChapter} />
            </Suspense>
          ) : null}
          {activeTab === "arcs" ? (
            <Suspense fallback={<LoadingFallback />}>
              <CharacterArcsPanel bookId={bookId} />
            </Suspense>
          ) : null}
          {activeTab === "compliance" ? (
            <Suspense fallback={<LoadingFallback />}>
              <CompliancePanel bookId={bookId} bookPlatform={bookPlatform} />
            </Suspense>
          ) : null}
          {activeTab === "governance" ? (
            <GovernanceCockpitPanel bookId={bookId} />
          ) : null}
          {activeTab === "runtime" ? (
            <Suspense fallback={<LoadingFallback />}>
              <RuntimeStatePanel bookId={bookId} />
            </Suspense>
          ) : null}
          {activeTab === "version" ? (
            <Suspense fallback={<LoadingFallback />}>
              <CollaborationVersionPanel bookId={bookId} repositoryPath={repositoryPath} />
            </Suspense>
          ) : null}
        </div>
      </div>
    </div>
  );
}
