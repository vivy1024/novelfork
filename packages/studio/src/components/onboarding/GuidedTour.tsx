import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TourStep } from "./tour-steps";

interface GuidedTourProps {
  /** 步骤列表 */
  readonly steps: readonly TourStep[];
  /** localStorage key，完成后标记 */
  readonly storageKey: string;
  /** 是否激活（外部控制） */
  readonly active: boolean;
  /** 完成或跳过时回调 */
  readonly onComplete: () => void;
}

interface TooltipPosition {
  top: number;
  left: number;
}

function computePosition(rect: DOMRect, placement: TourStep["placement"]): TooltipPosition {
  const gap = 12;
  switch (placement) {
    case "right":
      return { top: rect.top + rect.height / 2, left: rect.right + gap };
    case "left":
      return { top: rect.top + rect.height / 2, left: rect.left - gap };
    case "bottom":
      return { top: rect.bottom + gap, left: rect.left + rect.width / 2 };
    case "top":
      return { top: rect.top - gap, left: rect.left + rect.width / 2 };
  }
}

function getTransformOrigin(placement: TourStep["placement"]): string {
  switch (placement) {
    case "right": return "translateY(-50%)";
    case "left": return "translateX(-100%) translateY(-50%)";
    case "bottom": return "translateX(-50%)";
    case "top": return "translateX(-50%) translateY(-100%)";
  }
}

export function GuidedTour({ steps, storageKey, active, onComplete }: GuidedTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const rafRef = useRef<number>(0);

  const step = steps[currentStep];

  const updatePosition = useCallback(() => {
    if (!step || !active) return;
    const el = document.querySelector(`[data-tour-id="${step.targetId}"]`);
    if (!el) {
      setPosition(null);
      setHighlightRect(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setPosition(computePosition(rect, step.placement));
    setHighlightRect(rect);
  }, [step, active]);

  useEffect(() => {
    if (!active) return;
    updatePosition();
    const handleResize = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updatePosition);
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, true);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize, true);
      cancelAnimationFrame(rafRef.current);
    };
  }, [active, updatePosition]);

  const finish = useCallback(() => {
    try { localStorage.setItem(storageKey, "1"); } catch { /* ignore */ }
    onComplete();
  }, [storageKey, onComplete]);

  const next = useCallback(() => {
    if (currentStep >= steps.length - 1) {
      finish();
    } else {
      setCurrentStep((s) => s + 1);
    }
  }, [currentStep, steps.length, finish]);

  if (!active || !step || !position) return null;

  const padding = 6;

  return (
    <div className="fixed inset-0 z-[9999]" aria-label="引导教程">
      {/* 半透明遮罩 + 高亮区域 */}
      <div className="absolute inset-0 bg-black/40" onClick={finish} />
      {highlightRect && (
        <div
          className="absolute rounded-lg border-2 border-primary/60 bg-transparent"
          style={{
            top: highlightRect.top - padding,
            left: highlightRect.left - padding,
            width: highlightRect.width + padding * 2,
            height: highlightRect.height + padding * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)",
          }}
        />
      )}
      {/* Tooltip */}
      <div
        className="absolute z-[10000] w-72 rounded-xl border border-border bg-popover p-4 shadow-lg"
        style={{
          top: position.top,
          left: position.left,
          transform: getTransformOrigin(step.placement),
        }}
      >
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">{step.title}</p>
          <p className="text-xs text-muted-foreground">{step.description}</p>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {currentStep + 1} / {steps.length}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={finish}>
              跳过
            </Button>
            <Button type="button" size="sm" onClick={next}>
              {currentStep >= steps.length - 1 ? "完成" : "下一步"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
