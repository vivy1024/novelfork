import { useApi } from "../../hooks/use-api";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Beat {
  readonly index: number;
  readonly name: string;
  readonly englishName?: string;
  readonly purpose: string;
  readonly wordRatio: number;
  readonly emotionalTone: string;
  readonly networkNovelTip?: string;
}

interface BeatTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly beats: ReadonlyArray<Beat>;
}

interface BeatsResponse {
  readonly beats: ReadonlyArray<BeatTemplate>;
}

// ---------------------------------------------------------------------------
// BeatProgressBar — checklist mode (manual tracking)
// ---------------------------------------------------------------------------

export interface BeatProgressBarProps {
  readonly templateId: string;
  readonly currentBeatIndex?: number;
  readonly beats?: ReadonlyArray<Beat>;
  readonly completedBeats?: ReadonlyArray<number>;
  readonly onToggleBeat?: (beatIndex: number, completed: boolean) => void;
}

export function BeatProgressBar({ templateId, beats, completedBeats = [], onToggleBeat }: BeatProgressBarProps) {
  const { data } = useApi<BeatsResponse>(!beats ? "/api/presets/beats" : null);
  const [expandedBeat, setExpandedBeat] = useState<number | null>(null);

  const template = beats
    ? { beats }
    : data?.beats.find((t) => t.id === templateId);

  if (!template) return null;

  const completedSet = new Set(completedBeats);
  const completedCount = completedSet.size;
  const totalBeats = template.beats.length;

  return (
    <div className="space-y-1.5" data-testid="beat-progress-bar">
      {/* Summary bar */}
      <div className="flex items-center gap-0.5 relative">
        {template.beats.map((beat, i) => {
          const isCompleted = completedSet.has(i);
          return (
            <div
              key={beat.index}
              className="flex-1"
              title={beat.name}
            >
              <div
                className={`h-2 rounded-sm transition-colors ${
                  isCompleted ? "bg-primary" : "bg-muted"
                }`}
              />
            </div>
          );
        })}
      </div>

      {/* Progress text */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{completedCount} / {totalBeats} 节拍已完成</span>
        <span>{totalBeats > 0 ? Math.round((completedCount / totalBeats) * 100) : 0}%</span>
      </div>

      {/* Beat checklist */}
      <div className="space-y-0.5 mt-1">
        {template.beats.map((beat, i) => {
          const isCompleted = completedSet.has(i);
          const isExpanded = expandedBeat === i;
          return (
            <div key={beat.index} className="rounded border border-border">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <input
                  type="checkbox"
                  checked={isCompleted}
                  onChange={() => onToggleBeat?.(i, !isCompleted)}
                  className="size-3.5 rounded border-border"
                  aria-label={`标记 ${beat.name} 为${isCompleted ? "未完成" : "已完成"}`}
                />
                <button
                  type="button"
                  className="flex-1 text-left text-xs truncate hover:text-primary transition-colors"
                  onClick={() => setExpandedBeat(isExpanded ? null : i)}
                >
                  <span className={isCompleted ? "line-through text-muted-foreground" : ""}>{beat.name}</span>
                </button>
                <span className="text-[10px] text-muted-foreground shrink-0">{Math.round(beat.wordRatio * 100)}%</span>
              </div>
              {isExpanded && (
                <div className="px-2 pb-2 text-[10px] text-muted-foreground space-y-0.5 border-t border-border pt-1.5">
                  {beat.englishName && <div>{beat.englishName}</div>}
                  <div>{beat.purpose}</div>
                  <div>情绪基调: {beat.emotionalTone}</div>
                  {beat.networkNovelTip && <div className="text-blue-600">网文提示: {beat.networkNovelTip}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!onToggleBeat && (
        <p className="text-[10px] text-muted-foreground text-center mt-1">手动标记进度功能开发中</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BeatTemplateList — shows available templates with checklist progress
// ---------------------------------------------------------------------------

export interface BeatTemplateListProps {
  readonly selectedTemplateId?: string;
  readonly currentBeatIndex?: number;
  readonly completedBeats?: ReadonlyArray<number>;
  readonly onSelectTemplate?: (templateId: string) => void;
  readonly onToggleBeat?: (beatIndex: number, completed: boolean) => void;
}

export function BeatTemplateList({ selectedTemplateId, completedBeats = [], onSelectTemplate, onToggleBeat }: BeatTemplateListProps) {
  const { data, loading } = useApi<BeatsResponse>("/api/presets/beats");

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-muted rounded" />
        ))}
      </div>
    );
  }

  if (!data || data.beats.length === 0) {
    return <p className="text-xs text-muted-foreground">暂无节拍模板</p>;
  }

  return (
    <div className="space-y-2" data-testid="beat-template-list">
      {data.beats.map((template) => {
        const isSelected = template.id === selectedTemplateId;
        return (
          <button
            key={template.id}
            type="button"
            onClick={() => onSelectTemplate?.(template.id)}
            className={`w-full text-left rounded-lg border p-2.5 transition-colors ${
              isSelected
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">{template.name}</span>
              <span className="text-[10px] text-muted-foreground">{template.beats.length} 节拍</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{template.description}</p>
            {isSelected && (
              <div className="mt-2">
                <BeatProgressBar
                  templateId={template.id}
                  beats={template.beats}
                  completedBeats={completedBeats}
                  onToggleBeat={onToggleBeat}
                />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
