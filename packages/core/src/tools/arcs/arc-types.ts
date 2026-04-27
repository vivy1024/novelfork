export type ArcType = "positive-growth" | "fall" | "flat" | "transformation" | "redemption";
export type ArcBeatDirection = "advance" | "regression" | "neutral";

export interface ArcBeat {
  readonly chapter: number;
  readonly event: string;
  readonly change: string;
  readonly direction: ArcBeatDirection;
}

export interface CharacterArc {
  readonly characterId: string;
  readonly arcType: ArcType;
  readonly startPoint: string;
  readonly endPoint: string;
  readonly currentPhase: string;
  readonly beats: ReadonlyArray<ArcBeat>;
}
