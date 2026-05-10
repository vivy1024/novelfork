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
// BeatProgressBar
// ---------------------------------------------------------------------------

export interface BeatProgressBarProps {
  readonly templateId: string;
  readonly currentBeatIndex: number;
  readonly beats?: ReadonlyArray<Beat>;
}

export function BeatProgressBar({ templateId, currentBeatIndex, beats }: BeatProgressBarProps) {
  const { data } = useApi<BeatsResponse>(!beats ? "/api/presets/beats" : null);
  const [hoveredBeat, setHoveredBeat] = useState<Beat | null>(null);

  const template = beats
    ? { beats }
    : data?.beats.find((t) => t.id === templateId);

  if (!template) return null;

  const totalBeats = template.beats.length;

  return (
    <div className="space-y-1.5" data-testid="beat-progress-bar">
      {/* Progress nodes */}
      <div className="flex items-center gap-0.5 relative">
        {template.beats.map((beat, i) => {
          const isCompleted = i < currentBeatIndex;
          const isCurrent = i === currentBeatIndex;
          return (
            <div
              key={beat.index}
              className="flex-1 relative group"
              onMouseEnter={() => setHoveredBeat(beat)}
              onMouseLeave={() => setHoveredBeat(null)}
            >
              <div
                className={`h-2 rounded-sm transition-colors ${
                  isCompleted
                    ? "bg-primary"
                    : isCurrent
                      ? "bg-primary/60 ring-1 ring-primary"
                      : "bg-muted"
                }`}
                title={beat.name}
              />
              {/* Current marker */}
              {isCurrent && (
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 size-1.5 rounded-full bg-primary" />
              )}
            </div>
          );
        })}
      </div>

      {/* Progress text */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{currentBeatIndex} / {totalBeats} 节拍</span>
        <span>{Math.round((currentBeatIndex / totalBeats) * 100)}%</span>
      </div>

      {/* Hover tooltip */}
      {hoveredBeat && (
        <div className="rounded border border-border bg-popover p-2 text-xs space-y-0.5 shadow-sm">
          <div className="font-medium">{hoveredBeat.name}</div>
          {hoveredBeat.englishName && (
            <div className="text-[10px] text-muted-foreground">{hoveredBeat.englishName}</div>
          )}
          <div className="text-[10px] text-muted-foreground">{hoveredBeat.purpose}</div>
          <div className="text-[10px] text-muted-foreground">
            情绪基调: {hoveredBeat.emotionalTone} · 篇幅占比: {Math.round(hoveredBeat.wordRatio * 100)}%
          </div>
          {hoveredBeat.networkNovelTip && (
            <div className="text-[10px] text-blue-600">网文提示: {hoveredBeat.networkNovelTip}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BeatTemplateList — shows available templates with progress bar preview
// ---------------------------------------------------------------------------

export interface BeatTemplateListProps {
  readonly selectedTemplateId?: string;
  readonly currentBeatIndex?: number;
  readonly onSelectTemplate?: (templateId: string) => void;
}

export function BeatTemplateList({ selectedTemplateId, currentBeatIndex = 0, onSelectTemplate }: BeatTemplateListProps) {
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
                  currentBeatIndex={currentBeatIndex}
                  beats={template.beats}
                />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
