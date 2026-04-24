/**
 * RecoveryBadge — unified visual primitive for the five-state recovery machine.
 *
 * Replaces inline `getRecoveryPresentation` + `<Badge>` call sites across
 * SessionCenter, ChatWindow, and Admin/SessionsTab. The presentation contract
 * (labels / tone / visibility) still lives in `@/lib/windowRecoveryPresentation.ts` —
 * this component only decides **how** the presentation renders per variant.
 *
 * Variants:
 *   - `chip`   — compact colored pill with a leading status dot (lists, tables).
 *   - `inline` — chip + short description beside it (card body).
 *   - `banner` — full-width header banner with title + description (ChatWindow head).
 *
 * Accessibility:
 *   - Each badge has an aria-label describing the state + optional offline bit,
 *     so screen readers do not need to parse Chinese visual labels.
 */
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  getRecoveryPresentation,
  getRecoveryToneBadgeClassName,
  getRecoveryToneBannerClassName,
  type RecoveryPresentationTone,
} from "@/lib/windowRecoveryPresentation";
import type { WindowRecoveryState } from "@/stores/windowRuntimeStore";

export type RecoveryBadgeVariant = "chip" | "inline" | "banner";

export interface RecoveryBadgeProps {
  recoveryState: WindowRecoveryState;
  wsConnected: boolean;
  variant?: RecoveryBadgeVariant;
  /**
   * When true, the `idle + connected` steady state is not rendered (returns null).
   * Useful in places where positive feedback would be visual noise (e.g. next to
   * an already-obvious "online" green light). Default: false — stable state is
   * visible per 5.6 acceptance.
   */
  hideWhenStable?: boolean;
  className?: string;
}

function toneDotClassName(tone: RecoveryPresentationTone): string {
  switch (tone) {
    case "success":
      return "bg-emerald-500";
    case "info":
      return "bg-sky-500";
    case "warning":
      return "bg-amber-500";
    case "danger":
      return "bg-rose-500";
    case "neutral":
      return "bg-muted-foreground/50";
  }
}

/** Transient states pulse the leading dot to signal activity. */
function shouldPulse(state: WindowRecoveryState): boolean {
  return state === "recovering" || state === "reconnecting" || state === "replaying" || state === "resetting";
}

export function RecoveryBadge({
  recoveryState,
  wsConnected,
  variant = "chip",
  hideWhenStable = false,
  className,
}: RecoveryBadgeProps) {
  const presentation = getRecoveryPresentation({ recoveryState, wsConnected });

  if (hideWhenStable && recoveryState === "idle" && wsConnected) {
    return null;
  }

  const dot = (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full",
        toneDotClassName(presentation.tone),
        shouldPulse(recoveryState) && "animate-pulse",
      )}
      aria-hidden="true"
    />
  );

  const ariaLabel = `会话状态：${presentation.label}${wsConnected ? "" : "（离线）"}`;

  if (variant === "banner") {
    if (!presentation.bannerVisible) return null;
    return (
      <div
        role="status"
        aria-label={ariaLabel}
        className={cn(
          getRecoveryToneBannerClassName(presentation.tone),
          "flex items-start gap-2 px-3 py-2 text-xs",
          className,
        )}
      >
        <span className="mt-1.5 flex-shrink-0">{dot}</span>
        <div className="min-w-0">
          <div className="font-medium">{presentation.label}</div>
          <div className="mt-0.5 leading-5 opacity-90">{presentation.description}</div>
        </div>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div
        role="status"
        aria-label={ariaLabel}
        className={cn("flex items-center gap-2", className)}
      >
        <Badge
          variant="outline"
          className={cn(
            "inline-flex items-center gap-1.5",
            getRecoveryToneBadgeClassName(presentation.tone),
          )}
        >
          {dot}
          {presentation.shortLabel}
        </Badge>
        <span className="text-xs text-muted-foreground leading-5">{presentation.description}</span>
      </div>
    );
  }

  // variant === "chip"
  return (
    <Badge
      role="status"
      aria-label={ariaLabel}
      variant="outline"
      className={cn(
        "inline-flex items-center gap-1.5",
        getRecoveryToneBadgeClassName(presentation.tone),
        className,
      )}
    >
      {dot}
      {presentation.shortLabel}
    </Badge>
  );
}
