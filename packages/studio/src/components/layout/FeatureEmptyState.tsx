import type { ReactNode } from "react";
import { Brain, BriefcaseBusiness, Castle, FileSearch, Flag, Sparkles, Theater, Users } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type FeatureEmptyStateKind = "jingwei" | "people" | "settings" | "foreshadowing" | "famous-scenes" | "core-memory" | "ai-flavor" | "workbench-mode";

export interface FeatureEmptyStateAction {
  label: string;
  description?: string;
  requiresAi?: boolean;
}

export interface FeatureEmptyStatePreset {
  kind: FeatureEmptyStateKind;
  title: string;
  description: string;
  primaryAction: FeatureEmptyStateAction;
  secondaryActions?: FeatureEmptyStateAction[];
  badge: string;
  icon: typeof Brain;
  aiPowered?: boolean;
}

export const FEATURE_EMPTY_STATE_PRESETS: Record<FeatureEmptyStateKind, FeatureEmptyStatePreset> = {
  jingwei: {
    kind: "jingwei",
    title: "故事经纬还空着",
    description: "先建立人物、设定、事件或章节摘要，后续 AI 写作会按可见性自动装配上下文。",
    primaryAction: { label: "新增经纬条目" },
    secondaryActions: [{ label: "管理栏目" }],
    badge: "经纬",
    icon: Castle,
  },
  people: {
    kind: "people",
    title: "还没有人物档案",
    description: "先记录主角、配角和关键关系，避免后续章节里姓名、称呼、动机前后冲突。",
    primaryAction: { label: "新增人物" },
    badge: "人物",
    icon: Users,
  },
  settings: {
    kind: "settings",
    title: "还没有设定卡",
    description: "把境界、势力、地点、物品等高频规则先沉淀下来，写作时就不必反复翻旧章节。",
    primaryAction: { label: "新增设定" },
    badge: "设定",
    icon: Flag,
  },
  foreshadowing: {
    kind: "foreshadowing",
    title: "还没有伏笔记录",
    description: "记录埋点、回收章节和风险说明，帮助长篇连载保持承诺与兑现。",
    primaryAction: { label: "新增伏笔" },
    badge: "伏笔",
    icon: FileSearch,
  },
  "famous-scenes": {
    kind: "famous-scenes",
    title: "还没有名场面素材",
    description: "把高光战斗、情绪爆点和关键转折先列出来，后续章节可以围绕这些目标铺垫。",
    primaryAction: { label: "新增名场面" },
    badge: "场面",
    icon: Theater,
  },
  "core-memory": {
    kind: "core-memory",
    title: "核心记忆还没有内容",
    description: "核心记忆会优先进入 AI 上下文，请只放最重要、最稳定、最不该忘的事实。",
    primaryAction: { label: "新增核心记忆" },
    badge: "核心",
    icon: Brain,
  },
  "ai-flavor": {
    kind: "ai-flavor",
    title: "还没有 AI 味检测结果",
    description: "可以先粘贴一段章节文本做本地准备；深度检测需要配置模型后再运行。",
    primaryAction: { label: "先粘贴文本" },
    secondaryActions: [{ label: "运行深度检测", requiresAi: true }],
    badge: "检测",
    icon: Sparkles,
    aiPowered: true,
  },
  "workbench-mode": {
    kind: "workbench-mode",
    title: "当前处于作者模式",
    description: "作者模式隐藏 Terminal、MCP、Browser、Shell、原始 Agent 日志等高级入口，普通写作不需要开启。",
    primaryAction: { label: "了解工作台模式" },
    secondaryActions: [{ label: "开启工作台模式" }],
    badge: "模式",
    icon: BriefcaseBusiness,
  },
};

interface FeatureEmptyStateProps {
  preset: FeatureEmptyStateKind | FeatureEmptyStatePreset;
  modelConfigured?: boolean;
  onPrimaryAction?: () => void;
  onSecondaryAction?: (action: FeatureEmptyStateAction) => void;
  onConfigureModel?: () => void;
  children?: ReactNode;
}

export function FeatureEmptyState({ preset, modelConfigured = true, onPrimaryAction, onSecondaryAction, onConfigureModel, children }: FeatureEmptyStateProps) {
  const config = typeof preset === "string" ? FEATURE_EMPTY_STATE_PRESETS[preset] : preset;
  const Icon = config.icon;
  const needsModel = config.aiPowered && !modelConfigured;

  return (
    <Card className="border-dashed bg-muted/20">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border/70">
          <Icon className="size-5" />
        </div>
        <Badge variant="outline">{config.badge}</Badge>
        <div className="space-y-2">
          <h2 className="text-lg font-medium text-foreground">{config.title}</h2>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">{config.description}</p>
        </div>
        {needsModel ? (
          <Alert className="max-w-xl text-left">
            <AlertTitle>此功能需要配置 AI 模型</AlertTitle>
            <AlertDescription>你仍然可以先完成本地整理；需要 AI 生成、深度检测或自动分析时，再去配置模型。</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" onClick={onPrimaryAction}>{config.primaryAction.label}</Button>
          {config.secondaryActions?.map((action) => (
            <Button key={action.label} type="button" variant="outline" onClick={() => onSecondaryAction?.(action)} disabled={action.requiresAi && needsModel}>
              {action.label}
            </Button>
          ))}
          {needsModel ? <Button type="button" variant="secondary" onClick={onConfigureModel}>配置模型</Button> : null}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

interface JingweiEmptyStateProps {
  sectionName: string;
  onCreateEntry?: () => void;
}

export function JingweiEmptyState({ sectionName, onCreateEntry }: JingweiEmptyStateProps) {
  return (
    <FeatureEmptyState
      preset={{
        ...FEATURE_EMPTY_STATE_PRESETS.jingwei,
        kind: "jingwei",
        title: `${sectionName}还没有经纬条目`,
        description: `先写下第一个关键${sectionName}，后续可以继续补充正文、标签、可见性和关联条目。`,
        primaryAction: { label: `新增${sectionName}条目` },
        secondaryActions: [],
      }}
      onPrimaryAction={onCreateEntry}
    />
  );
}
