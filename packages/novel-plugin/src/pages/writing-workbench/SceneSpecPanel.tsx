/**
 * SceneSpecPanel — 章节蓝图可视化
 *
 * 渲染 SceneSpec 结构化数据为场景卡片：
 * 每个场景显示角色/地点/冲突/情绪曲线/伏笔进出。
 */
import { Badge } from "@/components/ui/badge";
import { Users, MapPin, Swords, Heart, Eye, EyeOff } from "lucide-react";

export interface SceneSpecScene {
  characters: string[];
  location: string;
  conflict: string;
  mood: string;
  outcome: string;
  hooks_used: string[];
  hooks_planted: string[];
}

export interface SceneSpec {
  chapter: number;
  title: string;
  wordTarget: number;
  scenes: SceneSpecScene[];
  constraints: string[];
}

export interface SceneSpecPanelProps {
  spec: SceneSpec;
}

export function SceneSpecPanel({ spec }: SceneSpecPanelProps) {
  return (
    <div className="space-y-4">
      {/* 章节 header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">第{spec.chapter}章</Badge>
          <span className="text-sm font-semibold">{spec.title}</span>
        </div>
        <p className="text-[10px] text-muted-foreground">目标字数：{spec.wordTarget.toLocaleString()}</p>
      </div>

      {/* 场景卡片列表 */}
      <div className="space-y-3">
        {spec.scenes.map((scene, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2">
            {/* 场景标题行 */}
            <div className="flex items-center gap-2 text-xs font-medium">
              <Badge variant="outline" className="text-[9px]">场景 {i + 1}</Badge>
              <span className="text-muted-foreground">→</span>
              <span className="truncate">{scene.outcome}</span>
            </div>

            {/* 角色 */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Users className="size-3 text-blue-500 shrink-0" />
              {scene.characters.map((char) => (
                <Badge key={char} variant="secondary" className="text-[9px]">{char}</Badge>
              ))}
            </div>

            {/* 地点 */}
            <div className="flex items-center gap-1.5 text-[11px]">
              <MapPin className="size-3 text-green-500 shrink-0" />
              <span className="text-muted-foreground">{scene.location}</span>
            </div>

            {/* 冲突 */}
            <div className="flex items-start gap-1.5 text-[11px]">
              <Swords className="size-3 text-orange-500 shrink-0 mt-0.5" />
              <span>{scene.conflict}</span>
            </div>

            {/* 情绪曲线 */}
            <div className="flex items-center gap-1.5 text-[11px]">
              <Heart className="size-3 text-pink-500 shrink-0" />
              <span className="italic text-muted-foreground">{scene.mood}</span>
            </div>

            {/* 伏笔进出 */}
            {(scene.hooks_used.length > 0 || scene.hooks_planted.length > 0) && (
              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border">
                {scene.hooks_used.map((hook) => (
                  <Badge key={`used-${hook}`} variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-600">
                    <Eye className="size-2.5 mr-0.5" />{hook}
                  </Badge>
                ))}
                {scene.hooks_planted.map((hook) => (
                  <Badge key={`plant-${hook}`} variant="outline" className="text-[9px] border-amber-500/30 text-amber-600">
                    <EyeOff className="size-2.5 mr-0.5" />{hook}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 约束 */}
      {spec.constraints.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-[10px] font-medium text-muted-foreground mb-1">写作约束</p>
          <ul className="space-y-0.5">
            {spec.constraints.map((c, i) => (
              <li key={i} className="text-[11px] text-muted-foreground">• {c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
