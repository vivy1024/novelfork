import { BookMarked, Plus, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkbenchResourceKind } from "./useWorkbenchResources";

export interface JingweiEmptyStateProps {
  sectionKind: WorkbenchResourceKind;
  sectionTitle: string;
  onCreate?: () => void;
}

const SECTION_DESCRIPTIONS: Record<string, { description: string; examples: string[] }> = {
  "设定": {
    description: "世界观、魔法体系、势力关系等基础设定。AI 写作时会参考这些设定保持一致性。",
    examples: ["修炼体系", "宗门势力", "地理版图", "灵材分类"],
  },
  "大纲": {
    description: "故事主线、分卷大纲、关键转折点。帮助 AI 理解故事走向，避免偏离主线。",
    examples: ["主线剧情", "第一卷大纲", "高潮节点", "结局走向"],
  },
  "状态": {
    description: "角色当前状态、物品持有、关系变化等动态信息。每章写完后更新，确保连续性。",
    examples: ["主角修为", "持有法宝", "人物关系", "已触发伏笔"],
  },
  "规则": {
    description: "写作风格规则、禁忌词、叙事视角约束。AI 生成时严格遵守这些规则。",
    examples: ["文风基调", "禁用词汇", "视角限制", "对话风格"],
  },
  "伏笔": {
    description: "已埋设和待回收的伏笔。帮助 AI 在合适时机回收伏笔，避免遗忘。",
    examples: ["神秘老者身份", "断剑来历", "预言内容", "暗线线索"],
  },
};

function getSectionInfo(title: string) {
  for (const [key, info] of Object.entries(SECTION_DESCRIPTIONS)) {
    if (title.includes(key)) return info;
  }
  return {
    description: "在此添加经纬条目，AI 写作时会参考这些资料保持一致性和连续性。",
    examples: ["条目 1", "条目 2", "条目 3"],
  };
}

export function JingweiEmptyState({ sectionTitle, onCreate }: JingweiEmptyStateProps) {
  const info = getSectionInfo(sectionTitle);

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
      <div className="flex items-center justify-center size-10 rounded-full bg-teal-500/10">
        <BookMarked className="size-5 text-teal-500" />
      </div>
      <div className="space-y-1.5">
        <h3 className="text-sm font-medium">{sectionTitle}（空）</h3>
        <p className="text-xs text-muted-foreground max-w-[280px]">{info.description}</p>
      </div>
      <div className="flex items-start gap-1.5 rounded-md bg-amber-500/5 border border-amber-500/20 px-3 py-2 text-left">
        <Lightbulb className="size-3.5 shrink-0 mt-0.5 text-amber-500" />
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">示例条目：</span>
          {info.examples.join("、")}
        </div>
      </div>
      {onCreate && (
        <Button size="sm" variant="outline" className="mt-1" onClick={onCreate}>
          <Plus className="size-3.5 mr-1" />
          新建条目
        </Button>
      )}
    </div>
  );
}
