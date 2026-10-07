/**
 * 压力账本种类词表与遗忘阈值。
 *
 * 写后闸（pressure-ledger-gate）读这一处的词表与阈值，
 * 「钱/证/仇/债」和 staleAfter=8 不在别处另写一遍。
 */

export type PressureLedgerKind = "money" | "evidence" | "grudge" | "debt" | "hook";

export type PressureResourceKind = Exclude<PressureLedgerKind, "hook">;

export const PRESSURE_LEDGER_KIND_LABEL: Record<PressureLedgerKind, string> = {
  money: "钱",
  evidence: "证",
  grudge: "仇",
  debt: "债",
  hook: "伏笔",
};

/** 超过这个章数没有推进，闸标「可能被遗忘」。 */
export const PRESSURE_LEDGER_STALE_AFTER_CHAPTERS = 8;

export const PRESSURE_RESOURCE_KIND_HINTS: ReadonlyArray<{
  readonly kind: PressureResourceKind;
  readonly terms: readonly string[];
}> = [
  { kind: "money", terms: ["钱", "灵石", "银两", "存款", "资金"] },
  { kind: "evidence", terms: ["证", "证据", "证物", "凭证"] },
  { kind: "grudge", terms: ["仇", "仇恨", "仇怨"] },
  { kind: "debt", terms: ["债", "欠条", "人情债"] },
];

export function classifyPressureResource(resourceId: string, name: string): PressureResourceKind | undefined {
  const blob = `${resourceId} ${name}`.toLowerCase();
  for (const hint of PRESSURE_RESOURCE_KIND_HINTS) {
    if (hint.terms.some((term) => blob.includes(term.toLowerCase()))) return hint.kind;
  }
  return undefined;
}
