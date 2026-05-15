export interface ToneDriftResult {
  readonly declaredTone: string;
  readonly detectedTone: string;
  readonly driftScore: number;
  readonly driftDirection: string;
  readonly isSignificant: boolean;
  readonly consecutiveDriftChapters: number;
}
