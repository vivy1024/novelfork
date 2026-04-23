import type { WindowRecoveryState } from "@/stores/windowRuntimeStore";

/**
 * Recovery state presentation contract.
 *
 * Shared across SessionCenter cards, ChatWindow header banners, and the Admin session
 * overview so the user sees consistent wording/visual tones for the five recovery
 * states (idle / recovering / reconnecting / replaying / resetting).
 *
 * The `wsConnected` dimension is applied on top of the five-state machine: a fully
 * idle-but-offline window should still visibly say so, instead of silently hiding.
 *
 * Tone hints map to existing tailwind palette conventions:
 *  - success: 稳定在线 (emerald)
 *  - info:    短暂过渡 (sky)
 *  - warning: 主动回放/重连 (amber)
 *  - danger:  服务端要求重置 (rose)
 *  - neutral: 离线或无连接
 */
export type RecoveryPresentationTone = "success" | "info" | "warning" | "danger" | "neutral";

export interface RecoveryPresentation {
  /** Short badge label (≤ 4 汉字), suitable for card/badge rendering. */
  shortLabel: string;
  /** Header banner title (full sentence with ellipsis for transient states). */
  label: string;
  /** One-sentence description for banner body / tooltip. */
  description: string;
  /** Tone hint used by call-sites to pick tailwind palette. */
  tone: RecoveryPresentationTone;
  /**
   * Whether this state should be surfaced in the header banner. Idle+online is
   * surfaced as a subtle success badge only (not a header banner).
   */
  bannerVisible: boolean;
}

export interface RecoveryPresentationInput {
  recoveryState: WindowRecoveryState;
  wsConnected: boolean;
}

/**
 * Return the presentation contract for a given (recoveryState, wsConnected) pair.
 *
 * Invariants:
 *  - When `wsConnected=false` and `recoveryState=idle`, we present a neutral offline
 *    notice so the user can distinguish 真·离线 from 在线但静默.
 *  - When `wsConnected=true` and `recoveryState=idle`, we present a positive
 *    "实时同步" success badge to give stable-state feedback (5.6 要求).
 *  - Any non-idle state shows the transient banner.
 */
export function getRecoveryPresentation(input: RecoveryPresentationInput): RecoveryPresentation {
  const { recoveryState, wsConnected } = input;

  if (recoveryState === "idle") {
    if (wsConnected) {
      return {
        shortLabel: "实时同步",
        label: "会话实时同步中",
        description: "当前窗口已和服务端正式会话保持在线同步，可直接继续对话。",
        tone: "success",
        bannerVisible: false,
      };
    }
    return {
      shortLabel: "离线",
      label: "会话暂时离线",
      description: "当前窗口与服务端的实时通道尚未建立，恢复连接后会自动继续同步。",
      tone: "neutral",
      bannerVisible: true,
    };
  }

  switch (recoveryState) {
    case "recovering":
      return {
        shortLabel: "恢复中",
        label: "正在恢复正式会话快照…",
        description: "当前窗口正在从服务端加载正式快照，恢复完成后会继续沿用正式消息链。",
        tone: "info",
        bannerVisible: true,
      };
    case "reconnecting":
      return {
        shortLabel: "重连中",
        label: "正在重新连接会话…",
        description: "当前窗口正在和服务端正式会话重新对齐，连接恢复后会继续沿用正式消息链。",
        tone: "warning",
        bannerVisible: true,
      };
    case "replaying":
      return {
        shortLabel: "回放中",
        label: "正在回放会话历史…",
        description: "当前窗口正在从服务端回放最近增量，回放完成后会继续沿用正式消息链。",
        tone: "warning",
        bannerVisible: true,
      };
    case "resetting":
      return {
        shortLabel: "重置中",
        label: "历史已重置，正在重新同步会话…",
        description: "服务端要求当前窗口放弃本地补拉结果，并重新同步正式快照后继续推进。",
        tone: "danger",
        bannerVisible: true,
      };
  }
}

/**
 * Tailwind class bundle per tone for badges (bg + text + border).
 * Centralizes the palette so SessionCenter / ChatWindow / Admin share identical visuals.
 */
export function getRecoveryToneBadgeClassName(tone: RecoveryPresentationTone): string {
  switch (tone) {
    case "success":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700";
    case "info":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700";
    case "danger":
      return "border-rose-500/30 bg-rose-500/10 text-rose-700";
    case "neutral":
      return "border-border/60 bg-muted text-muted-foreground";
  }
}

/**
 * Tailwind class bundle per tone for the header banner (bg + text + border).
 */
export function getRecoveryToneBannerClassName(tone: RecoveryPresentationTone): string {
  switch (tone) {
    case "success":
      return "border-b border-emerald-500/20 bg-emerald-500/10 text-emerald-700";
    case "info":
      return "border-b border-sky-500/20 bg-sky-500/10 text-sky-700";
    case "warning":
      return "border-b border-amber-500/20 bg-amber-500/10 text-amber-700";
    case "danger":
      return "border-b border-rose-500/20 bg-rose-500/10 text-rose-700";
    case "neutral":
      return "border-b border-border/60 bg-muted/60 text-muted-foreground";
  }
}
