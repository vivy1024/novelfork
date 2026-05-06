export const PARITY_STATUSES = ["current", "partial", "planned", "non-goal", "unknown"] as const;

export type ParityStatus = (typeof PARITY_STATUSES)[number];

export interface ParityEvidence {
  readonly source: "local-cli" | "official-docs" | "local-source" | "novelfork-code" | "browser" | "test";
  readonly label: string;
  readonly reference: string;
  readonly checkedAt: string;
}

export interface ParityMatrixEntry {
  readonly capability: string;
  readonly upstreamEvidence: readonly ParityEvidence[];
  readonly novelForkStatus: ParityStatus;
  readonly surface: string;
  readonly verification: string;
  readonly notes: string;
  readonly uiClaimAllowed?: boolean;
}

export interface ParityMatrixValidationIssue {
  readonly capability: string;
  readonly code: "INVALID_STATUS" | "MISSING_EVIDENCE" | "MISSING_DATE" | "NON_GOAL_UI_CLAIM";
  readonly message: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateParityMatrix(entries: readonly ParityMatrixEntry[]): ParityMatrixValidationIssue[] {
  const issues: ParityMatrixValidationIssue[] = [];
  for (const entry of entries) {
    if (!(PARITY_STATUSES as readonly string[]).includes(entry.novelForkStatus)) {
      issues.push({ capability: entry.capability, code: "INVALID_STATUS", message: `Invalid status: ${entry.novelForkStatus}` });
    }
    if (entry.upstreamEvidence.length === 0) {
      issues.push({ capability: entry.capability, code: "MISSING_EVIDENCE", message: "At least one upstream evidence item is required" });
    }
    for (const evidence of entry.upstreamEvidence) {
      if (!DATE_PATTERN.test(evidence.checkedAt)) {
        issues.push({ capability: entry.capability, code: "MISSING_DATE", message: `Evidence '${evidence.label}' must use YYYY-MM-DD checkedAt` });
      }
    }
    if (entry.novelForkStatus === "non-goal" && entry.uiClaimAllowed !== false) {
      issues.push({ capability: entry.capability, code: "NON_GOAL_UI_CLAIM", message: "non-goal entries must be blocked from UI current claims" });
    }
  }
  return issues;
}

export function parityEntryCanBeAdvertisedAsCurrent(entry: ParityMatrixEntry): boolean {
  return entry.novelForkStatus === "current" && entry.uiClaimAllowed !== false;
}
