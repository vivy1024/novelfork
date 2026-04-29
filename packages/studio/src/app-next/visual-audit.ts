export interface VisualAuditSnapshot {
  readonly id: string;
  readonly label: string;
  readonly backgroundColor: string;
  readonly color: string;
  readonly borderColor: string;
  readonly opacity: string;
  readonly cursor: string;
  readonly boxShadow: string;
}

export const REQUIRED_THEME_UTILITIES = [
  ".bg-primary",
  ".text-primary",
  ".text-primary-foreground",
  ".bg-muted",
  ".text-muted-foreground",
  ".border-border",
  ".bg-card",
  ".bg-destructive",
] as const;

export interface VisualAuditResult {
  readonly pass: boolean;
  readonly missingUtilities: string[];
  readonly groups: Record<string, string>;
  readonly comparisons: {
    readonly primaryVsOutline: { readonly sameGroup: boolean };
    readonly activeTabVsOutline: { readonly sameGroup: boolean };
    readonly disabledVsOutline: { readonly sameGroup: boolean };
    readonly disabledVsPrimary: { readonly sameGroup: boolean };
  };
}

function normalizeStyleToken(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function buildGroup(snapshot: VisualAuditSnapshot): string {
  return [
    normalizeStyleToken(snapshot.backgroundColor),
    normalizeStyleToken(snapshot.color),
    normalizeStyleToken(snapshot.borderColor),
    normalizeStyleToken(snapshot.opacity),
    normalizeStyleToken(snapshot.cursor),
    normalizeStyleToken(snapshot.boxShadow),
  ].join("|");
}

function findMissingUtilities(cssText: string): string[] {
  return REQUIRED_THEME_UTILITIES.filter((utility) => !cssText.includes(utility));
}

export function auditVisualStates(input: {
  readonly cssText: string;
  readonly snapshots: {
    readonly primaryAction: VisualAuditSnapshot;
    readonly outlineAction: VisualAuditSnapshot;
    readonly activeTab: VisualAuditSnapshot;
    readonly disabledAction: VisualAuditSnapshot;
  };
}): VisualAuditResult {
  const missingUtilities = findMissingUtilities(input.cssText);
  const groups = {
    primaryAction: buildGroup(input.snapshots.primaryAction),
    outlineAction: buildGroup(input.snapshots.outlineAction),
    activeTab: buildGroup(input.snapshots.activeTab),
    disabledAction: buildGroup(input.snapshots.disabledAction),
  };

  const comparisons = {
    primaryVsOutline: { sameGroup: groups.primaryAction === groups.outlineAction },
    activeTabVsOutline: { sameGroup: groups.activeTab === groups.outlineAction },
    disabledVsOutline: { sameGroup: groups.disabledAction === groups.outlineAction },
    disabledVsPrimary: { sameGroup: groups.disabledAction === groups.primaryAction },
  };

  const pass =
    missingUtilities.length === 0 &&
    !comparisons.primaryVsOutline.sameGroup &&
    !comparisons.activeTabVsOutline.sameGroup &&
    !comparisons.disabledVsOutline.sameGroup &&
    !comparisons.disabledVsPrimary.sameGroup;

  return {
    pass,
    missingUtilities,
    groups,
    comparisons,
  };
}
