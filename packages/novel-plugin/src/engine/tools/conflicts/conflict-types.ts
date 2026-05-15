export type ConflictRank = "primary" | "secondary";
export type ConflictNature = "antagonistic" | "non-antagonistic";
export type ConflictResolutionState =
  | "latent"
  | "emerging"
  | "escalating"
  | "transforming"
  | "climaxing"
  | "unifying"
  | "resolved";

export interface ConflictTransformation {
  readonly chapter: number;
  readonly fromState: string;
  readonly toState: string;
  readonly trigger: string;
  readonly rankChange?: {
    readonly from: ConflictRank;
    readonly to: ConflictRank;
  };
}

export interface ConflictDialecticExtension {
  readonly rank: ConflictRank;
  readonly nature: ConflictNature;
  readonly sides: readonly [string, string];
  readonly controllingIdea?: string;
  readonly transformations: ReadonlyArray<ConflictTransformation>;
}
